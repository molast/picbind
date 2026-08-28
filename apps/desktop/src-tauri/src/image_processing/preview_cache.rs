use serde::Serialize;
use std::{
    collections::HashMap,
    fs::{self, File},
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use uuid::Uuid;

#[derive(Clone)]
pub struct NativePreviewCache {
    root: Arc<PathBuf>,
    entries: Arc<Mutex<HashMap<String, PreviewCacheEntry>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewCacheArtifactResponse {
    pub token: String,
    pub mime_type: &'static str,
    pub size_bytes: usize,
}

#[derive(Clone)]
struct PreviewCacheEntry {
    path: PathBuf,
    size_bytes: usize,
}

pub struct PreviewCacheFile {
    pub bytes: Vec<u8>,
    pub mime_type: &'static str,
}

impl NativePreviewCache {
    pub fn open(app_data_root: PathBuf) -> Result<Self, String> {
        let root = app_data_root.join("temp/image-preview-cache");
        if root.exists() {
            fs::remove_dir_all(&root).map_err(|error| error.to_string())?;
        }
        fs::create_dir_all(&root).map_err(|error| error.to_string())?;
        Ok(Self {
            root: Arc::new(root),
            entries: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    pub fn create(&self, bytes: &[u8]) -> Result<PreviewCacheArtifactResponse, String> {
        if bytes.is_empty() {
            return Err("Preview cache output is empty".to_string());
        }
        let token = Uuid::new_v4().to_string();
        let final_path = self.root.join(format!("{token}.webp"));
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

        let entry = PreviewCacheEntry {
            path: final_path,
            size_bytes: bytes.len(),
        };
        self.entries
            .lock()
            .map_err(|_| "Preview cache is unavailable".to_string())?
            .insert(token.clone(), entry);
        Ok(PreviewCacheArtifactResponse {
            token,
            mime_type: "image/webp",
            size_bytes: bytes.len(),
        })
    }

    pub fn read(&self, token: &str) -> Result<PreviewCacheFile, String> {
        let entry = self
            .entries
            .lock()
            .map_err(|_| "Preview cache is unavailable".to_string())?
            .get(token)
            .cloned()
            .ok_or_else(|| "Preview cache file was not found".to_string())?;
        let bytes = fs::read(&entry.path).map_err(|error| error.to_string())?;
        if bytes.len() != entry.size_bytes {
            return Err("Preview cache file size changed".to_string());
        }
        Ok(PreviewCacheFile {
            bytes,
            mime_type: "image/webp",
        })
    }

    pub fn release(&self, token: &str) -> Result<(), String> {
        let entry = self
            .entries
            .lock()
            .map_err(|_| "Preview cache is unavailable".to_string())?
            .remove(token);
        if let Some(entry) = entry {
            match fs::remove_file(entry.path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.to_string()),
            }
        }
        Ok(())
    }
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

    fn cache() -> (TestRoot, NativePreviewCache) {
        let root = std::env::temp_dir().join(format!("picbind-preview-test-{}", Uuid::new_v4()));
        let cache = NativePreviewCache::open(root.clone()).unwrap();
        (TestRoot(root), cache)
    }

    #[test]
    fn creates_reads_and_releases_a_preview_file() {
        let (_root, cache) = cache();
        let artifact = cache.create(&[1, 2, 3]).unwrap();
        assert_eq!(cache.read(&artifact.token).unwrap().bytes, [1, 2, 3]);
        cache.release(&artifact.token).unwrap();
        cache.release(&artifact.token).unwrap();
        assert!(cache.read(&artifact.token).is_err());
    }
}
