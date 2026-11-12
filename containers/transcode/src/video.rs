//! The video half of a transcode: copy an H.264 stream every browser already plays, or decode H.264
//! or HEVC and re-encode it as H.264 at the rendition's size.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::sync::mpsc;

use crate::bits::{unescape_rbsp, BitReader};
use crate::demux::{Sample, SampleReader, VideoCodec, VideoTrack};
use crate::error::{Result, TranscodeError};
use crate::h264_sps;
use crate::limits;
use crate::picture::{self, Picture, Samples, SourcePlane};

/// The rendition's video track, its samples already written to the payload file.
#[derive(Debug, Clone)]
pub struct VideoOutput {
    /// The `avcC` record.
    pub configuration: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub timescale: u32,
    pub matrix: [i32; 9],
    pub start_offset: i64,
    /// Offsets are into the payload file passed to [`convert`].
    pub samples: Vec<Sample>,
    /// Whether the source stream was copied rather than re-encoded.
    pub copied: bool,
}

/// The parameter sets and NAL length size of an `avcC` record.
struct AvcConfiguration {
    length_size: usize,
    sequence: Vec<Vec<u8>>,
    picture: Vec<Vec<u8>>,
}

fn parse_avc_configuration(record: &[u8]) -> Result<AvcConfiguration> {
    let bad = || TranscodeError::malformed("the H.264 configuration record is malformed");
    let length_size = usize::from(record.get(4).ok_or_else(bad)? & 3) + 1;
    let mut at = 5usize;
    let read_sets = |count: usize, at: &mut usize| -> Result<Vec<Vec<u8>>> {
        let mut sets = Vec::with_capacity(count);
        for _ in 0..count {
            let length = usize::from(u16::from_be_bytes([
                *record.get(*at).ok_or_else(bad)?,
                *record.get(*at + 1).ok_or_else(bad)?,
            ]));
            sets.push(
                record
                    .get(*at + 2..*at + 2 + length)
                    .ok_or_else(bad)?
                    .to_vec(),
            );
            *at += 2 + length;
        }
        Ok(sets)
    };
    let sequence_count = usize::from(record.get(at).ok_or_else(bad)? & 0x1f);
    at += 1;
    let sequence = read_sets(sequence_count, &mut at)?;
    let picture_count = usize::from(*record.get(at).ok_or_else(bad)?);
    at += 1;
    let picture = read_sets(picture_count, &mut at)?;
    if sequence.is_empty() || picture.is_empty() {
        return Err(TranscodeError::malformed(
            "the H.264 configuration record has no parameter sets",
        ));
    }
    Ok(AvcConfiguration {
        length_size,
        sequence,
        picture,
    })
}

/// The NAL units of an `hvcC` record, each length-prefixed with four bytes, and the sample NAL length.
fn parse_hevc_configuration(record: &[u8]) -> Result<(Vec<u8>, u8)> {
    let bad = || TranscodeError::malformed("the HEVC configuration record is malformed");
    let length_size = (record.get(21).ok_or_else(bad)? & 3) + 1;
    let arrays = *record.get(22).ok_or_else(bad)?;
    let mut out = Vec::new();
    let mut at = 23usize;
    for _ in 0..arrays {
        let count = usize::from(u16::from_be_bytes([
            *record.get(at + 1).ok_or_else(bad)?,
            *record.get(at + 2).ok_or_else(bad)?,
        ]));
        at += 3;
        for _ in 0..count {
            let length = usize::from(u16::from_be_bytes([
                *record.get(at).ok_or_else(bad)?,
                *record.get(at + 1).ok_or_else(bad)?,
            ]));
            let unit = record.get(at + 2..at + 2 + length).ok_or_else(bad)?;
            out.extend_from_slice(&(length as u32).to_be_bytes());
            out.extend_from_slice(unit);
            at += 2 + length;
        }
    }
    Ok((out, length_size))
}

/// Split a length-prefixed sample into its NAL units.
fn length_prefixed_units(sample: &[u8], length_size: usize) -> Result<Vec<&[u8]>> {
    let mut units = Vec::new();
    let mut at = 0usize;
    while at + length_size <= sample.len() {
        let length = sample
            .get(at..at + length_size)
            .unwrap_or_default()
            .iter()
            .fold(0usize, |value, &byte| (value << 8) | usize::from(byte));
        at += length_size;
        let unit = sample
            .get(at..at + length)
            .ok_or_else(|| TranscodeError::malformed("a NAL unit overruns its sample"))?;
        units.push(unit);
        at += length;
    }
    Ok(units)
}

