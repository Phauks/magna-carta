//! The sound half of a transcode: AAC is copied as it is; MP3, FLAC and PCM are decoded and encoded
//! as AAC-LC, which every browser plays inside MP4.

use std::fs::File;
use std::io::{BufWriter, Write};

use symphonia::core::codecs::audio::well_known::{CODEC_ID_FLAC, CODEC_ID_MP3};
use symphonia::core::codecs::audio::{AudioCodecParameters, AudioDecoder, AudioDecoderOptions};
use symphonia::core::packet::Packet;
use symphonia::core::units::{Duration, Timestamp};

use crate::demux::{AudioCodec, AudioTrack, PcmLayout, Sample, SampleReader};
use crate::error::{Result, TranscodeError};

/// AAC sampling frequency indices (ISO/IEC 14496-3, table 1.18) the encoder accepts.
const AAC_SAMPLE_RATES: [u32; 12] = [
    96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000,
];

/// The highest rate the rendition carries; anything above is resampled to it. A viewing copy gains
/// nothing from 96 kHz, and the MP4 sample entry's rate field is only 16 bits wide.
const MAX_OUTPUT_RATE: u32 = 48000;

/// AAC-LC encodes 1024 samples per channel per frame.
const FRAME_LENGTH: usize = 1024;

#[derive(Debug, Clone)]
pub struct AudioOutput {
    /// The AudioSpecificConfig.
    pub configuration: Vec<u8>,
    pub sample_rate: u32,
    pub channels: u16,
    pub timescale: u32,
    /// Media time the presentation starts at (the encoder's priming frame, for an encode).
    pub start_offset: i64,
    /// How long the presentation lasts, in the track's timescale.
    pub presented: i64,
    pub samples: Vec<Sample>,
    pub copied: bool,
}

/// The core sampling rate and object type an AudioSpecificConfig declares.
fn specific_config_rate(configuration: &[u8]) -> Result<(u32, u8)> {
    let bad = || TranscodeError::malformed("the AAC configuration is malformed");
    let first = *configuration.first().ok_or_else(bad)?;
    let second = *configuration.get(1).ok_or_else(bad)?;
    let object_type = first >> 3;
    let index = ((first & 0x07) << 1) | (second >> 7);
    let rate = if index == 15 {
        let bytes = configuration.get(1..5).ok_or_else(bad)?;
        ((u32::from(bytes[0] & 0x7f) << 17)
            | (u32::from(bytes[1]) << 9)
            | (u32::from(bytes[2]) << 1)
            | (u32::from(bytes[3]) >> 7))
            & 0x00ff_ffff
    } else {
        *[
            96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
        ]
        .get(usize::from(index))
        .ok_or_else(bad)?
    };
    Ok((rate, object_type))
}

pub fn convert(
    track: &AudioTrack,
    payload: &mut BufWriter<File>,
    payload_start: u64,
) -> Result<AudioOutput> {
    match track.codec {
        AudioCodec::Aac => copy_aac(track, payload, payload_start),
        _ => encode(track, payload, payload_start),
    }
}

fn copy_aac(
    track: &AudioTrack,
    payload: &mut BufWriter<File>,
    payload_start: u64,
) -> Result<AudioOutput> {
    let (core_rate, object_type) = specific_config_rate(&track.configuration)?;
    // LC, and HE-AAC v1 and v2 (LC with spectral band replication, and with parametric stereo):
    // the profiles browsers decode. AAC Main and LTP are not.
    if !matches!(object_type, 2 | 5 | 29) {
        return Err(TranscodeError::unsupported(format!(
            "AAC object type {object_type}"
        )));
    }
    if core_rate == 0 {
        return Err(TranscodeError::malformed(
            "the AAC configuration has no sample rate",
        ));
    }
    // An MP4 source keeps its own timing; a source timed in milliseconds (Matroska) is re-timed at
    // the core rate, one frame of 1024 samples per packet, so the rendition's timing is exact.
    let retime = track.timescale != core_rate && track.timescale != track.sample_rate;
    let timescale = if retime { core_rate } else { track.timescale };
    let mut reader = SampleReader::open(&track.data)?;
    let mut buffer = Vec::new();
    let mut position = payload_start;
    let mut samples = Vec::with_capacity(track.samples.len());
    for (index, sample) in track.samples.iter().enumerate() {
        reader.read(sample, &mut buffer)?;
        payload.write_all(&buffer)?;
        let (time, duration) = if retime {
            ((index * FRAME_LENGTH) as i64, FRAME_LENGTH as u32)
        } else {
            (sample.decode_time, sample.duration)
        };
        samples.push(Sample {
            offset: position,
            size: sample.size,
            decode_time: time,
            composition_time: time,
            duration,
            sync: true,
        });
        position += u64::from(sample.size);
    }
    let start_offset = if retime { 0 } else { track.start_offset };
    let total: i64 = samples
        .iter()
        .map(|sample| i64::from(sample.duration))
        .sum();
    Ok(AudioOutput {
        configuration: track.configuration.clone(),
        sample_rate: track.sample_rate,
        channels: track.channels,
        timescale,
        start_offset,
        presented: (total - start_offset).max(0),
        samples,
        copied: true,
    })
}

