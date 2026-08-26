use crate::storage::NativeImageStore;

use super::commands::NativeSource;

pub fn resolve_source(
    store: &NativeImageStore,
    source: &NativeSource,
    inline: Vec<u8>,
) -> Result<Vec<u8>, (&'static str, String)> {
    match source {
        NativeSource::Inline => {
            if inline.is_empty() {
                Err(("invalidSource", "Inline image data is empty".to_string()))
            } else {
                Ok(inline)
            }
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
                .map_err(|error| ("sourceUnavailable", error))
        }
    }
}