fn check_sequence(info: &h264_sps::SequenceInfo) -> Result<()> {
    let pixels = u64::from(info.width_in_macroblocks) * u64::from(info.height_in_macroblocks) * 256;
    if pixels > limits::MAX_PICTURE_PIXELS {
        return Err(TranscodeError::too_large(
            "the picture is larger than the decoder ceiling",
        ));
    }
    Ok(())
}

/// Whether the stream can go into the rendition untouched.
fn copyable(track: &VideoTrack) -> Result<bool> {
    if track.codec != VideoCodec::H264 {
        return Ok(false);
    }
    let configuration = parse_avc_configuration(&track.configuration)?;
    for set in &configuration.sequence {
        let info = h264_sps::parse(set)?;
        check_sequence(&info)?;
        if !info.plays_in_every_browser() {
            return Ok(false);
        }
    }
    // An in-band sequence parameter set can change the stream mid-way; it rides on a sync sample, so
    // those are the only samples that need reading to hold it to the same rule.
    let mut reader = SampleReader::open(&track.data)?;
    let mut buffer = Vec::new();
    for sample in track.samples.iter().filter(|sample| sample.sync) {
        reader.read(sample, &mut buffer)?;
        for unit in length_prefixed_units(&buffer, configuration.length_size)? {
            if unit.first().is_some_and(|header| header & 0x1f == 7) {
                let info = h264_sps::parse(unit)?;
                check_sequence(&info)?;
                if !info.plays_in_every_browser() {
                    return Ok(false);
                }
            }
        }
    }
    Ok(true)
}

/// Copy, or decode and re-encode, the video track into `payload`, starting at byte `payload_start`.
pub fn convert(
    track: &VideoTrack,
    payload: &mut BufWriter<File>,
    payload_start: u64,
) -> Result<VideoOutput> {
    if copyable(track)? {
        return copy(track, payload, payload_start);
    }
    transcode(track, payload, payload_start)
}

fn copy(
    track: &VideoTrack,
    payload: &mut BufWriter<File>,
    payload_start: u64,
) -> Result<VideoOutput> {
    let mut reader = SampleReader::open(&track.data)?;
    let mut buffer = Vec::new();
    let mut position = payload_start;
    let mut samples = Vec::with_capacity(track.samples.len());
    for sample in &track.samples {
        reader.read(sample, &mut buffer)?;
        payload.write_all(&buffer)?;
        samples.push(Sample {
            offset: position,
            ..*sample
        });
        position += u64::from(sample.size);
    }
    let width = if track.width > 0 { track.width } else { 2 };
    let height = if track.height > 0 { track.height } else { 2 };
    Ok(VideoOutput {
        configuration: track.configuration.clone(),
        width,
        height,
        timescale: track.timescale,
        matrix: track.matrix,
        start_offset: track.start_offset,
        samples,
        copied: true,
    })
}

/// A decoded picture handed from the decoding thread to the encoder.
enum Decoded {
    Picture(Picture),
    Failed(TranscodeError),
}

enum Decoder {
    H264 {
        decoder: Box<rust_h264::decoder::OrderedDecoder>,
        length_size: usize,
    },
    Hevc {
        decoder: Box<rust_h265::Decoder>,
        length_size: u8,
    },
}

fn h264_planes(
    frame: &rust_h264::decoder::Frame,
) -> (SourcePlane<'_>, SourcePlane<'_>, SourcePlane<'_>) {
    let width = frame.width as usize;
    let height = frame.height as usize;
    let chroma_width = frame.chroma_width() as usize;
    let chroma_height = frame.chroma_height() as usize;
    let wide = frame.bit_depth > 8;
    (
        SourcePlane {
            samples: byte_samples(&frame.y, wide),
            width,
            height,
            bit_depth: frame.bit_depth,
        },
        SourcePlane {
            samples: byte_samples(&frame.u, wide),
            width: chroma_width,
            height: chroma_height,
            bit_depth: frame.bit_depth,
        },
        SourcePlane {
            samples: byte_samples(&frame.v, wide),
            width: chroma_width,
            height: chroma_height,
            bit_depth: frame.bit_depth,
        },
    )
}

fn byte_samples(data: &[u8], wide: bool) -> Samples<'_> {
    if wide {
        Samples::LittleEndianWords(data)
    } else {
        Samples::Bytes(data)
    }
}

