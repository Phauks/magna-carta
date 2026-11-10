//! Writing the rendition: an MP4 with the movie header before the media data ("faststart"), so a
//! browser can start playing before the whole file has arrived, and with the two tracks interleaved
//! in half-second chunks so playing from the start never needs a far-away byte range.

use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;

use crate::audio::AudioOutput;
use crate::demux::Sample;
use crate::error::{Result, TranscodeError};
use crate::video::VideoOutput;

const MOVIE_TIMESCALE: u32 = 1000;

fn put_box(out: &mut Vec<u8>, kind: &[u8; 4], body: &[u8]) {
    out.extend_from_slice(&((body.len() + 8) as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(body);
}

fn boxed(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(body.len() + 8);
    put_box(&mut out, kind, body);
    out
}

fn full_box(kind: &[u8; 4], version: u8, flags: u32, body: &[u8]) -> Vec<u8> {
    let mut payload = Vec::with_capacity(body.len() + 4);
    payload.extend_from_slice(&((u32::from(version) << 24) | (flags & 0x00ff_ffff)).to_be_bytes());
    payload.extend_from_slice(body);
    boxed(kind, &payload)
}

fn rescale(value: i64, from: u32, to: u32) -> u64 {
    (i128::from(value.max(0)) * i128::from(to) / i128::from(from.max(1)))
        .clamp(0, i128::from(u64::MAX)) as u64
}

/// A run of consecutive samples of one track stored together.
#[derive(Debug, Clone, Copy)]
struct Chunk {
    track: usize,
    first: usize,
    count: usize,
    bytes: u64,
}

/// What the muxer needs to know about each track.
struct TrackPlan<'a> {
    samples: &'a [Sample],
    timescale: u32,
}

/// Interleave the tracks: repeatedly take, from whichever track is earliest, every sample that starts
/// within half a second of its next one.
fn plan_chunks(tracks: &[TrackPlan<'_>]) -> Vec<Chunk> {
    let mut next = vec![0usize; tracks.len()];
    let mut chunks = Vec::new();
    loop {
        let earliest = tracks
            .iter()
            .enumerate()
            .filter(|(index, track)| next.get(*index).copied().unwrap_or(0) < track.samples.len())
            .min_by(|(a_index, a), (b_index, b)| {
                let time = |track: &TrackPlan<'_>, index: usize| {
                    let at = next.get(index).copied().unwrap_or(0);
                    track
                        .samples
                        .get(at)
                        .map(|sample| sample.decode_time as f64 / f64::from(track.timescale))
                        .unwrap_or(f64::MAX)
                };
                time(a, *a_index).total_cmp(&time(b, *b_index))
            })
            .map(|(index, _)| index);
        let Some(track_index) = earliest else { break };
        let Some(track) = tracks.get(track_index) else {
            break;
        };
        let first = next.get(track_index).copied().unwrap_or(0);
        let start_time = track
            .samples
            .get(first)
            .map(|sample| sample.decode_time)
            .unwrap_or(0);
        let window = i64::from(track.timescale) / 2;
        let mut count = 0usize;
        let mut bytes = 0u64;
        while let Some(sample) = track.samples.get(first + count) {
            if count > 0 && sample.decode_time - start_time >= window {
                break;
            }
            bytes += u64::from(sample.size);
            count += 1;
        }
        chunks.push(Chunk {
            track: track_index,
            first,
            count,
            bytes,
        });
        if let Some(slot) = next.get_mut(track_index) {
            *slot = first + count;
        }
    }
    chunks
}

fn movie_header(duration: u64, next_track: u32) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(&0u64.to_be_bytes()); // creation and modification time
    body.extend_from_slice(&MOVIE_TIMESCALE.to_be_bytes());
    body.extend_from_slice(&(duration.min(u64::from(u32::MAX)) as u32).to_be_bytes());
    body.extend_from_slice(&0x0001_0000u32.to_be_bytes()); // rate 1.0
    body.extend_from_slice(&0x0100u16.to_be_bytes()); // volume 1.0
    body.extend_from_slice(&[0u8; 10]);
    for value in crate::demux::IDENTITY_MATRIX {
        body.extend_from_slice(&value.to_be_bytes());
    }
    body.extend_from_slice(&[0u8; 24]);
    body.extend_from_slice(&next_track.to_be_bytes());
    full_box(b"mvhd", 0, 0, &body)
}

