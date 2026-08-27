pub(crate) mod decoder;
pub(crate) mod encoder;

pub(crate) use decoder::decode;
pub(crate) use encoder::{encode, encode_rgb, prepare_rgb};

#[cfg(test)]
mod tests;