fn pixel_plane(
    data: &rust_h265::PixelData,
    width: usize,
    height: usize,
    bit_depth: u8,
) -> SourcePlane<'_> {
    SourcePlane {
        samples: match (data.as_u8(), data.as_u16()) {
            (Some(bytes), _) => Samples::Bytes(bytes),
            (_, Some(words)) => Samples::Words(words),
            _ => Samples::Bytes(&[]),
        },
        width,
        height,
        bit_depth,
    }
}

fn hevc_planes(
    frame: &rust_h265::Frame,
) -> Result<(SourcePlane<'_>, SourcePlane<'_>, SourcePlane<'_>)> {
    let width = frame.width as usize;
    let height = frame.height as usize;
    let (chroma_width, chroma_height) = match frame.chroma_format_idc {
        1 => (width.div_ceil(2), height.div_ceil(2)),
        2 => (width.div_ceil(2), height),
        3 => (width, height),
        _ => return Err(TranscodeError::unsupported("monochrome HEVC")),
    };
    let depth = frame.bit_depth;
    Ok((
        pixel_plane(&frame.y, width, height, depth),
        pixel_plane(&frame.u, chroma_width, chroma_height, depth),
        pixel_plane(&frame.v, chroma_width, chroma_height, depth),
    ))
}

/// Decoding runs on its own thread, so the encoder and the decoder each keep a core busy.
fn decode_all(
    track: &VideoTrack,
    sender: &mpsc::SyncSender<Decoded>,
    size: &std::sync::OnceLock<(usize, usize)>,
) -> Result<()> {
    let mut decoder = match track.codec {
        VideoCodec::H264 => {
            let configuration = parse_avc_configuration(&track.configuration)?;
            for set in &configuration.sequence {
                check_sequence(&h264_sps::parse(set)?)?;
            }
            let mut decoder = Box::new(rust_h264::decoder::OrderedDecoder::new());
            let mut stream = Vec::new();
            for set in configuration.sequence.iter().chain(&configuration.picture) {
                stream.extend_from_slice(&[0, 0, 0, 1]);
                stream.extend_from_slice(set);
            }
            for unit in rust_h264::nal::parse_annex_b(&stream) {
                decoder.decode_nal(&unit).map_err(|error| {
                    TranscodeError::malformed(format!("H.264 parameter sets: {error:?}"))
                })?;
            }
            Decoder::H264 {
                decoder,
                length_size: configuration.length_size,
            }
        }
        VideoCodec::Hevc => {
            let (sets, length_size) = parse_hevc_configuration(&track.configuration)?;
            let limits = rust_h265::DecodeLimits {
                max_picture_pixels: limits::MAX_PICTURE_PIXELS,
                ..rust_h265::DecodeLimits::default()
            };
            let threads = std::thread::available_parallelism()
                .map(|count| count.get())
                .unwrap_or(1)
                .clamp(1, 8);
            let mut decoder = Box::new(
                rust_h265::Decoder::with_limits(limits)
                    .with_display_order()
                    .with_threads(threads),
            );
            for unit in rust_h265::parse_hvcc(&sets, 4) {
                decoder.decode_nal(&unit).map_err(|error| {
                    TranscodeError::malformed(format!("HEVC parameter sets: {error:?}"))
                })?;
            }
            Decoder::Hevc {
                decoder,
                length_size,
            }
        }
    };

    let mut reader = SampleReader::open(&track.data)?;
    let mut buffer = Vec::new();
    let mut errors = 0usize;
    let emit = |planes: (SourcePlane<'_>, SourcePlane<'_>, SourcePlane<'_>)| -> Result<bool> {
        let (luma, blue, red) = planes;
        let &(width, height) = size.get_or_init(|| {
            picture::output_size(
                luma.width as u32,
                luma.height as u32,
                limits::MAX_OUTPUT_LONG_SIDE,
                limits::MAX_OUTPUT_SHORT_SIDE,
            )
        });
        let converted = picture::convert(&luma, &blue, &red, width, height)?;
        Ok(sender.send(Decoded::Picture(converted)).is_ok())
    };
    let tolerate = |errors: &mut usize, error: String| -> Result<()> {
        // A damaged slice here and there is concealed by the decoder; a stream that keeps failing
        // is not one the engine should pretend to have converted.
        *errors += 1;
        if *errors > 64 {
            return Err(TranscodeError::malformed(format!(
                "the video stream keeps failing to decode ({error})"
            )));
        }
        Ok(())
    };
    for sample in &track.samples {
        reader.read(sample, &mut buffer)?;
        match &mut decoder {
            Decoder::H264 {
                decoder,
                length_size,
            } => {
                let mut stream = Vec::with_capacity(buffer.len() + 16);
                for unit in length_prefixed_units(&buffer, *length_size)? {
                    if unit.first().is_some_and(|header| header & 0x1f == 7) {
                        check_sequence(&h264_sps::parse(unit)?)?;
                    }
                    stream.extend_from_slice(&[0, 0, 0, 1]);
                    stream.extend_from_slice(unit);
                }
                for unit in rust_h264::nal::parse_annex_b(&stream) {
                    match decoder.decode_nal(&unit) {
                        Ok(frames) => {
                            for frame in &frames {
                                if !emit(h264_planes(frame))? {
                                    return Ok(());
                                }
                            }
                        }
                        Err(error) => tolerate(&mut errors, format!("{error:?}"))?,
                    }
                }
            }
            Decoder::Hevc {
                decoder,
                length_size,
            } => {
                for unit in rust_h265::parse_hvcc(&buffer, *length_size) {
                    if let Err(error) = decoder.decode_nal(&unit) {
                        if matches!(error, rust_h265::DecodeError::ResourceLimit(..)) {
                            return Err(TranscodeError::too_large(
                                "the picture is larger than the decoder ceiling",
                            ));
                        }
                        tolerate(&mut errors, format!("{error:?}"))?;
                    }
                    while let Some(frame) = decoder.next_output() {
                        if !emit(hevc_planes(&frame)?)? {
                            return Ok(());
                        }
                    }
                }
            }
        }
    }
    match &mut decoder {
        Decoder::H264 { decoder, .. } => {
            for frame in decoder.flush() {
                if !emit(h264_planes(&frame))? {
                    return Ok(());
                }
            }
        }
        Decoder::Hevc { decoder, .. } => {
            while let Some(frame) = decoder.flush() {
                if !emit(hevc_planes(&frame)?)? {
                    return Ok(());
                }
            }
        }
    }
    Ok(())
}

