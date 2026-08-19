use crate::cache::{CacheKind, CacheRecord};

pub trait WorkspaceRepository {
    type Error;
    fn load_workspace(&self, workspace_id: &str) -> Result<Option<Vec<u8>>, Self::Error>;
    fn save_workspace(&self, workspace_id: &str, value: &[u8]) -> Result<(), Self::Error>;
}

pub trait WorkspaceContentRepository {
    type Error;
    fn get(
        &self,
        workspace_id: &str,
        kind: CacheKind,
        record_id: &str,
    ) -> Result<Option<CacheRecord>, Self::Error>;
    fn put(&self, record: CacheRecord) -> Result<(), Self::Error>;
    fn remove(
        &self,
        workspace_id: &str,
        kind: CacheKind,
        record_id: &str,
    ) -> Result<(), Self::Error>;
    fn purge_expired(&self, now: i64) -> Result<usize, Self::Error>;
}

// Web implementations map this contract to IndexedDB/OPFS. Desktop implementations
// map it to the app data database and filesystem; neither uses D1 for image content.
