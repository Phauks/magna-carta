//! MP4 and QuickTime: the ISO base media file format. Only the movie header is loaded into memory;
//! samples stay in the source file and are read one at a time through the expanded sample tables.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use super::{
    AudioCodec, AudioTrack, Media, PcmLayout, Sample, VideoCodec, VideoTrack, IDENTITY_MATRIX,
};
use crate::error::{Result, TranscodeError};
use crate::limits;

/// A box inside an in-memory buffer: its four-character type and its payload.
#[derive(Debug, Clone, Copy)]
struct Atom<'a> {
    kind: [u8; 4],
    payload: &'a [u8],
}

fn malformed(what: &str) -> TranscodeError {
    TranscodeError::malformed(format!("MP4: {what}"))
}

fn u16_at(data: &[u8], at: usize) -> Result<u16> {
    let bytes = data
        .get(at..at + 2)
        .ok_or_else(|| malformed("a box ends early"))?;
    Ok(u16::from_be_bytes([bytes[0], bytes[1]]))
}

fn u32_at(data: &[u8], at: usize) -> Result<u32> {
    let bytes = data
        .get(at..at + 4)
        .ok_or_else(|| malformed("a box ends early"))?;
    Ok(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn u64_at(data: &[u8], at: usize) -> Result<u64> {
    let bytes = data
        .get(at..at + 8)
        .ok_or_else(|| malformed("a box ends early"))?;
    let mut array = [0u8; 8];
    array.copy_from_slice(bytes);
    Ok(u64::from_be_bytes(array))
}

/// Split a buffer into its child boxes.
fn atoms(data: &[u8]) -> Result<Vec<Atom<'_>>> {
    let mut found = Vec::new();
    let mut at = 0usize;
    while at + 8 <= data.len() {
        let size32 = u32_at(data, at)?;
        let mut kind = [0u8; 4];
        kind.copy_from_slice(
            data.get(at + 4..at + 8)
                .ok_or_else(|| malformed("a box ends early"))?,
        );
        let (header, size) = match size32 {
            0 => (8usize, (data.len() - at) as u64),
            1 => (16usize, u64_at(data, at + 8)?),
            size => (8usize, u64::from(size)),
        };
        let size = usize::try_from(size).map_err(|_| malformed("a box is too large"))?;
        if size < header || at + size > data.len() {
            return Err(malformed("a box overruns its parent"));
        }
        let payload = data
            .get(at + header..at + size)
            .ok_or_else(|| malformed("a box overruns its parent"))?;
        found.push(Atom { kind, payload });
        at += size;
    }
    Ok(found)
}

fn child<'a>(data: &'a [u8], kind: &[u8; 4]) -> Result<Option<&'a [u8]>> {
    Ok(atoms(data)?
        .into_iter()
        .find(|atom| &atom.kind == kind)
        .map(|atom| atom.payload))
}

fn require<'a>(data: &'a [u8], kind: &[u8; 4]) -> Result<&'a [u8]> {
    child(data, kind)?.ok_or_else(|| {
        malformed(&format!(
            "a required {} box is missing",
            String::from_utf8_lossy(kind)
        ))
    })
}

/// Load the top-level `moov` box, walking the file's top-level boxes by seeking past each one.
fn load_movie_header(file: &mut File, length: u64) -> Result<Vec<u8>> {
    let mut at = 0u64;
    let mut has_fragments = false;
    let mut movie = None;
    while at + 8 <= length {
        file.seek(SeekFrom::Start(at))?;
        let mut header = [0u8; 16];
        file.read_exact(&mut header[..8])?;
        let size32 = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);
        let kind = [header[4], header[5], header[6], header[7]];
        let (header_size, size) = match size32 {
            0 => (8u64, length - at),
            1 => {
                file.read_exact(&mut header[8..16])?;
                let mut large = [0u8; 8];
                large.copy_from_slice(&header[8..16]);
                (16u64, u64::from_be_bytes(large))
            }
            size => (8u64, u64::from(size)),
        };
        if size < header_size || at.saturating_add(size) > length {
            return Err(malformed("a top-level box overruns the file"));
        }
        if &kind == b"moov" {
            let body = size - header_size;
            if body > limits::MAX_MOVIE_HEADER_BYTES {
                return Err(TranscodeError::too_large(
                    "the MP4 movie header is over the size ceiling",
                ));
            }
            let mut buffer = vec![0u8; body as usize];
            file.read_exact(&mut buffer)?;
            movie = Some(buffer);
        } else if &kind == b"moof" {
            has_fragments = true;
        }
        at += size;
    }
    match movie {
        Some(movie) => {
            if has_fragments {
                // A fragmented file keeps its sample tables in each fragment; the engine does not read
                // them yet, and an empty movie header would otherwise read as a file with no samples.
                return Err(TranscodeError::unsupported(
                    "fragmented MP4 is not converted yet",
                ));
            }
            Ok(movie)
        }
        None => Err(malformed("there is no movie header")),
    }
}