/// H.264 level for a picture size and rate: the smallest whose frame-size and macroblock-rate ceilings
/// (ITU-T H.264 table A-1) admit the stream.
fn level_for(width: usize, height: usize, frames_per_second: f64) -> u8 {
    let frame_macroblocks = (width.div_ceil(16) * height.div_ceil(16)) as f64;
    let rate = frame_macroblocks * frames_per_second;
    const LEVELS: [(u8, f64, f64); 9] = [
        (30, 1620.0, 40500.0),
        (31, 3600.0, 108000.0),
        (32, 5120.0, 216000.0),
        (40, 8192.0, 245760.0),
        (42, 8704.0, 522240.0),
        (50, 22080.0, 589824.0),
        (51, 36864.0, 983040.0),
        (52, 36864.0, 2073600.0),
        (60, 139264.0, 4177920.0),
    ];
    LEVELS
        .iter()
        .find(|(_, frame_size, macroblock_rate)| {
            frame_macroblocks <= *frame_size && rate <= *macroblock_rate
        })
        .map(|level| level.0)
        .unwrap_or(52)
}

/// The NAL unit type and whether it starts a new picture (`first_mb_in_slice` is zero).
fn starts_picture(unit: &[u8]) -> bool {
    let kind = unit.first().map(|header| header & 0x1f).unwrap_or(0);
    if kind != 1 && kind != 5 {
        return false;
    }
    let head = unescape_rbsp(unit.get(1..unit.len().min(8)).unwrap_or_default());
    BitReader::new(&head)
        .unsigned_exp_golomb()
        .map(|first| first == 0)
        .unwrap_or(false)
}

/// Split an Annex B byte stream into NAL units.
fn annex_b_units(stream: &[u8]) -> Vec<&[u8]> {
    let mut starts = Vec::new();
    let mut index = 0usize;
    while index + 3 <= stream.len() {
        if stream.get(index..index + 3) == Some(&[0, 0, 1]) {
            starts.push(index + 3);
            index += 3;
        } else {
            index += 1;
        }
    }
    starts
        .iter()
        .enumerate()
        .map(|(position, &start)| {
            let mut end = starts
                .get(position + 1)
                .map(|&next| next - 3)
                .unwrap_or(stream.len());
            while end > start && stream.get(end - 1) == Some(&0) {
                end -= 1;
            }
            stream.get(start..end).unwrap_or_default()
        })
        .collect()
}

