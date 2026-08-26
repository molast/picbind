use crate::{NativeImageDimensions, create_share_assets, inspect};

#[test]
fn creates_independent_placeholder_and_webp_thumbnail() {
    let image = image::RgbaImage::from_pixel(80, 40, image::Rgba([32, 96, 160, 255]));
    let mut source = Vec::new();
    image::DynamicImage::ImageRgba8(image)
        .write_to(
            &mut std::io::Cursor::new(&mut source),
            image::ImageFormat::Png,
        )
        .unwrap();
    let assets = create_share_assets(
        &source,
        None,
        NativeImageDimensions {
            width: 32,
            height: 32,
        },
    )
    .unwrap();
    assert_eq!(assets.placeholder.width, 80);
    assert_eq!(assets.placeholder.height, 40);
    assert_eq!(assets.placeholder.dominant_color, "#2060a0");
    assert_eq!(assets.placeholder.blur_hash.len(), 28);
    let metadata = inspect(&assets.thumbnail).unwrap();
    assert_eq!((metadata.width, metadata.height), (32, 16));
}
