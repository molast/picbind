use std::collections::HashSet;

use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::{NativeImageDimensions, NativeImageError};

use super::NativeParameterDocument;

const MAX_OPERATIONS: usize = 100;
const MAX_COLLECTION_ITEMS: usize = 10_000;
const MAX_OBJECT_DEPTH: usize = 12;

pub(super) fn validate_document(
    document: &NativeParameterDocument,
) -> Result<(), NativeImageError> {
    if document.version != 1 {
        return invalid("unsupported parameter document version");
    }
    if document.operations.len() > MAX_OPERATIONS {
        return invalid("parameter document supports at most 100 operations");
    }
    let mut ids = HashSet::with_capacity(document.operations.len());
    for operation in &document.operations {
        if operation.id.is_empty() {
            return invalid("operation id is required");
        }
        if operation.user_id.is_empty() {
            return invalid("operation userId is required");
        }
        if !operation.time.is_finite() {
            return invalid("operation time must be finite");
        }
        if !operation.params.is_object() {
            return invalid("operation params must be an object");
        }
        validate_value(&operation.params, 0)?;
        if !ids.insert(operation.id.as_str()) {
            return invalid("operation ids must be unique");
        }
    }
    Ok(())
}

pub(super) fn parse<T: DeserializeOwned>(
    params: &Value,
    operation: &str,
) -> Result<T, NativeImageError> {
    serde_json::from_value(params.clone()).map_err(|error| {
        NativeImageError::InvalidParameters(format!("invalid {operation} parameters: {error}"))
    })
}

pub(super) fn dimensions(params: &Value) -> Result<NativeImageDimensions, NativeImageError> {
    #[derive(serde::Deserialize)]
    struct Dimensions {
        width: u32,
        height: u32,
    }
    let value: Dimensions = parse(params, "resize")?;
    Ok(NativeImageDimensions {
        width: value.width,
        height: value.height,
    })
}

pub(super) fn invalid<T>(message: impl Into<String>) -> Result<T, NativeImageError> {
    Err(NativeImageError::InvalidParameters(message.into()))
}

fn validate_value(value: &Value, depth: usize) -> Result<(), NativeImageError> {
    if depth > MAX_OBJECT_DEPTH {
        return invalid("operation parameters are too deeply nested");
    }
    match value {
        Value::Array(values) => {
            if values.len() > MAX_COLLECTION_ITEMS {
                return invalid("operation parameter array is too large");
            }
            for value in values {
                validate_value(value, depth + 1)?;
            }
        }
        Value::Object(values) => {
            if values.len() > MAX_COLLECTION_ITEMS {
                return invalid("operation parameter object is too large");
            }
            for value in values.values() {
                validate_value(value, depth + 1)?;
            }
        }
        _ => {}
    }
    Ok(())
}