/// Gathers the encoder's Annex B output into length-prefixed access units.
#[derive(Default)]
struct AccessUnits {
    sequence: Option<Vec<u8>>,
    picture: Option<Vec<u8>>,
    current: Vec<u8>,
    current_sync: bool,
    current_has_slice: bool,
    finished: Vec<(Vec<u8>, bool)>,
}

impl AccessUnits {
    fn push(&mut self, stream: &[u8]) {
        for unit in annex_b_units(stream) {
            let kind = unit.first().map(|header| header & 0x1f).unwrap_or(0);
            match kind {
                7 => {
                    self.sequence.get_or_insert_with(|| unit.to_vec());
                    continue;
                }
                8 => {
                    self.picture.get_or_insert_with(|| unit.to_vec());
                    continue;
                }
                9 => continue,
                _ => {}
            }
            if starts_picture(unit) && self.current_has_slice {
                self.finish();
            }
            self.current
                .extend_from_slice(&(unit.len() as u32).to_be_bytes());
            self.current.extend_from_slice(unit);
            if kind == 1 || kind == 5 {
                self.current_has_slice = true;
                self.current_sync |= kind == 5;
            }
        }
    }

    fn finish(&mut self) {
        if self.current_has_slice {
            self.finished
                .push((std::mem::take(&mut self.current), self.current_sync));
        }
        self.current.clear();
        self.current_sync = false;
        self.current_has_slice = false;
    }
}

fn transcode(
    track: &VideoTrack,
    payload: &mut BufWriter<File>,
    payload_start: u64,
) -> Result<VideoOutput> {
    // Presentation times, in display order: the k-th picture out of the decoder is shown at the
    // k-th smallest composition time.
    let mut times: Vec<i64> = track
        .samples
        .iter()
        .map(|sample| sample.composition_time)
        .collect();
    times.sort_unstable();
    let total_ticks: i64 = track
        .samples
        .iter()
        .map(|sample| i64::from(sample.duration))
        .sum();
    let seconds = total_ticks as f64 / f64::from(track.timescale);
    let frames_per_second = if seconds > 0.0 {
        (track.samples.len() as f64 / seconds).clamp(1.0, 240.0)
    } else {
        30.0
    };

    let (sender, receiver) = mpsc::sync_channel::<Decoded>(4);
    let size = std::sync::OnceLock::new();
    let outcome = std::thread::scope(|scope| -> Result<VideoOutput> {
        let decoding = scope.spawn(|| {
            if let Err(error) = decode_all(track, &sender, &size) {
                let _ = sender.send(Decoded::Failed(error));
            }
            drop(sender);
        });

        let mut encoder: Option<rusty_h264::Encoder> = None;
        let mut units = AccessUnits::default();
        let mut samples = Vec::with_capacity(track.samples.len());
        let mut position = payload_start;
        let mut pictures = 0usize;
        let mut failure = None;
        let mut write_finished = |units: &mut AccessUnits,
                                  samples: &mut Vec<Sample>,
                                  position: &mut u64|
         -> Result<()> {
            for (bytes, sync) in units.finished.drain(..) {
                let index = samples.len();
                let time = times
                    .get(index)
                    .copied()
                    .unwrap_or_else(|| times.last().copied().unwrap_or(0) + index as i64);
                payload.write_all(&bytes)?;
                samples.push(Sample {
                    offset: *position,
                    size: u32::try_from(bytes.len())
                        .map_err(|_| TranscodeError::internal("an encoded picture is too large"))?,
                    decode_time: time,
                    composition_time: time,
                    duration: 0,
                    sync,
                });
                *position += bytes.len() as u64;
            }
            Ok(())
        };
        for decoded in receiver.iter() {
            let picture = match decoded {
                Decoded::Picture(picture) => picture,
                Decoded::Failed(error) => {
                    failure = Some(error);
                    break;
                }
            };
            if encoder.is_none() {
                let mut config = rusty_h264::EncoderConfig::new(picture.width, picture.height);
                config.level_idc = level_for(picture.width, picture.height, frames_per_second);
                config.framerate = frames_per_second as f32;
                // About 0.1 bits per pixel per frame, inside a ceiling a viewing copy never needs to exceed.
                let bits = (picture.width * picture.height) as f64 * frames_per_second * 0.1;
                config.bitrate = bits.clamp(400_000.0, 8_000_000.0) as u32;
                config.gop_size = (frames_per_second * 2.0).round().max(1.0) as u32;
                encoder = Some(rusty_h264::Encoder::new(config).map_err(|error| {
                    TranscodeError::internal(format!(
                        "the H.264 encoder refused its configuration: {error:?}"
                    ))
                })?);
            }
            let Some(active) = encoder.as_mut() else {
                break;
            };
            let frame = rusty_h264::YuvFrame {
                width: picture.width,
                height: picture.height,
                y: picture.luma,
                u: picture.blue_difference,
                v: picture.red_difference,
            };
            units.push(&active.encode(&frame));
            pictures += 1;
            write_finished(&mut units, &mut samples, &mut position)?;
        }
        if decoding.join().is_err() {
            return Err(TranscodeError::malformed(
                "the video decoder stopped on this stream",
            ));
        }
        if let Some(error) = failure {
            return Err(error);
        }
        let Some(mut active) = encoder else {
            return Err(TranscodeError::malformed(
                "no picture could be decoded from the video stream",
            ));
        };
        units.push(&active.flush());
        units.finish();
        write_finished(&mut units, &mut samples, &mut position)?;
        if samples.len() != pictures {
            return Err(TranscodeError::internal(format!(
                "the encoder returned {} pictures for {pictures}",
                samples.len()
            )));
        }
        // Each picture lasts until the next one; the last keeps its predecessor's length.
        let fallback = (f64::from(track.timescale) / frames_per_second)
            .round()
            .max(1.0) as i64;
        for index in 0..samples.len() {
            let next = samples.get(index + 1).map(|next| next.composition_time);
            let current = samples
                .get(index)
                .map(|sample| sample.composition_time)
                .unwrap_or(0);
            let previous = index
                .checked_sub(1)
                .and_then(|previous| samples.get(previous))
                .map(|sample| i64::from(sample.duration));
            let duration = next
                .map(|next| next - current)
                .unwrap_or(previous.unwrap_or(fallback));
            if let Some(sample) = samples.get_mut(index) {
                sample.duration = u32::try_from(duration.max(1)).unwrap_or(u32::MAX);
            }
        }
        let (Some(sequence), Some(picture_set)) = (units.sequence.take(), units.picture.take())
        else {
            return Err(TranscodeError::internal(
                "the encoder wrote no parameter sets",
            ));
        };
        let (width, height) = size.get().copied().unwrap_or((2, 2));
        Ok(VideoOutput {
            configuration: avc_configuration(&sequence, &picture_set),
            width: width as u32,
            height: height as u32,
            timescale: track.timescale,
            matrix: track.matrix,
            start_offset: track.start_offset,
            samples,
            copied: false,
        })
    });
    outcome
}

