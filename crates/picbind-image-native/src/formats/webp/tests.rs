#[test]
fn webp_uses_a_riff_container() {
    let bytes = super::encode(&crate::tests::source_image(), 80).unwrap();
    assert!(bytes.starts_with(b"RIFF"));
    assert!(bytes.windows(4).any(|bytes| bytes == b"WEBP"));
}
