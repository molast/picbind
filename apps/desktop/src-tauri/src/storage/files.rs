use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::Write,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub struct StoredFile {
    pub relative_path: String,
    pub created: bool,
}

#[derive(Debug)]
pub struct ManagedFile {
    pub relative_path: String,
    pub byte_size: u64,
}

pub fn store(
    root: &Path,
    category: &str,
    mime_type: &str,
    bytes: &[u8],
) -> Result<StoredFile, String> {
    let hash = format!("{:x}", Sha256::digest(bytes));
    let extension = extension_for_mime(mime_type);
    let relative_path = format!("{category}/{hash}.{extension}");
    let destination = resolve(root, &relative_path)?;

    if destination.exists() {
        return Ok(StoredFile {
            relative_path,
            created: false,
        });
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temp_dir = root.join("temp");
    fs::create_dir_all(&temp_dir).map_err(|error| error.to_string())?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let temp_path = temp_dir.join(format!("{hash}-{nonce}.tmp"));

    let write_result = (|| -> Result<(), String> {
        let mut file = File::create(&temp_path).map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        match fs::rename(&temp_path, &destination) {
            Ok(()) => Ok(()),
            Err(_) if destination.exists() => {
                fs::remove_file(&temp_path).map_err(|error| error.to_string())?;
                Ok(())
            }
            Err(error) => Err(error.to_string()),
        }
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result?;

    Ok(StoredFile {
        relative_path,
        created: true,
    })
}

pub fn read(root: &Path, relative_path: &str) -> Result<Vec<u8>, String> {
    fs::read(resolve(root, relative_path)?).map_err(|error| error.to_string())
}

pub fn remove(root: &Path, relative_path: &str) -> Result<(), String> {
    let path = resolve(root, relative_path)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

pub fn metadata(root: &Path, relative_path: &str) -> Result<Option<ManagedFile>, String> {
    let path = resolve(root, relative_path)?;
    match fs::metadata(path) {
        Ok(metadata) => Ok(Some(ManagedFile {
            relative_path: relative_path.to_string(),
            byte_size: metadata.len(),
        })),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub fn list(root: &Path, categories: &[&str]) -> Result<Vec<ManagedFile>, String> {
    let mut output = Vec::new();
    for category in categories {
        let directory = resolve(root, category)?;
        if !directory.exists() {
            continue;
        }
        collect_files(root, &directory, &mut output)?;
    }
    Ok(output)
}

fn collect_files(
    root: &Path,
    directory: &Path,
    output: &mut Vec<ManagedFile>,
) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_dir() {
            collect_files(root, &path, output)?;
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        let relative = path
            .strip_prefix(root)
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        output.push(ManagedFile {
            relative_path: relative,
            byte_size: metadata.len(),
        });
    }
    Ok(())
}

fn resolve(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("invalid image storage path".to_string());
    }
    Ok(root.join(relative))
}

fn extension_for_mime(mime_type: &str) -> &'static str {
    match mime_type {
        "image/avif" => "avif",
        "image/gif" => "gif",
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/svg+xml" => "svg",
        "image/webp" => "webp",
        _ => "bin",
    }
}
