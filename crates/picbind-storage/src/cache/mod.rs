#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CacheKind {
    Workspace,
    Preview,
    Source,
    Commit,
    Activity,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CacheRecord {
    pub workspace_id: String,
    pub record_id: String,
    pub kind: CacheKind,
    pub bytes: Vec<u8>,
    pub created_at: i64,
    pub accessed_at: i64,
    pub expires_at: Option<i64>,
}

pub fn retain_valid(records: &mut Vec<CacheRecord>, now: i64, max_records: usize) {
    records.retain(|record| record.expires_at.is_none_or(|expires| expires > now));
    records.sort_by_key(|record| std::cmp::Reverse(record.accessed_at));
    records.truncate(max_records);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ttl_and_lru_are_applied() {
        let mut values = vec![
            CacheRecord {
                workspace_id: "w".into(),
                record_id: "old".into(),
                kind: CacheKind::Preview,
                bytes: vec![],
                created_at: 0,
                accessed_at: 1,
                expires_at: Some(5),
            },
            CacheRecord {
                workspace_id: "w".into(),
                record_id: "new".into(),
                kind: CacheKind::Preview,
                bytes: vec![],
                created_at: 0,
                accessed_at: 9,
                expires_at: Some(20),
            },
        ];
        retain_valid(&mut values, 10, 1);
        assert_eq!(values[0].record_id, "new");
    }
}