pub fn read(path: &Path) -> Result<Media> {
    let mut file = File::open(path)?;
    let length = file.metadata()?.len();
    let movie = load_movie_header(&mut file, length)?;
    let mut video = None;
    let mut audio = None;
    let mut unsupported_audio = None;
    for track in atoms(&movie)?
        .into_iter()
        .filter(|atom| &atom.kind == b"trak")
    {
        match read_track(track.payload, path)? {
            TrackKind::Video(found) => {
                if video.is_none() {
                    video = Some(found);
                }
            }
            TrackKind::Audio(found) => {
                if audio.is_none() {
                    audio = Some(found);
                }
            }
            TrackKind::UnsupportedVideo(codec) => {
                if video.is_none() {
                    return Err(TranscodeError::unsupported(format!("video codec {codec}")));
                }
            }
            TrackKind::UnsupportedAudio(codec) => {
                unsupported_audio.get_or_insert(codec);
            }
            TrackKind::Other => {}
        }
    }
    let video = video.ok_or_else(|| TranscodeError::unsupported("the file has no video track"))?;
    if audio.is_none() {
        if let Some(codec) = unsupported_audio {
            // A rendition that silently drops the sound would misrepresent the recording.
            return Err(TranscodeError::unsupported(format!("audio codec {codec}")));
        }
    }
    Ok(Media { video, audio })
}

enum TrackKind {
    Video(VideoTrack),
    Audio(AudioTrack),
    UnsupportedVideo(String),
    UnsupportedAudio(String),
    Other,
}

fn fourcc(kind: [u8; 4]) -> String {
    String::from_utf8_lossy(&kind).trim().to_string()
}

fn read_track(track: &[u8], path: &Path) -> Result<TrackKind> {
    let media = require(track, b"mdia")?;
    let handler = require(media, b"hdlr")?;
    let handler_type = handler
        .get(8..12)
        .ok_or_else(|| malformed("a handler box ends early"))?;
    let is_video = handler_type == b"vide";
    let is_audio = handler_type == b"soun";
    if !is_video && !is_audio {
        return Ok(TrackKind::Other);
    }
    let media_header = require(media, b"mdhd")?;
    let timescale = if media_header.first() == Some(&1) {
        u32_at(media_header, 20)?
    } else {
        u32_at(media_header, 12)?
    };
    let table = require(require(media, b"minf")?, b"stbl")?;
    let description = require(table, b"stsd")?;
    let entries = atoms(
        description
            .get(8..)
            .ok_or_else(|| malformed("a sample description ends early"))?,
    )?;
    let entry = entries
        .first()
        .ok_or_else(|| malformed("a track has no sample description"))?;
    let start_offset = edit_start(track)?;
    if is_video {
        let codec = match &entry.kind {
            b"avc1" | b"avc3" => VideoCodec::H264,
            b"hvc1" | b"hev1" => VideoCodec::Hevc,
            other => return Ok(TrackKind::UnsupportedVideo(fourcc(*other))),
        };
        let width = u32::from(u16_at(entry.payload, 24)?);
        let height = u32::from(u16_at(entry.payload, 26)?);
        let children = entry
            .payload
            .get(78..)
            .ok_or_else(|| malformed("a video sample entry ends early"))?;
        let record_kind = if codec == VideoCodec::H264 {
            b"avcC"
        } else {
            b"hvcC"
        };
        let configuration = require(children, record_kind)?.to_vec();
        let samples = expand_samples(table, None)?;
        return Ok(TrackKind::Video(VideoTrack {
            codec,
            configuration,
            timescale,
            width,
            height,
            matrix: track_matrix(track)?,
            start_offset,
            samples,
            data: path.to_path_buf(),
        }));
    }
    let sound = read_sound_entry(entry)?;
    let Some(sound) = sound else {
        return Ok(TrackKind::UnsupportedAudio(fourcc(entry.kind)));
    };
    let pcm_frame_bytes = match sound.codec {
        AudioCodec::Pcm(layout) => Some(layout.bytes_per_sample() * usize::from(sound.channels)),
        _ => None,
    };
    let samples = expand_samples(table, pcm_frame_bytes)?;
    Ok(TrackKind::Audio(AudioTrack {
        codec: sound.codec,
        configuration: sound.configuration,
        sample_rate: sound.sample_rate,
        channels: sound.channels,
        timescale,
        start_offset,
        samples,
        data: path.to_path_buf(),
    }))
}