/// Turns stored PCM bytes into interleaved samples on the -1..1 scale.
fn pcm_to_float(layout: PcmLayout, bytes: &[u8], out: &mut Vec<f32>) {
    let width = layout.bytes_per_sample();
    for chunk in bytes.chunks_exact(width) {
        let mut ordered = [0u8; 8];
        for (index, &byte) in chunk.iter().enumerate() {
            let target = if layout.big_endian {
                width - 1 - index
            } else {
                index
            };
            if let Some(slot) = ordered.get_mut(target) {
                *slot = byte;
            }
        }
        let value = match (layout.float, layout.bits) {
            (true, 32) => f32::from_le_bytes([ordered[0], ordered[1], ordered[2], ordered[3]]),
            (true, _) => f64::from_le_bytes(ordered) as f32,
            (false, 8) if layout.unsigned => (f32::from(ordered[0]) - 128.0) / 128.0,
            (false, 8) => f32::from(ordered[0] as i8) / 128.0,
            (false, 16) => f32::from(i16::from_le_bytes([ordered[0], ordered[1]])) / 32768.0,
            (false, 24) => {
                (i32::from_le_bytes([0, ordered[0], ordered[1], ordered[2]]) >> 8) as f32
                    / 8_388_608.0
            }
            (false, _) => {
                i32::from_le_bytes([ordered[0], ordered[1], ordered[2], ordered[3]]) as f32
                    / 2_147_483_648.0
            }
        };
        out.push(if value.is_finite() {
            value.clamp(-1.0, 1.0)
        } else {
            0.0
        });
    }
}

enum Source {
    Pcm(PcmLayout),
    Symphonia(Box<dyn AudioDecoder>),
}

fn symphonia_decoder(track: &AudioTrack) -> Result<Box<dyn AudioDecoder>> {
    let mut parameters = AudioCodecParameters::new();
    match track.codec {
        AudioCodec::Mp3 => {
            parameters.for_codec(CODEC_ID_MP3);
        }
        AudioCodec::Flac => {
            parameters
                .for_codec(CODEC_ID_FLAC)
                .with_extra_data(track.configuration.clone().into_boxed_slice());
        }
        _ => return Err(TranscodeError::internal("not a compressed audio codec")),
    }
    parameters.with_sample_rate(track.sample_rate);
    symphonia::default::get_codecs()
        .make_audio_decoder(&parameters, &AudioDecoderOptions::default())
        .map_err(|error| {
            TranscodeError::malformed(format!("the audio decoder refused the stream ({error})"))
        })
}

/// Mixes more than two channels down to stereo, taking the common WAV/MP4 order (left, right, centre,
/// low-frequency, then surround pairs). The low-frequency channel is dropped, as every downmix does.
fn downmix(interleaved: &[f32], channels: usize, out: &mut Vec<f32>) {
    const CENTRE: f32 = std::f32::consts::FRAC_1_SQRT_2;
    let surround_pairs = channels.saturating_sub(4).div_ceil(2);
    let normalise = 1.0 + CENTRE + CENTRE * surround_pairs as f32;
    for frame in interleaved.chunks_exact(channels) {
        let mut left = frame.first().copied().unwrap_or(0.0);
        let mut right = frame.get(1).copied().unwrap_or(0.0);
        let centre = frame.get(2).copied().unwrap_or(0.0) * CENTRE;
        left += centre;
        right += centre;
        for (index, &value) in frame.iter().enumerate().skip(4) {
            if index % 2 == 0 {
                left += value * CENTRE;
            } else {
                right += value * CENTRE;
            }
        }
        out.push(left / normalise);
        out.push(right / normalise);
    }
}

