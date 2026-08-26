use serde::Serialize;
use std::{
    collections::HashMap,
    fs::{self, File},
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const TEMPORARY_TTL: Duration = Duration::from_secs(15 * 60);

#[derive(Clone)]
pub struct NativeTemporaryStore {
    root: Arc<PathBuf>,
    artifacts: Arc<Mutex<HashMap<String, TemporaryEntry>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemporaryArtifactResponse {
    pub token: String,
    pub mime_type: String,
    pub size_bytes: usize,
    pub expires_at: i64,
}

#[derive(Debug, Clone)]
struct TemporaryEntry {
    path: PathBuf,
    mime_type: String,
    size_bytes: usize,
    expires_at: i64,
}

pub struct CheckedOutTemporary {
    token: String,
    entry: TemporaryEntry,
    store: NativeTemporaryStore,
    completed: bool,
}

impl NativeTemporaryStore {
    pub fn open(app_data_root: PathBuf) -> Result<Self, String> {
        let root = app_data_root.join("temp/image-processing");
        if root.exists() {
            fs::remove_dir_all(&root).map_err(|error| error.to_string())?;
        }
        fs::create_dir_all(&root).map_err(|error| error.to_string())?;
        Ok(Self {
            root: Arc::new(root),
            artifacts: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    pub fn create(
        &self,
        mime_type: &str,
        bytes: &[u8],
    ) -> Result<TemporaryArtifactResponse, String> {
        if !mime_type.starts_with("image/") || bytes.is_empty() {
            return Err("Temporary image output is invalid".to_string());
        }
        self.cleanup_expired()?;
        let token = Uuid::new_v4().to_string();
        let final_path = self.root.join(format!("{token}.artifact"));
        let temporary_path = self.root.join(format!("{token}.tmp"));
        let write_result = (|| -> Result<(), String> {
            let mut file = File::create(&temporary_path).map_err(|error| error.to_string())?;
            file.write_all(bytes).map_err(|error| error.to_string())?;
            file.sync_all().map_err(|error| error.to_string())?;
            fs::rename(&temporary_path, &final_path).map_err(|error| error.to_string())
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(&temporary_path);
        }
        write_result?;

        let expires_at = unix_millis()? + TEMPORARY_TTL.as_millis() as i64;
        let entry = TemporaryEntry {
            path: final_path,
            mime_type: mime_type.to_string(),
            size_bytes: bytes.len(),
            expires_at,
        };
        self.artifacts
            .lock()
            .map_err(|error| error.to_string())?
            .insert(token.clone(), entry);
        Ok(TemporaryArtifactResponse {
            token,
            mime_type: mime_type.to_string(),
            size_bytes: bytes.len(),
            expires_at,
        })
    }

    pub fn release(&self, token: &str) -> Result<(), String> {
        let entry = self
            .artifacts
            .lock()
            .map_err(|error| error.to_string())?
            .remove(token);
        if let Some(entry) = entry {
            remove_file_if_present(&entry.path)?;
        }
        Ok(())
    }

    pub fn checkout(&self, token: &str) -> Result<CheckedOutTemporary, String> {
        self.cleanup_expired()?;
        let entry = self
            .artifacts
            .lock()
            .map_err(|error| error.to_string())?
            .remove(token)
            .ok_or_else(|| "Temporary image token is unavailable or expired".to_string())?;
        Ok(CheckedOutTemporary {
            token: token.to_string(),
            entry,
            store: self.clone(),
            completed: false,
        })
    }

    pub fn cleanup_expired(&self) -> Result<usize, String> {
        let now = unix_millis()?;
        let expired = {
            let mut artifacts = self.artifacts.lock().map_err(|error| error.to_string())?;
            let tokens = artifacts
                .iter()
                .filter(|(_, entry)| entry.expires_at <= now)
                .map(|(token, _)| token.clone())
                .collect::<Vec<_>>();
            tokens
                .into_iter()
                .filter_map(|token| artifacts.remove(&token))
                .collect::<Vec<_>>()
        };
        for entry in &expired {
            remove_file_if_present(&entry.path)?;
        }
        Ok(expired.len())
    }
}

impl CheckedOutTemporary {
    pub fn read(&self) -> Result<Vec<u8>, String> {
        fs::read(&self.entry.path).map_err(|error| error.to_string())
    }

    pub fn mime_type(&self) -> &str {
        &self.entry.mime_type
    }

    pub fn size_bytes(&self) -> usize {
        self.entry.size_bytes
    }

    pub fn complete(mut self) -> Result<(), String> {
        self.completed = true;
        remove_file_if_present(&self.entry.path)
    }
}

impl Drop for CheckedOutTemporary {
    fn drop(&mut self) {
        if self.completed || self.entry.expires_at <= unix_millis().unwrap_or(i64::MAX) {
            return;
        }
        if let Ok(mut artifacts) = self.store.artifacts.lock() {
            artifacts.insert(self.token.clone(), self.entry.clone());
        }
    }
}

fn remove_file_if_present(path: &PathBuf) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn unix_millis() -> Result<i64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestRoot(PathBuf);

    impl Drop for TestRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn store() -> (TestRoot, NativeTemporaryStore) {
        let root = std::env::temp_dir().join(format!("picbind-native-test-{}", Uuid::new_v4()));
        let store = NativeTemporaryStore::open(root.clone()).unwrap();
        (TestRoot(root), store)
    }

    #[test]
    fn release_is_idempotent() {
        let (_root, store) = store();
        let artifact = store.create("image/png", &[1, 2, 3]).unwrap();
        store.release(&artifact.token).unwrap();
        store.release(&artifact.token).unwrap();
    }

    #[test]
    fn failed_checkout_is_restored_until_completed() {
        let (_root, store) = store();
        let artifact = store.create("image/png", &[1, 2, 3]).unwrap();
        drop(store.checkout(&artifact.token).unwrap());
        let checkout = store.checkout(&artifact.token).unwrap();
        assert_eq!(checkout.read().unwrap(), [1, 2, 3]);
        checkout.complete().unwrap();
        assert!(store.checkout(&artifact.token).is_err());
    }
}