fn avc_configuration(sequence: &[u8], picture: &[u8]) -> Vec<u8> {
    let mut record = vec![
        1,
        sequence.get(1).copied().unwrap_or(100),
        sequence.get(2).copied().unwrap_or(0),
        sequence.get(3).copied().unwrap_or(40),
        0xff,
        0xe1,
    ];
    record.extend_from_slice(&(sequence.len() as u16).to_be_bytes());
    record.extend_from_slice(sequence);
    record.push(1);
    record.extend_from_slice(&(picture.len() as u16).to_be_bytes());
    record.extend_from_slice(picture);
    // High profile records carry the chroma format and bit depths (ISO/IEC 14496-15, 5.3.3.1.2).
    if matches!(sequence.get(1), Some(100 | 110 | 122 | 144)) {
        record.extend_from_slice(&[0xfc | 1, 0xf8, 0xf8, 0]);
    }
    record
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_follow_the_table() {
        assert_eq!(level_for(640, 360, 30.0), 30);
        assert_eq!(level_for(1280, 720, 30.0), 31);
        assert_eq!(level_for(1920, 1080, 30.0), 40);
        assert_eq!(level_for(1920, 1080, 60.0), 42);
    }

    #[test]
    fn annex_b_units_split_on_start_codes() {
        let stream = [
            0, 0, 0, 1, 0x67, 1, 2, 0, 0, 1, 0x68, 3, 0, 0, 0, 1, 0x65, 4,
        ];
        let units = annex_b_units(&stream);
        assert_eq!(
            units,
            vec![&[0x67, 1, 2][..], &[0x68, 3][..], &[0x65, 4][..]]
        );
    }

    #[test]
    fn a_new_picture_starts_at_macroblock_zero() {
        assert!(starts_picture(&[0x65, 0x88]));
        assert!(!starts_picture(&[0x65, 0x40]));
        assert!(!starts_picture(&[0x67, 0x88]));
    }
}