/// The media time of the first non-empty edit, which is where presentation starts.
fn edit_start(track: &[u8]) -> Result<i64> {
    let Some(edits) = child(track, b"edts")? else {
        return Ok(0);
    };
    let Some(list) = child(edits, b"elst")? else {
        return Ok(0);
    };
    let version = *list.first().unwrap_or(&0);
    let count = u32_at(list, 4)? as usize;
    let entry_size = if version == 1 { 20 } else { 12 };
    for index in 0..count.min(64) {
        let at = 8 + index * entry_size;
        let media_time = if version == 1 {
            u64_at(list, at + 8)? as i64
        } else {
            i64::from(u32_at(list, at + 4)? as i32)
        };
        if media_time >= 0 {
            return Ok(media_time);
        }
    }
    Ok(0)
}

fn track_matrix(track: &[u8]) -> Result<[i32; 9]> {
    let Some(header) = child(track, b"tkhd")? else {
        return Ok(IDENTITY_MATRIX);
    };
    let at = if header.first() == Some(&1) {
        4 + 32 + 8 + 8
    } else {
        4 + 20 + 8 + 8
    };
    let mut matrix = [0i32; 9];
    for (index, value) in matrix.iter_mut().enumerate() {
        *value = u32_at(header, at + index * 4)? as i32;
    }
    Ok(matrix)
}

struct SoundEntry {
    codec: AudioCodec,
    configuration: Vec<u8>,
    sample_rate: u32,
    channels: u16,
}

/// Find a box anywhere below `data` (QuickTime nests `esds` inside a `wave` box).
fn find_nested<'a>(data: &'a [u8], kind: &[u8; 4], depth: u32) -> Option<&'a [u8]> {
    let children = atoms(data).ok()?;
    for atom in &children {
        if &atom.kind == kind {
            return Some(atom.payload);
        }
    }
    if depth == 0 {
        return None;
    }
    children
        .iter()
        .find_map(|atom| find_nested(atom.payload, kind, depth - 1))
}

/// Read an MPEG-4 descriptor length (one to four bytes of seven bits each).
fn descriptor_length(data: &[u8], at: &mut usize) -> Result<usize> {
    let mut length = 0usize;
    for _ in 0..4 {
        let byte = *data
            .get(*at)
            .ok_or_else(|| malformed("a descriptor ends early"))?;
        *at += 1;
        length = (length << 7) | usize::from(byte & 0x7f);
        if byte & 0x80 == 0 {
            break;
        }
    }
    Ok(length)
}

/// From an `esds` payload: the object type and the decoder-specific info.
fn elementary_stream_descriptor(esds: &[u8]) -> Result<(u8, Vec<u8>)> {
    let mut at = 4usize; // version and flags
    let mut object_type = 0u8;
    let mut specific = Vec::new();
    while at < esds.len() {
        let tag = *esds
            .get(at)
            .ok_or_else(|| malformed("a descriptor ends early"))?;
        at += 1;
        let length = descriptor_length(esds, &mut at)?;
        match tag {
            0x03 => {
                // ES_Descriptor: ES_ID, flags, then optional fields the flags announce.
                let flags = *esds
                    .get(at + 2)
                    .ok_or_else(|| malformed("a descriptor ends early"))?;
                at += 3;
                if flags & 0x80 != 0 {
                    at += 2;
                }
                if flags & 0x40 != 0 {
                    let url_length = *esds
                        .get(at)
                        .ok_or_else(|| malformed("a descriptor ends early"))?;
                    at += 1 + usize::from(url_length);
                }
                if flags & 0x20 != 0 {
                    at += 2;
                }
            }
            0x04 => {
                object_type = *esds
                    .get(at)
                    .ok_or_else(|| malformed("a descriptor ends early"))?;
                at += 13;
            }
            0x05 => {
                specific = esds
                    .get(at..at + length)
                    .ok_or_else(|| malformed("a descriptor ends early"))?
                    .to_vec();
                at += length;
            }
            _ => at += length,
        }
    }
    Ok((object_type, specific))
}

