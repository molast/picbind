pub(crate) mod decoder;
pub(crate) mod encoder;

pub(crate) use decoder::decode;
pub(crate) use encoder::{encode, encode_quantized_rgba};

#[cfg(test)]
mod tests;
