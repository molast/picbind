use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferManifest {
    pub request_id: String,
    pub image_id: String,
    pub mime_type: String,
    pub total_chunks: u32,
    pub total_bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferChunk {
    pub request_id: String,
    pub index: u32,
    pub bytes: Vec<u8>,
}

pub struct TransferAssembler {
    manifest: TransferManifest,
    chunks: Vec<Option<Vec<u8>>>,
    received: u64,
}

impl TransferAssembler {
    pub fn new(manifest: TransferManifest) -> Result<Self, &'static str> {
        if manifest.request_id.is_empty()
            || manifest.total_chunks == 0
            || manifest.total_chunks > 65_536
            || manifest.total_bytes == 0
        {
            return Err("invalid transfer manifest");
        }
        let count = manifest.total_chunks as usize;
        Ok(Self {
            manifest,
            chunks: vec![None; count],
            received: 0,
        })
    }
    pub fn push(&mut self, chunk: TransferChunk) -> Result<(), &'static str> {
        if chunk.request_id != self.manifest.request_id || chunk.index >= self.manifest.total_chunks
        {
            return Err("invalid transfer chunk");
        }
        let slot = &mut self.chunks[chunk.index as usize];
        if slot.is_none() {
            self.received += chunk.bytes.len() as u64;
            *slot = Some(chunk.bytes);
        }
        if self.received > self.manifest.total_bytes {
            return Err("transfer exceeds declared size");
        }
        Ok(())
    }
    pub fn assemble(self) -> Result<Vec<u8>, &'static str> {
        if self.received != self.manifest.total_bytes || self.chunks.iter().any(Option::is_none) {
            return Err("incomplete transfer");
        }
        Ok(self.chunks.into_iter().flatten().flatten().collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_chunks_never_assemble() {
        let m = TransferManifest {
            request_id: "r".into(),
            image_id: "i".into(),
            mime_type: "image/png".into(),
            total_chunks: 2,
            total_bytes: 2,
            sha256: "digest".into(),
        };
        let mut a = TransferAssembler::new(m).unwrap();
        a.push(TransferChunk {
            request_id: "r".into(),
            index: 0,
            bytes: vec![1],
        })
        .unwrap();
        assert!(a.assemble().is_err());
    }
}
