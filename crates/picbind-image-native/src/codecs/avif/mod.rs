pub(crate) mod decoder;
pub(crate) mod encoder;

pub(crate) use decoder::decode;
pub(crate) use encoder::{PreparedAvifPixels, encode};

#[cfg(test)]
mod tests;
