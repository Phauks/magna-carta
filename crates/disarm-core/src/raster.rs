//! Pictures: decoded to pixels and encoded afresh in the same format. Everything that is not the
//! picture goes with the old encoding: metadata, comments, colour profiles, and any bytes riding
//! behind the image (the usual way one file hides inside another).

use std::io::Cursor;

use image::{AnimationDecoder, DynamicImage, ImageFormat, ImageReader};

use crate::limits::Limits;
use crate::report::{DisarmReport, RemovalKind};
use crate::{DisarmError, Disarmed, DocumentKind};

pub(crate) fn identify(bytes: &[u8]) -> Option<DocumentKind> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(DocumentKind::Jpeg)
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(DocumentKind::Png)
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(DocumentKind::Gif)
    } else if bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*") {
        Some(DocumentKind::Tiff)
    } else if bytes.starts_with(b"BM") && bytes.len() > 26 {
        Some(DocumentKind::Bmp)
    } else if bytes.len() > 12
        && bytes.starts_with(b"RIFF")
        && bytes.get(8..12) == Some(b"WEBP".as_slice())
    {
        Some(DocumentKind::Webp)
    } else {
        None
    }
}

fn format_of(kind: DocumentKind) -> Option<ImageFormat> {
    match kind {
        DocumentKind::Jpeg => Some(ImageFormat::Jpeg),
        DocumentKind::Png => Some(ImageFormat::Png),
        DocumentKind::Gif => Some(ImageFormat::Gif),
        DocumentKind::Tiff => Some(ImageFormat::Tiff),
        DocumentKind::Bmp => Some(ImageFormat::Bmp),
        DocumentKind::Webp => Some(ImageFormat::WebP),
        _ => None,
    }
}

pub(crate) fn disarm(
    bytes: &[u8],
    kind: DocumentKind,
    limits: &Limits,
) -> Result<Disarmed, DisarmError> {
    let format = format_of(kind).ok_or(DisarmError::Unsupported)?;
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(decode_limits_for(limits));
    let (width, height) = reader
        .into_dimensions()
        .map_err(|_| DisarmError::Malformed)?;
    if u64::from(width).saturating_mul(u64::from(height)) > limits.max_image_pixels {
        return Err(DisarmError::LimitExceeded);
    }

    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(decode_limits_for(limits));
    let picture = reader.decode().map_err(|error| match error {
        image::ImageError::Limits(_) => DisarmError::LimitExceeded,
        image::ImageError::Unsupported(_) => DisarmError::Unsupported,
        _ => DisarmError::Malformed,
    })?;

    let mut report = DisarmReport::new();
    if carries_extra(bytes, kind) {
        report.add(RemovalKind::PictureMetadata, 1);
    }
    if kind == DocumentKind::Gif && is_animated_gif(bytes) {
        report.add(RemovalKind::AnimationFlattened, 1);
    }

    let output = encode(picture, format)?;
    verify(&output, format)?;
    Ok(Disarmed {
        bytes: output,
        kind,
        report,
        output_extension: None,
    })
}

fn decode_limits_for(limits: &Limits) -> image::Limits {
    let mut decode_limits = image::Limits::default();
    decode_limits.max_alloc = Some(limits.max_image_pixels.saturating_mul(8));
    decode_limits
}

fn encode(picture: DynamicImage, format: ImageFormat) -> Result<Vec<u8>, DisarmError> {
    let mut output = Cursor::new(Vec::new());
    match format {
        ImageFormat::Jpeg => {
            // JPEG carries no transparency; the encoder refuses an alpha channel outright.
            let opaque = DynamicImage::ImageRgb8(picture.to_rgb8());
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, 92);
            opaque
                .write_with_encoder(encoder)
                .map_err(|_| DisarmError::Write)?;
        }
        ImageFormat::Gif | ImageFormat::Bmp => {
            DynamicImage::ImageRgba8(picture.to_rgba8())
                .write_to(&mut output, format)
                .map_err(|_| DisarmError::Write)?;
        }
        ImageFormat::WebP => {
            DynamicImage::ImageRgba8(picture.to_rgba8())
                .write_to(&mut output, format)
                .map_err(|_| DisarmError::Write)?;
        }
        _ => picture
            .write_to(&mut output, format)
            .map_err(|_| DisarmError::Write)?,
    }
    Ok(output.into_inner())
}

/// The copy must itself decode as the same format.
fn verify(output: &[u8], format: ImageFormat) -> Result<(), DisarmError> {
    ImageReader::with_format(Cursor::new(output), format)
        .into_dimensions()
        .map(|_| ())
        .map_err(|_| DisarmError::VerificationFailed)
}

fn is_animated_gif(bytes: &[u8]) -> bool {
    image::codecs::gif::GifDecoder::new(Cursor::new(bytes))
        .map(|decoder| decoder.into_frames().take(2).count() > 1)
        .unwrap_or(false)
}

/// Whether the original carried anything beyond the picture: metadata segments or chunks, or bytes
/// after the format's end marker. Only JPEG and PNG are read this closely; for the others the
/// rebuild still drops whatever was there, it just is not itemized.
fn carries_extra(bytes: &[u8], kind: DocumentKind) -> bool {
    match kind {
        DocumentKind::Jpeg => jpeg_carries_extra(bytes),
        DocumentKind::Png => png_carries_extra(bytes),
        _ => false,
    }
}

fn jpeg_carries_extra(bytes: &[u8]) -> bool {
    let trailing = !bytes.ends_with(&[0xFF, 0xD9]);
    let mut position = 2_usize;
    while let (Some(&0xFF), Some(&marker)) =
        (bytes.get(position), bytes.get(position.saturating_add(1)))
    {
        // Application segments other than the plain JFIF header, and comments.
        if (0xE1..=0xEF).contains(&marker) || marker == 0xFE {
            return true;
        }
        if marker == 0xDA {
            break;
        }
        let length = match (
            bytes.get(position.saturating_add(2)),
            bytes.get(position.saturating_add(3)),
        ) {
            (Some(&high), Some(&low)) => usize::from(u16::from_be_bytes([high, low])),
            _ => break,
        };
        position = position.saturating_add(2).saturating_add(length);
    }
    trailing
}

fn png_carries_extra(bytes: &[u8]) -> bool {
    const METADATA: [&[u8; 4]; 6] = [b"tEXt", b"zTXt", b"iTXt", b"eXIf", b"iCCP", b"tIME"];
    let mut position = 8_usize;
    loop {
        let header = bytes.get(position..position.saturating_add(8));
        let Some(header) = header else {
            return false;
        };
        let (length, kind) = header.split_at(4);
        let length = u32::from_be_bytes([length[0], length[1], length[2], length[3]]);
        let Ok(length) = usize::try_from(length) else {
            return false;
        };
        if METADATA.iter().any(|metadata| metadata.as_slice() == kind) {
            return true;
        }
        let next = position.saturating_add(12).saturating_add(length);
        if kind == b"IEND" {
            return next < bytes.len();
        }
        position = next;
    }
}