fn read_sound_entry(entry: &Atom<'_>) -> Result<Option<SoundEntry>> {
    let payload = entry.payload;
    let version = u16_at(payload, 8)?;
    let mut channels = u16_at(payload, 16)?;
    let mut bits = u16_at(payload, 18)?;
    let mut sample_rate = u32_at(payload, 24)? >> 16;
    let mut lpcm_flags = 0u32;
    let children_at = match version {
        0 => 28,
        1 => 28 + 16,
        2 => {
            let rate_bits = u64_at(payload, 32)?;
            sample_rate = f64::from_bits(rate_bits).round().clamp(0.0, 1_000_000.0) as u32;
            channels =
                u16::try_from(u32_at(payload, 40)?).map_err(|_| malformed("too many channels"))?;
            bits = u16::try_from(u32_at(payload, 48)?)
                .map_err(|_| malformed("a sample size is out of range"))?;
            lpcm_flags = u32_at(payload, 52)?;
            28 + 36
        }
        _ => return Err(malformed("an unknown sound sample description version")),
    };
    let children = payload.get(children_at..).unwrap_or_default();
    let pcm = |bits: u16, float: bool, big_endian: bool, unsigned: bool| {
        Some(AudioCodec::Pcm(PcmLayout {
            bits,
            float,
            big_endian,
            unsigned,
        }))
    };
    let mut configuration = Vec::new();
    let codec = match &entry.kind {
        b"mp4a" => {
            let esds = find_nested(children, b"esds", 2)
                .ok_or_else(|| malformed("an mp4a entry has no esds"))?;
            let (object_type, specific) = elementary_stream_descriptor(esds)?;
            match object_type {
                0x40 | 0x66 | 0x67 | 0x68 => {
                    configuration = specific;
                    Some(AudioCodec::Aac)
                }
                0x69 | 0x6b => Some(AudioCodec::Mp3),
                _ => None,
            }
        }
        b".mp3" => Some(AudioCodec::Mp3),
        b"fLaC" => {
            let block = find_nested(children, b"dfLa", 0)
                .ok_or_else(|| malformed("a FLAC entry has no dfLa"))?;
            // Version and flags, then metadata blocks; STREAMINFO comes first and is 34 bytes.
            configuration = block
                .get(8..8 + 34)
                .ok_or_else(|| malformed("a FLAC STREAMINFO ends early"))?
                .to_vec();
            Some(AudioCodec::Flac)
        }
        b"sowt" => pcm(16, false, false, false),
        b"twos" => pcm(if bits == 8 { 8 } else { 16 }, false, true, false),
        b"raw " => pcm(8, false, false, true),
        b"in24" => pcm(
            24,
            false,
            find_nested(children, b"enda", 2)
                .and_then(|e| e.get(1))
                .copied()
                != Some(1),
            false,
        ),
        b"in32" => pcm(
            32,
            false,
            find_nested(children, b"enda", 2)
                .and_then(|e| e.get(1))
                .copied()
                != Some(1),
            false,
        ),
        b"fl32" => pcm(
            32,
            true,
            find_nested(children, b"enda", 2)
                .and_then(|e| e.get(1))
                .copied()
                != Some(1),
            false,
        ),
        b"fl64" => pcm(
            64,
            true,
            find_nested(children, b"enda", 2)
                .and_then(|e| e.get(1))
                .copied()
                != Some(1),
            false,
        ),
        b"lpcm" => pcm(bits, lpcm_flags & 1 != 0, lpcm_flags & 2 != 0, false),
        _ => None,
    };
    let Some(codec) = codec else { return Ok(None) };
    if let AudioCodec::Pcm(layout) = codec {
        let valid = if layout.float {
            matches!(layout.bits, 32 | 64)
        } else {
            matches!(layout.bits, 8 | 16 | 24 | 32)
        };
        if !valid {
            return Err(TranscodeError::unsupported(format!(
                "{}-bit PCM",
                layout.bits
            )));
        }
    }
    if channels == 0 || channels > limits::MAX_AUDIO_CHANNELS {
        return Err(TranscodeError::unsupported(format!(
            "{channels} audio channels"
        )));
    }
    Ok(Some(SoundEntry {
        codec,
        configuration,
        sample_rate,
        channels,
    }))
}

