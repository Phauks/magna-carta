//! Matroska (and so `.mkv`). The demuxer reads blocks in file order, so the chosen video and audio
//! tracks are spooled into one side file and indexed, which gives the rest of the engine the same
//! random-access sample table an MP4 has.

use std::fs::File;
use std::io::{BufReader, BufWriter, Write};
use std::path::Path;

use matroska_demuxer::{Frame, MatroskaFile, TrackType};

use super::{
    AudioCodec, AudioTrack, Media, PcmLayout, Sample, VideoCodec, VideoTrack, IDENTITY_MATRIX,
};
use crate::error::{Result, TranscodeError};
use crate::limits;

fn malformed(what: &str) -> TranscodeError {
    TranscodeError::malformed(format!("Matroska: {what}"))
}

/// AAC sampling frequency indices (ISO/IEC 14496-3, table 1.18).
const AAC_SAMPLE_RATES: [u32; 13] = [
    96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
];

/// The AudioSpecificConfig for AAC-LC, for the legacy codec ids that carry no private data.
fn low_complexity_configuration(sample_rate: u32, channels: u16) -> Result<Vec<u8>> {
    let index = AAC_SAMPLE_RATES
        .iter()
        .position(|&rate| rate == sample_rate)
        .ok_or_else(|| malformed("an AAC track has a non-standard sample rate"))?
        as u16;
    let value = (2u16 << 11) | (index << 7) | ((channels & 0x0f) << 3);
    Ok(value.to_be_bytes().to_vec())
}

/// The first video track's description, before its frames are read.
struct VideoChoice {
    number: u64,
    codec: VideoCodec,
    configuration: Vec<u8>,
    width: u32,
    height: u32,
    frame_duration: Option<u64>,
}

/// The first audio track's description.
struct AudioChoice {
    number: u64,
    codec: AudioCodec,
    configuration: Vec<u8>,
    sample_rate: u32,
    channels: u16,
}

struct Chosen {
    number: u64,
    is_video: bool,
}