struct TrackDescription<'a> {
    id: u32,
    is_video: bool,
    timescale: u32,
    matrix: [i32; 9],
    width: u32,
    height: u32,
    start_offset: i64,
    presented: i64,
    sample_entry: Vec<u8>,
    samples: &'a [Sample],
}

fn track_box(
    track: &TrackDescription<'_>,
    chunks: &[Chunk],
    chunk_offsets: &[u64],
    large_offsets: bool,
    track_index: usize,
) -> Vec<u8> {
    let media_duration: i64 = track
        .samples
        .iter()
        .map(|sample| i64::from(sample.duration))
        .sum();
    let movie_duration = rescale(track.presented, track.timescale, MOVIE_TIMESCALE);

    let mut header = Vec::new();
    header.extend_from_slice(&0u64.to_be_bytes());
    header.extend_from_slice(&track.id.to_be_bytes());
    header.extend_from_slice(&0u32.to_be_bytes());
    header.extend_from_slice(&(movie_duration.min(u64::from(u32::MAX)) as u32).to_be_bytes());
    header.extend_from_slice(&[0u8; 8]);
    header.extend_from_slice(&0u16.to_be_bytes()); // layer
    header.extend_from_slice(&0u16.to_be_bytes()); // alternate group
    header.extend_from_slice(&(if track.is_video { 0u16 } else { 0x0100 }).to_be_bytes());
    header.extend_from_slice(&0u16.to_be_bytes());
    for value in track.matrix {
        header.extend_from_slice(&value.to_be_bytes());
    }
    header.extend_from_slice(&(track.width << 16).to_be_bytes());
    header.extend_from_slice(&(track.height << 16).to_be_bytes());
    let track_header = full_box(b"tkhd", 0, 3, &header);

    let mut edit = Vec::new();
    edit.extend_from_slice(&1u32.to_be_bytes());
    edit.extend_from_slice(&(movie_duration.min(u64::from(u32::MAX)) as u32).to_be_bytes());
    // Sample times in the file start at zero whatever the stage's own clock started at, so the edit's
    // media time is the start offset measured from the first sample's decode time.
    let first_decode = track
        .samples
        .first()
        .map(|sample| sample.decode_time)
        .unwrap_or(0);
    let media_time = track.start_offset - first_decode;
    edit.extend_from_slice(&(media_time.clamp(0, i64::from(i32::MAX)) as u32).to_be_bytes());
    edit.extend_from_slice(&0x0001_0000u32.to_be_bytes());
    let edits = boxed(b"edts", &full_box(b"elst", 0, 0, &edit));

    let mut media_header = Vec::new();
    media_header.extend_from_slice(&0u64.to_be_bytes());
    media_header.extend_from_slice(&track.timescale.to_be_bytes());
    media_header
        .extend_from_slice(&(media_duration.clamp(0, i64::from(u32::MAX)) as u32).to_be_bytes());
    media_header.extend_from_slice(&0x55c4u16.to_be_bytes()); // language "und"
    media_header.extend_from_slice(&0u16.to_be_bytes());

    let mut handler = Vec::new();
    handler.extend_from_slice(&0u32.to_be_bytes());
    handler.extend_from_slice(if track.is_video { b"vide" } else { b"soun" });
    handler.extend_from_slice(&[0u8; 12]);
    handler.extend_from_slice(if track.is_video {
        b"VideoHandler\0"
    } else {
        b"SoundHandler\0"
    });

    let media_information_header = if track.is_video {
        full_box(b"vmhd", 0, 1, &[0u8; 8])
    } else {
        full_box(b"smhd", 0, 0, &[0u8; 4])
    };
    let mut reference = Vec::new();
    reference.extend_from_slice(&1u32.to_be_bytes());
    reference.extend_from_slice(&full_box(b"url ", 0, 1, &[]));
    let data_information = boxed(b"dinf", &full_box(b"dref", 0, 0, &reference));

    let mut table = Vec::new();
    let mut description = 1u32.to_be_bytes().to_vec();
    description.extend_from_slice(&track.sample_entry);
    table.extend_from_slice(&full_box(b"stsd", 0, 0, &description));

    // Decode durations, run-length coded.
    let mut runs: Vec<(u32, u32)> = Vec::new();
    for sample in track.samples {
        match runs.last_mut() {
            Some((count, delta)) if *delta == sample.duration => *count += 1,
            _ => runs.push((1, sample.duration)),
        }
    }
    let mut body = (runs.len() as u32).to_be_bytes().to_vec();
    for (count, delta) in &runs {
        body.extend_from_slice(&count.to_be_bytes());
        body.extend_from_slice(&delta.to_be_bytes());
    }
    table.extend_from_slice(&full_box(b"stts", 0, 0, &body));

    // Composition offsets, only when some picture is shown at a different time than it is decoded.
    if track
        .samples
        .iter()
        .any(|sample| sample.composition_time != sample.decode_time)
    {
        let signed = track
            .samples
            .iter()
            .any(|sample| sample.composition_time < sample.decode_time);
        let mut runs: Vec<(u32, i64)> = Vec::new();
        for sample in track.samples {
            let offset = sample.composition_time - sample.decode_time;
            match runs.last_mut() {
                Some((count, value)) if *value == offset => *count += 1,
                _ => runs.push((1, offset)),
            }
        }
        let mut body = (runs.len() as u32).to_be_bytes().to_vec();
        for (count, offset) in &runs {
            body.extend_from_slice(&count.to_be_bytes());
            body.extend_from_slice(
                &((*offset).clamp(i64::from(i32::MIN), i64::from(u32::MAX)) as u32).to_be_bytes(),
            );
        }
        table.extend_from_slice(&full_box(b"ctts", u8::from(signed), 0, &body));
    }

    if track.is_video && track.samples.iter().any(|sample| !sample.sync) {
        let sync: Vec<u32> = track
            .samples
            .iter()
            .enumerate()
            .filter(|(_, sample)| sample.sync)
            .map(|(index, _)| index as u32 + 1)
            .collect();
        let mut body = (sync.len() as u32).to_be_bytes().to_vec();
        for number in sync {
            body.extend_from_slice(&number.to_be_bytes());
        }
        table.extend_from_slice(&full_box(b"stss", 0, 0, &body));
    }

    // Sample-to-chunk and chunk offsets, over this track's chunks.
    let mine: Vec<(usize, &Chunk)> = chunks
        .iter()
        .enumerate()
        .filter(|(_, chunk)| chunk.track == track_index)
        .collect();
    let mut runs: Vec<(u32, u32)> = Vec::new();
    for (number, (_, chunk)) in mine.iter().enumerate() {
        let count = chunk.count as u32;
        if runs.last().map(|run| run.1) != Some(count) {
            runs.push((number as u32 + 1, count));
        }
    }
    let mut body = (runs.len() as u32).to_be_bytes().to_vec();
    for (first, count) in &runs {
        body.extend_from_slice(&first.to_be_bytes());
        body.extend_from_slice(&count.to_be_bytes());
        body.extend_from_slice(&1u32.to_be_bytes());
    }
    table.extend_from_slice(&full_box(b"stsc", 0, 0, &body));

    let mut body = 0u32.to_be_bytes().to_vec();
    body.extend_from_slice(&(track.samples.len() as u32).to_be_bytes());
    for sample in track.samples {
        body.extend_from_slice(&sample.size.to_be_bytes());
    }
    table.extend_from_slice(&full_box(b"stsz", 0, 0, &body));

    let mut body = (mine.len() as u32).to_be_bytes().to_vec();
    for (index, _) in &mine {
        let offset = chunk_offsets.get(*index).copied().unwrap_or(0);
        if large_offsets {
            body.extend_from_slice(&offset.to_be_bytes());
        } else {
            body.extend_from_slice(&(offset as u32).to_be_bytes());
        }
    }
    table.extend_from_slice(&full_box(
        if large_offsets { b"co64" } else { b"stco" },
        0,
        0,
        &body,
    ));

    let mut information = media_information_header;
    information.extend_from_slice(&data_information);
    information.extend_from_slice(&boxed(b"stbl", &table));

    let mut media = full_box(b"mdhd", 0, 0, &media_header);
    media.extend_from_slice(&full_box(b"hdlr", 0, 0, &handler));
    media.extend_from_slice(&boxed(b"minf", &information));

    let mut track_body = track_header;
    track_body.extend_from_slice(&edits);
    track_body.extend_from_slice(&boxed(b"mdia", &media));
    boxed(b"trak", &track_body)
}

