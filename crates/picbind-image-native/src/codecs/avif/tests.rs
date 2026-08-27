#[test]
fn avif_uses_an_avif_brand() {
    let bytes = super::encode(&crate::tests::source_image(), 80).unwrap();
    assert!(bytes.windows(8).any(|bytes| bytes == b"ftypavif"));
}
