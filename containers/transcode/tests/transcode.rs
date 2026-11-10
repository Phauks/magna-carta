//! End-to-end conversions of the fixtures, read back with the engine's own demuxer and decoded with
//! the pure-Rust H.264 decoder to prove the rendition plays.

use std::path::{Path, PathBuf};

use magna_carta_transcode::demux::{self, AudioCodec, Media, SampleReader, VideoCodec};
use magna_carta_transcode::transcode::{transcode, Report};
use magna_carta_transcode::TranscodeError;

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn convert(name: &str) -> Result<(Report, Media, tempfile::TempDir), TranscodeError> {
    let working = tempfile::tempdir().expect("working directory");
    let output = working.path().join("out.mp4");
    let report = transcode(&fixture(name), working.path(), &output)?;
    let spool = working.path().join("read-back");
    std::fs::create_dir_all(&spool).expect("read-back directory");
    let media = demux::open(&output, &spool)?;
    Ok((report, media, working))
}

/// Decode every picture of the rendition's video track and count them.
fn decoded_pictures(media: &Media) -> usize {
    let record = &media.video.configuration;
    let length_size = usize::from(record[4] & 3) + 1;
    let mut stream = Vec::new();
    let mut at = 6usize;
    for _ in 0..(record[5] & 0x1f) {
        let length = usize::from(u16::from_be_bytes([record[at], record[at + 1]]));
        stream.extend_from_slice(&[0, 0, 0, 1]);
        stream.extend_from_slice(&record[at + 2..at + 2 + length]);
        at += 2 + length;
    }
    let count = record[at];
    at += 1;
    for _ in 0..count {
        let length = usize::from(u16::from_be_bytes([record[at], record[at + 1]]));
        stream.extend_from_slice(&[0, 0, 0, 1]);
        stream.extend_from_slice(&record[at + 2..at + 2 + length]);
        at += 2 + length;
    }
    let mut reader = SampleReader::open(&media.video.data).expect("reader");
    let mut buffer = Vec::new();
    for sample in &media.video.samples {
        reader.read(sample, &mut buffer).expect("sample");
        let mut position = 0usize;
        while position + length_size <= buffer.len() {
            let length = buffer[position..position + length_size]
                .iter()
                .fold(0usize, |value, byte| (value << 8) | usize::from(*byte));
            position += length_size;
            stream.extend_from_slice(&[0, 0, 0, 1]);
            stream.extend_from_slice(&buffer[position..position + length]);
            position += length;
        }
    }
    let mut decoder = rust_h264::decoder::OrderedDecoder::new();
    let mut pictures = 0;
    for unit in rust_h264::nal::parse_annex_b(&stream) {
        pictures += decoder
            .decode_nal(&unit)
            .expect("the rendition decodes")
            .len();
    }
    pictures + decoder.flush().len()
}

fn starts_with_movie_header(path: &Path) -> bool {
    let bytes = std::fs::read(path).expect("rendition");
    let first_box = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
    &bytes[4..8] == b"ftyp" && &bytes[first_box + 4..first_box + 8] == b"moov"
}

#[test]
fn an_h264_and_aac_mp4_is_copied_untouched() {
    let (report, media, working) = convert("h264-aac.mp4").unwrap();
    assert!(report.video_copied);
    assert_eq!(report.audio, Some(true));
    assert_eq!(media.video.codec, VideoCodec::H264);
    assert_eq!(media.video.samples.len(), 10);
    assert_eq!(decoded_pictures(&media), 10);
    assert_eq!(
        media.audio.as_ref().map(|audio| audio.codec),
        Some(AudioCodec::Aac)
    );
    assert!(starts_with_movie_header(&working.path().join("out.mp4")));
}

#[test]
fn quicktime_pcm_sound_is_encoded_as_aac() {
    let (report, media, _working) = convert("h264-pcm.mov").unwrap();
    assert!(report.video_copied);
    assert_eq!(report.audio, Some(false));
    let audio = media.audio.expect("sound");
    assert_eq!(audio.codec, AudioCodec::Aac);
    assert_eq!(audio.sample_rate, 16000);
    // One second at 16 kHz is about 16 frames of 1024, plus the encoder's priming frame.
    assert!(
        (16..=18).contains(&audio.samples.len()),
        "{}",
        audio.samples.len()
    );
}

#[test]
fn ten_bit_four_two_two_h264_with_mp3_is_re_encoded() {
    let (report, media, _working) = convert("h264-high422-mp3.mp4").unwrap();
    assert!(!report.video_copied);
    assert_eq!(report.audio, Some(false));
    assert_eq!((report.width, report.height), (160, 96));
    assert_eq!(decoded_pictures(&media), 10);
    assert_eq!(media.audio.map(|audio| audio.codec), Some(AudioCodec::Aac));
}

#[test]
fn matroska_hevc_ten_bit_with_flac_becomes_h264_and_aac() {
    let (report, media, _working) = convert("hevc10-flac.mkv").unwrap();
    assert!(!report.video_copied);
    assert_eq!(media.video.codec, VideoCodec::H264);
    assert_eq!(decoded_pictures(&media), 10);
    let audio = media.audio.expect("sound");
    assert_eq!(
        (audio.codec, audio.sample_rate, audio.channels),
        (AudioCodec::Aac, 22050, 1)
    );
}

#[test]
fn a_rotated_phone_video_keeps_its_rotation() {
    let (_report, media, working) = convert("hevc-rotated.mp4").unwrap();
    let source = demux::open(&fixture("hevc-rotated.mp4"), working.path()).unwrap();
    assert_ne!(source.video.matrix, demux::IDENTITY_MATRIX);
    assert_eq!(media.video.matrix, source.video.matrix);
}

#[test]
fn sound_with_no_rust_decoder_is_refused_rather_than_dropped() {
    let error = convert("h264-ac3.mkv").unwrap_err();
    assert!(
        matches!(error, TranscodeError::Unsupported(ref message) if message.contains("A_AC3")),
        "{error}"
    );
}

#[test]
fn a_truncated_file_is_malformed_not_a_crash() {
    let bytes = std::fs::read(fixture("h264-aac.mp4")).unwrap();
    let working = tempfile::tempdir().unwrap();
    let source = working.path().join("cut.mp4");
    // The movie header comes last in this fixture, so keep the start and the header but cut the media.
    let moov = bytes
        .windows(4)
        .position(|window| window == b"moov")
        .unwrap()
        - 4;
    let mut cut = bytes[..64].to_vec();
    cut.extend_from_slice(&bytes[moov..]);
    std::fs::write(&source, &cut).unwrap();
    let result = transcode(&source, working.path(), &working.path().join("out.mp4"));
    assert!(
        matches!(result, Err(TranscodeError::Malformed(_))),
        "{result:?}"
    );
}

#[test]
fn bytes_that_are_not_a_video_container_are_unsupported() {
    let working = tempfile::tempdir().unwrap();
    let source = working.path().join("notes.txt");
    std::fs::write(&source, b"these are not the bytes of a video").unwrap();
    let result = transcode(&source, working.path(), &working.path().join("out.mp4"));
    assert!(
        matches!(result, Err(TranscodeError::Unsupported(_))),
        "{result:?}"
    );
}