fn video_sample_entry(video: &VideoOutput) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(&[0u8; 6]);
    body.extend_from_slice(&1u16.to_be_bytes()); // data reference index
    body.extend_from_slice(&[0u8; 16]);
    body.extend_from_slice(&(video.width.min(65535) as u16).to_be_bytes());
    body.extend_from_slice(&(video.height.min(65535) as u16).to_be_bytes());
    body.extend_from_slice(&0x0048_0000u32.to_be_bytes());
    body.extend_from_slice(&0x0048_0000u32.to_be_bytes());
    body.extend_from_slice(&0u32.to_be_bytes());
    body.extend_from_slice(&1u16.to_be_bytes()); // frame count
    body.extend_from_slice(&[0u8; 32]); // compressor name
    body.extend_from_slice(&0x0018u16.to_be_bytes());
    body.extend_from_slice(&0xffffu16.to_be_bytes());
    put_box(&mut body, b"avcC", &video.configuration);
    boxed(b"avc1", &body)
}

fn descriptor(tag: u8, body: &[u8]) -> Vec<u8> {
    // Four-byte length form, which every reader accepts and keeps the arithmetic simple.
    let length = body.len() as u32;
    let mut out = vec![
        tag,
        0x80 | ((length >> 21) & 0x7f) as u8,
        0x80 | ((length >> 14) & 0x7f) as u8,
        0x80 | ((length >> 7) & 0x7f) as u8,
        (length & 0x7f) as u8,
    ];
    out.extend_from_slice(body);
    out
}

