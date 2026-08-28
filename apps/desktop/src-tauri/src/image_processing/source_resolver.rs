use std::sync::Arc;

use crate::storage::NativeImageStore;

use super::{
    commands::NativeSource,
    memory::{NativeImageMemory, NativeMemorySource},
};

pub enum ResolvedSource {
    Bytes(Vec<u8>),
    Memory(Arc<NativeMemorySource>),
}

impl ResolvedSource {
    pub fn bytes(&self) -> &[u8] {
        match self {
            Self::Bytes(bytes) => bytes,
            Self::Memory(source) => source.bytes(),
        }
    }

    pub fn memory(&self) -> Option<&NativeMemorySource> {
        match self {
            Self::Memory(source) => Some(source),
            Self::Bytes(_) => None,
        }
    }
}

pub fn resolve_source(
    store: &NativeImageStore,
    memory: &NativeImageMemory,
    source: &NativeSource,
    inline: Vec<u8>,
) -> Result<ResolvedSource, (&'static str, String)> {
    match source {
        NativeSource::Inline { cache_key } => {
            if inline.is_empty() {
                Err(("invalidSource", "Inline image data is empty".to_string()))
            } else if let Some(cache_key) = cache_key {
                memory
                    .insert_or_get(cache_key.clone(), inline)
                    .map(ResolvedSource::Memory)
                    .map_err(|error| ("decodeFailed", error))
            } else {
                Ok(ResolvedSource::Bytes(inline))
            }
        }
        NativeSource::Memory { cache_key } => {
            if !inline.is_empty() {
                return Err((
                    "invalidSource",
                    "Cached sources cannot contain inline data".to_string(),
                ));
            }
            memory
                .get(cache_key)
                .map(ResolvedSource::Memory)
                .map_err(|error| ("sourceUnavailable", error))
        }
        NativeSource::Stored {
            scope,
            scope_key,
            id,
            variant,
            revision,
        } => {
            if !inline.is_empty() {
                return Err((
                    "invalidSource",
                    "Stored sources cannot contain inline data".to_string(),
                ));
            }
            let record = store
                .get(scope, scope_key, id)
                .map_err(|error| ("sourceUnavailable", error))?
                .ok_or_else(|| {
                    (
                        "sourceUnavailable",
                        "Stored image was not found".to_string(),
                    )
                })?;
            if record.revision != *revision {
                return Err((
                    "sourceChanged",
                    "Stored image revision has changed".to_string(),
                ));
            }
            store
                .read(scope, scope_key, id, variant)
                .map(ResolvedSource::Bytes)
                .map_err(|error| ("sourceUnavailable", error))
        }
    }
}