pub fn read(path: &Path, spool_directory: &Path) -> Result<Media> {
    let file = BufReader::new(File::open(path)?);
    let mut matroska = MatroskaFile::open(file)
        .map_err(|error| malformed(&format!("the header cannot be read ({error})")))?;
    let scale = matroska.info().timestamp_scale().get();
    let timescale = u32::try_from(1_000_000_000u64 / scale.max(1))
        .unwrap_or(1)
        .max(1);

    let mut video: Option<VideoChoice> = None;
    let mut audio: Option<AudioChoice> = None;
    let mut unsupported_audio = None;
    for track in matroska.tracks() {
        if track
            .content_encodings()
            .is_some_and(|encodings| !encodings.is_empty())
        {
            // Header stripping or compressed blocks: the frames are not the codec's own bytes.
            if matches!(track.track_type(), TrackType::Video | TrackType::Audio) {
                return Err(TranscodeError::unsupported(
                    "Matroska tracks with content encodings",
                ));
            }
            continue;
        }
        let number = track.track_number().get();
        match track.track_type() {
            TrackType::Video if video.is_none() => {
                let codec = match track.codec_id() {
                    "V_MPEG4/ISO/AVC" => VideoCodec::H264,
                    "V_MPEGH/ISO/HEVC" => VideoCodec::Hevc,
                    other => {
                        return Err(TranscodeError::unsupported(format!("video codec {other}")))
                    }
                };
                let configuration = track
                    .codec_private()
                    .ok_or_else(|| malformed("a video track has no decoder configuration"))?
                    .to_vec();
                let picture = track
                    .video()
                    .ok_or_else(|| malformed("a video track has no picture size"))?;
                let width = u32::try_from(picture.pixel_width().get()).unwrap_or(u32::MAX);
                let height = u32::try_from(picture.pixel_height().get()).unwrap_or(u32::MAX);
                let frame_duration = track.default_duration().map(|ns| ns.get() / scale.max(1));
                video = Some(VideoChoice {
                    number,
                    codec,
                    configuration,
                    width,
                    height,
                    frame_duration,
                });
            }
            TrackType::Audio if audio.is_none() => {
                let settings = track
                    .audio()
                    .ok_or_else(|| malformed("an audio track has no settings"))?;
                let sample_rate = settings
                    .sampling_frequency()
                    .round()
                    .clamp(0.0, 1_000_000.0) as u32;
                let channels = u16::try_from(settings.channels().get()).unwrap_or(u16::MAX);
                if channels == 0 || channels > limits::MAX_AUDIO_CHANNELS {
                    return Err(TranscodeError::unsupported(format!(
                        "{channels} audio channels"
                    )));
                }
                let bits = settings.bit_depth().map(|bits| bits.get()).unwrap_or(16);
                let bits = u16::try_from(bits).unwrap_or(0);
                let private = track.codec_private().unwrap_or_default();
                let pcm = |float: bool, big_endian: bool| {
                    AudioCodec::Pcm(PcmLayout {
                        bits,
                        float,
                        big_endian,
                        unsigned: bits == 8,
                    })
                };
                let (codec, configuration) = match track.codec_id() {
                    "A_AAC" => (AudioCodec::Aac, private.to_vec()),
                    id if id.starts_with("A_AAC/") => {
                        if !id.ends_with("/LC") {
                            return Err(TranscodeError::unsupported(format!("audio codec {id}")));
                        }
                        (
                            AudioCodec::Aac,
                            low_complexity_configuration(sample_rate, channels)?,
                        )
                    }
                    "A_MPEG/L3" => (AudioCodec::Mp3, Vec::new()),
                    "A_FLAC" => {
                        // "fLaC", then metadata blocks; STREAMINFO is first, with a four-byte header.
                        let block = private
                            .get(8..8 + 34)
                            .ok_or_else(|| malformed("a FLAC track has no STREAMINFO"))?;
                        (AudioCodec::Flac, block.to_vec())
                    }
                    "A_PCM/INT/LIT" => (pcm(false, false), Vec::new()),
                    "A_PCM/INT/BIG" => (pcm(false, true), Vec::new()),
                    "A_PCM/FLOAT/IEEE" => (pcm(true, false), Vec::new()),
                    other => {
                        unsupported_audio.get_or_insert(other.to_string());
                        continue;
                    }
                };
                if let AudioCodec::Pcm(layout) = codec {
                    let valid = if layout.float {
                        matches!(layout.bits, 32 | 64)
                    } else {
                        matches!(layout.bits, 8 | 16 | 24 | 32)
                    };
                    if !valid {
                        return Err(TranscodeError::unsupported(format!("{bits}-bit PCM")));
                    }
                }
                audio = Some(AudioChoice {
                    number,
                    codec,
                    configuration,
                    sample_rate,
                    channels,
                });
            }
            _ => {}
        }
    }
    let VideoChoice {
        number: video_number,
        codec: video_codec,
        configuration: video_configuration,
        width,
        height,
        frame_duration,
    } = video.ok_or_else(|| TranscodeError::unsupported("the file has no video track"))?;
    if audio.is_none() {
        if let Some(codec) = unsupported_audio {
            return Err(TranscodeError::unsupported(format!("audio codec {codec}")));
        }
    }

    // Spool the two tracks' frames, remembering where each landed and its presentation time.
    let spool_path = spool_directory.join("matroska-spool");
    let mut spool = BufWriter::new(File::create(&spool_path)?);
    let mut position = 0u64;
    let mut video_frames: Vec<(u64, u32, u64, bool)> = Vec::new();
    let mut audio_frames: Vec<(u64, u32, u64)> = Vec::new();
    let audio_number = audio.as_ref().map(|choice| choice.number);
    let chosen = [
        Some(Chosen {
            number: video_number,
            is_video: true,
        }),
        audio_number.map(|number| Chosen {
            number,
            is_video: false,
        }),
    ];
    let mut frame = Frame::default();
    while matroska
        .next_frame(&mut frame)
        .map_err(|error| malformed(&format!("a block cannot be read ({error})")))?
    {
        let Some(target) = chosen
            .iter()
            .flatten()
            .find(|chosen| chosen.number == frame.track)
        else {
            continue;
        };
        let size = u32::try_from(frame.data.len())
            .map_err(|_| TranscodeError::too_large("a block is over the size ceiling"))?;
        if size > limits::MAX_SAMPLE_BYTES {
            return Err(TranscodeError::too_large(
                "a block is over the size ceiling",
            ));
        }
        spool.write_all(&frame.data)?;
        if target.is_video {
            video_frames.push((
                position,
                size,
                frame.timestamp,
                frame.is_keyframe.unwrap_or(false),
            ));
        } else {
            audio_frames.push((position, size, frame.timestamp));
        }
        if video_frames.len() + audio_frames.len() > limits::MAX_SAMPLES_PER_TRACK {
            return Err(TranscodeError::too_large(
                "the file has more frames than the ceiling",
            ));
        }
        position += u64::from(size);
    }
    spool.flush()?;
    drop(spool);

    // Block timestamps are presentation times in decode order. Decode times are the sorted
    // presentation times, shifted back just enough that no frame is presented before it is decoded;
    // the shift becomes the track's start offset, exactly as an MP4 edit list carries it.
    let mut presentation: Vec<u64> = video_frames.iter().map(|frame| frame.2).collect();
    presentation.sort_unstable();
    let first = presentation.first().copied().unwrap_or(0);
    let shift = video_frames
        .iter()
        .zip(&presentation)
        .map(|(frame, &sorted)| sorted as i64 - frame.2 as i64)
        .max()
        .unwrap_or(0)
        .max(0);
    let fallback = frame_duration.unwrap_or(u64::from(timescale) / 30).max(1);
    let any_keyframe_flags = video_frames.iter().any(|frame| frame.3);
    let mut video_samples = Vec::with_capacity(video_frames.len());
    for (index, &(offset, size, timestamp, keyframe)) in video_frames.iter().enumerate() {
        let decode_time = presentation[index] as i64 - first as i64;
        let duration = presentation
            .get(index + 1)
            .map(|next| next - presentation[index])
            .unwrap_or(fallback);
        video_samples.push(Sample {
            offset,
            size,
            decode_time,
            composition_time: timestamp as i64 - first as i64 + shift,
            duration: u32::try_from(duration).unwrap_or(u32::MAX),
            sync: if any_keyframe_flags {
                keyframe
            } else {
                index == 0
            },
        });
    }
    let video = VideoTrack {
        codec: video_codec,
        configuration: video_configuration,
        timescale,
        width,
        height,
        matrix: IDENTITY_MATRIX,
        start_offset: shift,
        samples: video_samples,
        data: spool_path.clone(),
    };

    let audio = match audio {
        None => None,
        Some(AudioChoice {
            codec,
            configuration,
            sample_rate,
            channels,
            ..
        }) => {
            let audio_first = audio_frames.first().map(|frame| frame.2).unwrap_or(0);
            let mut samples = Vec::with_capacity(audio_frames.len());
            let mut last_duration = 0u64;
            for (index, &(offset, size, timestamp)) in audio_frames.iter().enumerate() {
                let duration = audio_frames
                    .get(index + 1)
                    .map(|next| next.2.saturating_sub(timestamp))
                    .unwrap_or(last_duration);
                last_duration = duration;
                let time = timestamp.saturating_sub(audio_first) as i64;
                samples.push(Sample {
                    offset,
                    size,
                    decode_time: time,
                    composition_time: time,
                    duration: u32::try_from(duration).unwrap_or(u32::MAX),
                    sync: true,
                });
            }
            Some(AudioTrack {
                codec,
                configuration,
                sample_rate,
                channels,
                timescale,
                start_offset: 0,
                samples,
                data: spool_path,
            })
        }
    };
    Ok(Media { video, audio })
}