fn audio_sample_entry(audio: &AudioOutput) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(&[0u8; 6]);
    body.extend_from_slice(&1u16.to_be_bytes());
    body.extend_from_slice(&[0u8; 8]);
    body.extend_from_slice(&audio.channels.to_be_bytes());
    body.extend_from_slice(&16u16.to_be_bytes());
    body.extend_from_slice(&[0u8; 4]);
    body.extend_from_slice(&((audio.sample_rate.min(65535)) << 16).to_be_bytes());

    let mut decoder_config = vec![0x40, 0x15, 0, 0, 0];
    decoder_config.extend_from_slice(&0u32.to_be_bytes()); // maximum bitrate (unknown)
    decoder_config.extend_from_slice(&0u32.to_be_bytes()); // average bitrate (unknown)
    decoder_config.extend_from_slice(&descriptor(0x05, &audio.configuration));
    let mut elementary = vec![0, 0, 0]; // ES_ID and flags
    elementary.extend_from_slice(&descriptor(0x04, &decoder_config));
    elementary.extend_from_slice(&descriptor(0x06, &[0x02]));
    body.extend_from_slice(&full_box(b"esds", 0, 0, &descriptor(0x03, &elementary)));
    boxed(b"mp4a", &body)
}

fn video_presented(video: &VideoOutput) -> i64 {
    let end = video
        .samples
        .iter()
        .map(|sample| sample.composition_time + i64::from(sample.duration))
        .max()
        .unwrap_or(0);
    (end - video.start_offset).max(0)
}

