use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Instant,
};

use picbind_image_native::{NativeDecodedImage, NativeImageDimensions, decode_image};

const MAX_CACHED_SOURCES: usize = 4;
const MAX_CACHED_BYTES: usize = 768 * 1024 * 1024;
const PREVIEW_CACHE_BOUNDS: NativeImageDimensions = NativeImageDimensions {
    width: 960,
    height: 720,
};

pub struct NativeMemorySource {
    bytes: Arc<[u8]>,
    decoded: NativeDecodedImage,
}

impl NativeMemorySource {
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn decoded(&self) -> &NativeDecodedImage {
        &self.decoded
    }

    fn estimated_size_bytes(&self) -> usize {
        self.bytes.len() + self.decoded.estimated_size_bytes()
    }
}

struct CacheEntry {
    source: Arc<NativeMemorySource>,
    last_accessed: Instant,
}

#[derive(Clone, Default)]
pub struct NativeImageMemory {
    entries: Arc<Mutex<HashMap<String, CacheEntry>>>,
}

impl NativeImageMemory {
    pub fn get(&self, key: &str) -> Result<Arc<NativeMemorySource>, String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "Image memory is unavailable")?;
        let entry = entries
            .get_mut(key)
            .ok_or_else(|| "Cached collaboration image was not found".to_string())?;
        entry.last_accessed = Instant::now();
        Ok(Arc::clone(&entry.source))
    }

    pub fn insert_or_get(
        &self,
        key: String,
        bytes: Vec<u8>,
    ) -> Result<Arc<NativeMemorySource>, String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "Image memory is unavailable")?;
        if let Some(entry) = entries.get_mut(&key) {
            entry.last_accessed = Instant::now();
            return Ok(Arc::clone(&entry.source));
        }
        // Keep registration serialized so concurrent first-use previews cannot
        // decode the same authoritative source more than once.
        let decoded = decode_image(&bytes)
            .map_err(|error| error.to_string())?
            .into_preview(PREVIEW_CACHE_BOUNDS);
        let source = Arc::new(NativeMemorySource {
            bytes: Arc::from(bytes),
            decoded,
        });
        entries.insert(
            key.clone(),
            CacheEntry {
                source: Arc::clone(&source),
                last_accessed: Instant::now(),
            },
        );
        evict_over_limit(&mut entries, &key);
        Ok(source)
    }

    pub fn release(&self, key: &str) -> Result<bool, String> {
        self.entries
            .lock()
            .map(|mut entries| entries.remove(key).is_some())
            .map_err(|_| "Image memory is unavailable".to_string())
    }
}

fn evict_over_limit(entries: &mut HashMap<String, CacheEntry>, protected_key: &str) {
    while entries.len() > MAX_CACHED_SOURCES || total_size(entries) > MAX_CACHED_BYTES {
        let Some(oldest_key) = entries
            .iter()
            .filter(|(key, _)| key.as_str() != protected_key)
            .min_by_key(|(_, entry)| entry.last_accessed)
            .map(|(key, _)| key.clone())
        else {
            break;
        };
        entries.remove(&oldest_key);
    }
}

fn total_size(entries: &HashMap<String, CacheEntry>) -> usize {
    entries
        .values()
        .map(|entry| entry.source.estimated_size_bytes())
        .sum()
}

#[cfg(test)]
mod tests {
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    use super::NativeImageMemory;

    fn png() -> Vec<u8> {
        STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
            .unwrap()
    }

    #[test]
    fn reuses_and_releases_a_decoded_source() {
        let memory = NativeImageMemory::default();
        let first = memory.insert_or_get("image".into(), png()).unwrap();
        let second = memory.get("image").unwrap();
        assert!(std::sync::Arc::ptr_eq(&first, &second));
        assert_eq!(first.decoded().width(), 1);
        assert!(memory.release("image").unwrap());
        assert!(memory.get("image").is_err());
    }
}