/// Linear-interpolating resampler that carries its position across calls.
struct Resampler {
    step: f64,
    channels: usize,
    /// The next output's position, measured in input frames from the start of the coming buffer;
    /// -1 means the previous buffer's last frame.
    next: f64,
    previous: Vec<f32>,
}

impl Resampler {
    fn new(input_rate: u32, output_rate: u32, channels: usize) -> Self {
        Self {
            step: f64::from(input_rate) / f64::from(output_rate),
            channels,
            next: 0.0,
            previous: vec![0.0; channels],
        }
    }

    fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        let channels = self.channels;
        let frames = input.len() / channels;
        if frames == 0 {
            return;
        }
        let frame_at = |index: isize, channel: usize| -> f32 {
            if index < 0 {
                self.previous.get(channel).copied().unwrap_or(0.0)
            } else {
                input
                    .get(index as usize * channels + channel)
                    .copied()
                    .unwrap_or(0.0)
            }
        };
        while self.next < (frames - 1) as f64 {
            let base = self.next.floor();
            let fraction = (self.next - base) as f32;
            let index = base as isize;
            for channel in 0..channels {
                let a = frame_at(index, channel);
                let b = frame_at(index + 1, channel);
                out.push(a + (b - a) * fraction);
            }
            self.next += self.step;
        }
        self.next -= frames as f64;
        self.previous = input
            .get((frames - 1) * channels..frames * channels)
            .map(<[f32]>::to_vec)
            .unwrap_or_default();
    }
}

/// Samples per channel the AAC encoder is handed at once. The encoder holds what it is given until it
/// finishes, so a long recording is encoded in segments of a minute (at 48 kHz) to keep memory flat.
const SEGMENT_FRAMES: usize = FRAME_LENGTH * 2812;

/// Streams PCM into AAC-LC in segments that join without a seam.
///
/// The encoder's first packet is priming (it reconstructs the hop before the input), and its last
/// covers the final hop against silence. So each segment after the first starts one hop early and
/// drops its priming packet, and each segment but the last drops its closing packet: the packets that
/// remain are exactly the ones one encoder would have written over the whole recording.
struct Encoder {
    channels: usize,
    sample_rate: u32,
    bitrate: u32,
    /// Interleaved samples waiting for the current segment to fill, starting with the carried hop.
    pending: Vec<f32>,
    /// Whether `pending` begins with a hop carried from the previous segment.
    carried: bool,
    samples: Vec<Sample>,
    position: u64,
    input_frames: u64,
}

impl Encoder {
    fn new(channels: usize, sample_rate: u32, payload_start: u64) -> Self {
        Self {
            channels,
            sample_rate,
            // The encoder needs more bits than FFmpeg's for the same fidelity: at these rates it measured
            // level with FFmpeg's at 160 kbit/s stereo. Sound is a small share of a video's size.
            bitrate: if channels == 1 { 128_000 } else { 256_000 },
            pending: Vec::new(),
            carried: false,
            samples: Vec::new(),
            position: payload_start,
            input_frames: 0,
        }
    }

    fn write(&mut self, unit: &[u8], payload: &mut BufWriter<File>) -> Result<()> {
        payload.write_all(unit)?;
        let index = self.samples.len() as i64;
        let size = u32::try_from(unit.len())
            .map_err(|_| TranscodeError::internal("an AAC frame is too large"))?;
        self.samples.push(Sample {
            offset: self.position,
            size,
            decode_time: index * FRAME_LENGTH as i64,
            composition_time: index * FRAME_LENGTH as i64,
            duration: FRAME_LENGTH as u32,
            sync: true,
        });
        self.position += u64::from(size);
        Ok(())
    }