/// Write the rendition to `output`, reading sample bytes from `payload` (where the video and audio
/// stages wrote them).
pub fn write(
    video: &VideoOutput,
    audio: Option<&AudioOutput>,
    payload: &Path,
    output: &Path,
) -> Result<()> {
    let mut tracks = vec![TrackDescription {
        id: 1,
        is_video: true,
        timescale: video.timescale,
        matrix: video.matrix,
        width: video.width,
        height: video.height,
        start_offset: video.start_offset,
        presented: video_presented(video),
        sample_entry: video_sample_entry(video),
        samples: &video.samples,
    }];
    if let Some(audio) = audio {
        tracks.push(TrackDescription {
            id: 2,
            is_video: false,
            timescale: audio.timescale,
            matrix: crate::demux::IDENTITY_MATRIX,
            width: 0,
            height: 0,
            start_offset: audio.start_offset,
            presented: audio.presented,
            sample_entry: audio_sample_entry(audio),
            samples: &audio.samples,
        });
    }
    let plans: Vec<TrackPlan<'_>> = tracks
        .iter()
        .map(|track| TrackPlan {
            samples: track.samples,
            timescale: track.timescale,
        })
        .collect();
    let chunks = plan_chunks(&plans);
    let payload_bytes: u64 = chunks.iter().map(|chunk| chunk.bytes).sum();

    let file_type = {
        let mut body = Vec::new();
        body.extend_from_slice(b"isom");
        body.extend_from_slice(&0x200u32.to_be_bytes());
        for brand in [b"isom", b"iso2", b"avc1", b"mp41"] {
            body.extend_from_slice(brand);
        }
        boxed(b"ftyp", &body)
    };
    let large_offsets = payload_bytes > u64::from(u32::MAX) / 2;
    let movie_duration = tracks
        .iter()
        .map(|track| rescale(track.presented, track.timescale, MOVIE_TIMESCALE))
        .max()
        .unwrap_or(0);
    let build_movie = |chunk_offsets: &[u64]| -> Vec<u8> {
        let mut body = movie_header(movie_duration, tracks.len() as u32 + 1);
        for (index, track) in tracks.iter().enumerate() {
            body.extend_from_slice(&track_box(
                track,
                &chunks,
                chunk_offsets,
                large_offsets,
                index,
            ));
        }
        boxed(b"moov", &body)
    };
    // The movie header's size does not depend on the offset values, so build it once to measure it,
    // then again with the real offsets.
    let measured = build_movie(&vec![0u64; chunks.len()]).len() as u64;
    let media_header_size = if payload_bytes + 8 > u64::from(u32::MAX) {
        16u64
    } else {
        8
    };
    let mut offset = file_type.len() as u64 + measured + media_header_size;
    let mut chunk_offsets = Vec::with_capacity(chunks.len());
    for chunk in &chunks {
        chunk_offsets.push(offset);
        offset += chunk.bytes;
    }
    let movie = build_movie(&chunk_offsets);
    if movie.len() as u64 != measured {
        return Err(TranscodeError::internal(
            "the movie header changed size between passes",
        ));
    }

    let mut out = BufWriter::new(File::create(output)?);
    out.write_all(&file_type)?;
    out.write_all(&movie)?;
    if media_header_size == 16 {
        out.write_all(&1u32.to_be_bytes())?;
        out.write_all(b"mdat")?;
        out.write_all(&(payload_bytes + 16).to_be_bytes())?;
    } else {
        out.write_all(&((payload_bytes + 8) as u32).to_be_bytes())?;
        out.write_all(b"mdat")?;
    }
    let mut source = BufReader::new(File::open(payload)?);
    let mut buffer = Vec::new();
    for chunk in &chunks {
        let Some(track) = tracks.get(chunk.track) else {
            continue;
        };
        let Some(first) = track.samples.get(chunk.first) else {
            continue;
        };
        // A chunk's samples were written consecutively by one stage, so they are contiguous.
        source.seek(SeekFrom::Start(first.offset))?;
        buffer.resize(chunk.bytes as usize, 0);
        source.read_exact(&mut buffer)?;
        out.write_all(&buffer)?;
    }
    out.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn samples(count: usize, duration: u32, size: u32) -> Vec<Sample> {
        (0..count)
            .map(|index| Sample {
                offset: index as u64 * u64::from(size),
                size,
                decode_time: index as i64 * i64::from(duration),
                composition_time: index as i64 * i64::from(duration),
                duration,
                sync: true,
            })
            .collect()
    }

    #[test]
    fn chunks_interleave_by_time_and_cover_every_sample() {
        let video = samples(60, 1000, 10); // 30 fps at 30000
        let audio = samples(47, 1024, 4); // 48 kHz
        let plans = [
            TrackPlan {
                samples: &video,
                timescale: 30000,
            },
            TrackPlan {
                samples: &audio,
                timescale: 48000,
            },
        ];
        let chunks = plan_chunks(&plans);
        assert_eq!(
            chunks
                .iter()
                .filter(|chunk| chunk.track == 0)
                .map(|chunk| chunk.count)
                .sum::<usize>(),
            60
        );
        assert_eq!(
            chunks
                .iter()
                .filter(|chunk| chunk.track == 1)
                .map(|chunk| chunk.count)
                .sum::<usize>(),
            47
        );
        assert!(chunks.windows(2).any(|pair| pair[0].track != pair[1].track));
    }

    #[test]
    fn descriptors_use_the_four_byte_length() {
        assert_eq!(descriptor(5, &[1, 2]), vec![5, 0x80, 0x80, 0x80, 2, 1, 2]);
    }
}