/// Expand a sample table into one entry per sample. For uncompressed sound (`pcm_frame_bytes`) each
/// chunk becomes one sample, because QuickTime's per-sample tables describe single PCM frames.
fn expand_samples(table: &[u8], pcm_frame_bytes: Option<usize>) -> Result<Vec<Sample>> {
    // Sample sizes.
    let mut sizes: Vec<u32> = Vec::new();
    let mut constant_size = 0u32;
    let sample_count;
    if let Some(stsz) = child(table, b"stsz")? {
        constant_size = u32_at(stsz, 4)?;
        sample_count = u32_at(stsz, 8)? as usize;
        if sample_count > limits::MAX_SAMPLES_PER_TRACK {
            return Err(TranscodeError::too_large(
                "a track has more samples than the ceiling",
            ));
        }
        if constant_size == 0 {
            if stsz.len() < 12 + sample_count * 4 {
                return Err(malformed("the sample size table ends early"));
            }
            sizes = (0..sample_count)
                .map(|index| u32_at(stsz, 12 + index * 4))
                .collect::<Result<_>>()?;
        }
    } else if let Some(stz2) = child(table, b"stz2")? {
        let field = *stz2
            .get(7)
            .ok_or_else(|| malformed("a compact size table ends early"))?;
        sample_count = u32_at(stz2, 8)? as usize;
        if sample_count > limits::MAX_SAMPLES_PER_TRACK {
            return Err(TranscodeError::too_large(
                "a track has more samples than the ceiling",
            ));
        }
        sizes = (0..sample_count)
            .map(|index| -> Result<u32> {
                match field {
                    4 => {
                        let byte = *stz2
                            .get(12 + index / 2)
                            .ok_or_else(|| malformed("a compact size table ends early"))?;
                        Ok(u32::from(if index % 2 == 0 {
                            byte >> 4
                        } else {
                            byte & 0x0f
                        }))
                    }
                    8 => {
                        Ok(u32::from(*stz2.get(12 + index).ok_or_else(|| {
                            malformed("a compact size table ends early")
                        })?))
                    }
                    16 => Ok(u32::from(u16_at(stz2, 12 + index * 2)?)),
                    _ => Err(malformed("a compact size table has an invalid field size")),
                }
            })
            .collect::<Result<_>>()?;
    } else {
        return Err(malformed("a track has no sample size table"));
    }

    // Chunk offsets.
    let chunk_offsets: Vec<u64> = if let Some(stco) = child(table, b"stco")? {
        let count = u32_at(stco, 4)? as usize;
        if stco.len() < 8 + count * 4 {
            return Err(malformed("the chunk offset table ends early"));
        }
        (0..count)
            .map(|index| u32_at(stco, 8 + index * 4).map(u64::from))
            .collect::<Result<_>>()?
    } else if let Some(co64) = child(table, b"co64")? {
        let count = u32_at(co64, 4)? as usize;
        if co64.len() < 8 + count * 8 {
            return Err(malformed("the chunk offset table ends early"));
        }
        (0..count)
            .map(|index| u64_at(co64, 8 + index * 8))
            .collect::<Result<_>>()?
    } else {
        return Err(malformed("a track has no chunk offset table"));
    };

    // Samples per chunk, expanded into one count per chunk.
    let stsc = require(table, b"stsc")?;
    let runs = u32_at(stsc, 4)? as usize;
    if stsc.len() < 8 + runs * 12 {
        return Err(malformed("the sample-to-chunk table ends early"));
    }
    let mut per_chunk = vec![0u32; chunk_offsets.len()];
    for run in 0..runs {
        let first = u32_at(stsc, 8 + run * 12)? as usize;
        let count = u32_at(stsc, 8 + run * 12 + 4)?;
        let next_first = if run + 1 < runs {
            u32_at(stsc, 8 + (run + 1) * 12)? as usize
        } else {
            chunk_offsets.len() + 1
        };
        if first == 0 || next_first < first {
            return Err(malformed("the sample-to-chunk table is out of order"));
        }
        for chunk in first..next_first.min(chunk_offsets.len() + 1) {
            if let Some(slot) = per_chunk.get_mut(chunk - 1) {
                *slot = count;
            }
        }
    }

    // Decode durations, one per sample.
    let stts = require(table, b"stts")?;
    let mut durations = Vec::with_capacity(sample_count.min(1 << 20));
    let entries = u32_at(stts, 4)? as usize;
    for entry in 0..entries {
        let count = u32_at(stts, 8 + entry * 8)? as usize;
        let delta = u32_at(stts, 8 + entry * 8 + 4)?;
        if durations.len() + count > sample_count {
            durations.extend(std::iter::repeat_n(delta, sample_count - durations.len()));
            break;
        }
        durations.extend(std::iter::repeat_n(delta, count));
    }
    durations.resize(sample_count, durations.last().copied().unwrap_or(0));

    // Composition offsets.
    let mut composition = vec![0i64; sample_count];
    if let Some(ctts) = child(table, b"ctts")? {
        let version = *ctts.first().unwrap_or(&0);
        let entries = u32_at(ctts, 4)? as usize;
        let mut index = 0usize;
        for entry in 0..entries {
            let count = u32_at(ctts, 8 + entry * 8)? as usize;
            let raw = u32_at(ctts, 8 + entry * 8 + 4)?;
            let offset = if version == 1 {
                i64::from(raw as i32)
            } else {
                i64::from(raw)
            };
            for slot in composition.iter_mut().skip(index).take(count) {
                *slot = offset;
            }
            index = index.saturating_add(count);
            if index >= sample_count {
                break;
            }
        }
    }

    // Sync samples (absent means every sample is one).
    let mut sync = vec![true; sample_count];
    if let Some(stss) = child(table, b"stss")? {
        sync.fill(false);
        let entries = u32_at(stss, 4)? as usize;
        if stss.len() < 8 + entries * 4 {
            return Err(malformed("the sync sample table ends early"));
        }
        for entry in 0..entries {
            let number = u32_at(stss, 8 + entry * 4)? as usize;
            if let Some(slot) = number.checked_sub(1).and_then(|index| sync.get_mut(index)) {
                *slot = true;
            }
        }
    }

    let mut samples = Vec::with_capacity(sample_count.min(1 << 20));
    let mut index = 0usize;
    let mut decode_time = 0i64;
    for (chunk, &offset) in chunk_offsets.iter().enumerate() {
        let count = per_chunk.get(chunk).copied().unwrap_or(0) as usize;
        if count == 0 {
            continue;
        }
        if let Some(frame_bytes) = pcm_frame_bytes {
            // The chunk's frames are contiguous; read them as one sample.
            let frames = count.min(sample_count.saturating_sub(index));
            if frames == 0 {
                break;
            }
            let duration: i64 = durations
                .iter()
                .skip(index)
                .take(frames)
                .map(|&d| i64::from(d))
                .sum();
            let size = u32::try_from(frames * frame_bytes)
                .map_err(|_| malformed("a PCM chunk is too large"))?;
            samples.push(Sample {
                offset,
                size,
                decode_time,
                composition_time: decode_time,
                duration: u32::try_from(duration)
                    .map_err(|_| malformed("a PCM chunk is too long"))?,
                sync: true,
            });
            decode_time += duration;
            index += frames;
            continue;
        }
        let mut position = offset;
        for _ in 0..count {
            if index >= sample_count {
                break;
            }
            let size = if constant_size != 0 {
                constant_size
            } else {
                sizes.get(index).copied().unwrap_or(0)
            };
            let duration = durations.get(index).copied().unwrap_or(0);
            samples.push(Sample {
                offset: position,
                size,
                decode_time,
                composition_time: decode_time + composition.get(index).copied().unwrap_or(0),
                duration,
                sync: sync.get(index).copied().unwrap_or(false),
            });
            position = position.saturating_add(u64::from(size));
            decode_time += i64::from(duration);
            index += 1;
        }
    }
    if index < sample_count {
        return Err(malformed(
            "the chunk tables account for fewer samples than the size table",
        ));
    }
    Ok(samples)
}