    /// Encode everything pending as one segment.
    fn encode_segment(&mut self, last: bool, payload: &mut BufWriter<File>) -> Result<()> {
        let config = rusty_aac::encode::AacEncoderConfig {
            bitrate_bps: self.bitrate,
            ..Default::default()
        };
        let mut encoder = rusty_aac::encode::AacEncoder::new(config);
        let channels = u16::try_from(self.channels)
            .map_err(|_| TranscodeError::internal("too many channels"))?;
        encoder
            .push_pcm(&self.pending, channels, self.sample_rate)
            .map_err(|error| {
                TranscodeError::internal(format!("the AAC encoder refused the sound ({error:?})"))
            })?;
        encoder.finish();
        let mut packets = Vec::new();
        while let Ok(packet) = encoder.next_packet() {
            packets.push(packet.data);
        }
        let skip = usize::from(self.carried);
        let keep = if last {
            packets.len()
        } else {
            packets.len().saturating_sub(1)
        };
        for packet in packets.iter().take(keep).skip(skip) {
            self.write(packet, payload)?;
        }
        // Carry the segment's last hop into the next one.
        let hop = FRAME_LENGTH * self.channels;
        let carry_from = self.pending.len().saturating_sub(hop);
        self.pending.drain(..carry_from);
        self.carried = true;
        Ok(())
    }

    fn push(&mut self, interleaved: &[f32], payload: &mut BufWriter<File>) -> Result<()> {
        self.input_frames += (interleaved.len() / self.channels) as u64;
        self.pending.extend_from_slice(interleaved);
        let carried_frames = if self.carried { FRAME_LENGTH } else { 0 };
        while self.pending.len() / self.channels >= SEGMENT_FRAMES + carried_frames {
            let split =
                (SEGMENT_FRAMES + if self.carried { FRAME_LENGTH } else { 0 }) * self.channels;
            let rest = self.pending.split_off(split);
            self.encode_segment(false, payload)?;
            self.pending.extend_from_slice(&rest);
        }
        Ok(())
    }

    fn finish(&mut self, payload: &mut BufWriter<File>) -> Result<()> {
        self.encode_segment(true, payload)
    }
}

fn encode(
    track: &AudioTrack,
    payload: &mut BufWriter<File>,
    payload_start: u64,
) -> Result<AudioOutput> {
    let mut source = match track.codec {
        AudioCodec::Pcm(layout) => Source::Pcm(layout),
        _ => Source::Symphonia(symphonia_decoder(track)?),
    };
    let mut reader = SampleReader::open(&track.data)?;
    let mut buffer = Vec::new();
    let mut decoded: Vec<f32> = Vec::new();
    let mut mixed: Vec<f32> = Vec::new();
    let mut resampled: Vec<f32> = Vec::new();
    let mut encoder: Option<(Encoder, Option<Resampler>, usize)> = None;
    let mut errors = 0usize;
    for sample in &track.samples {
        reader.read(sample, &mut buffer)?;
        decoded.clear();
        let (rate, channels) = match &mut source {
            Source::Pcm(layout) => {
                pcm_to_float(*layout, &buffer, &mut decoded);
                (track.sample_rate, usize::from(track.channels))
            }
            Source::Symphonia(decoder) => {
                let packet = Packet::new(
                    0,
                    Timestamp::new(sample.decode_time),
                    Duration::new(u64::from(sample.duration)),
                    buffer.clone(),
                );
                match decoder.decode(&packet) {
                    Ok(output) => {
                        let spec = output.spec();
                        let rate = spec.rate();
                        let channels = spec.channels().count();
                        output.copy_to_vec_interleaved(&mut decoded);
                        (rate, channels)
                    }
                    Err(error) => {
                        errors += 1;
                        if errors > 64 {
                            return Err(TranscodeError::malformed(format!(
                                "the sound keeps failing to decode ({error})"
                            )));
                        }
                        continue;
                    }
                }
            }
        };
        if channels == 0 || rate == 0 {
            continue;
        }
        if encoder.is_none() {
            let output_channels = channels.min(2);
            let output_rate = if rate <= MAX_OUTPUT_RATE && AAC_SAMPLE_RATES.contains(&rate) {
                rate
            } else {
                MAX_OUTPUT_RATE
            };
            let resampler =
                (output_rate != rate).then(|| Resampler::new(rate, output_rate, output_channels));
            encoder = Some((
                Encoder::new(output_channels, output_rate, payload_start),
                resampler,
                channels,
            ));
        }
        let Some((active, resampler, expected_channels)) = encoder.as_mut() else {
            break;
        };
        if channels != *expected_channels {
            return Err(TranscodeError::unsupported(
                "a sound track whose channel count changes part-way",
            ));
        }
        mixed.clear();
        let stereo_or_mono: &[f32] = if channels > 2 {
            downmix(&decoded, channels, &mut mixed);
            &mixed
        } else {
            &decoded
        };
        match resampler {
            Some(resampler) => {
                resampled.clear();
                resampler.process(stereo_or_mono, &mut resampled);
                active.push(&resampled, payload)?;
            }
            None => active.push(stereo_or_mono, payload)?,
        }
    }
    let Some((mut active, _, _)) = encoder else {
        return Err(TranscodeError::malformed(
            "no sound could be decoded from the audio track",
        ));
    };
    active.finish(payload)?;
    let output_rate = active.sample_rate;
    let first_decode = track
        .samples
        .first()
        .map(|sample| sample.decode_time)
        .unwrap_or(0);
    let source_skip = (i128::from((track.start_offset - first_decode).max(0))
        * i128::from(output_rate)
        / i128::from(track.timescale.max(1)))
    .clamp(0, i128::from(i32::MAX)) as i64;
    let channels = active.channels as u16;
    let index = AAC_SAMPLE_RATES
        .iter()
        .position(|&rate| rate == output_rate)
        .unwrap_or(3) as u16;
    let configuration = ((2u16 << 11) | (index << 7) | (channels << 3))
        .to_be_bytes()
        .to_vec();
    Ok(AudioOutput {
        configuration,
        sample_rate: output_rate,
        channels,
        timescale: output_rate,
        // The encoder's first frame is priming (decoded frame f reconstructs input hop f - 1), and
        // the source's own edit (an MP3 encoder's delay, say) still has to be skipped after it.
        start_offset: FRAME_LENGTH as i64 + source_skip,
        presented: (i64::try_from(active.input_frames).unwrap_or(i64::MAX) - source_skip).max(0),
        samples: active.samples,
        copied: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_rate_from_an_audio_specific_config() {
        // AAC-LC, 48 kHz, stereo.
        assert_eq!(specific_config_rate(&[0x11, 0x90]).unwrap(), (48000, 2));
        // AAC-LC, 44.1 kHz, mono.
        assert_eq!(specific_config_rate(&[0x12, 0x08]).unwrap(), (44100, 2));
    }

    #[test]
    fn pcm_layouts_decode_to_the_unit_scale() {
        let mut out = Vec::new();
        pcm_to_float(
            PcmLayout {
                bits: 16,
                float: false,
                big_endian: false,
                unsigned: false,
            },
            &[0x00, 0x80, 0xff, 0x7f],
            &mut out,
        );
        assert!((out[0] + 1.0).abs() < 1e-6 && (out[1] - 1.0).abs() < 1e-3);
        out.clear();
        pcm_to_float(
            PcmLayout {
                bits: 24,
                float: false,
                big_endian: true,
                unsigned: false,
            },
            &[0x40, 0x00, 0x00],
            &mut out,
        );
        assert!((out[0] - 0.5).abs() < 1e-6);
        out.clear();
        pcm_to_float(
            PcmLayout {
                bits: 8,
                float: false,
                big_endian: false,
                unsigned: true,
            },
            &[128],
            &mut out,
        );
        assert_eq!(out[0], 0.0);
    }

    #[test]
    fn resampling_keeps_the_rate_ratio_across_buffers() {
        let mut resampler = Resampler::new(44100, 48000, 1);
        let mut out = Vec::new();
        for _ in 0..10 {
            resampler.process(&vec![0.25f32; 4410], &mut out);
        }
        let expected = 48000.0 * 44100.0 / 44100.0;
        assert!((out.len() as f64 - expected).abs() < 3.0, "{}", out.len());
        assert!(out.iter().all(|&value| (value - 0.25).abs() < 1e-6));
    }

    #[test]
    fn five_one_downmixes_without_clipping() {
        let mut out = Vec::new();
        downmix(&[1.0; 6], 6, &mut out);
        assert_eq!(out.len(), 2);
        assert!(out.iter().all(|&value| value <= 1.0 && value > 0.9));
    }
}
