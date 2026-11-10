//! Reading a source file into one video track and at most one audio track, each a codec description
//! plus a sample table that points at byte ranges of a data file. MP4 and QuickTime tables point into
//! the source itself; a Matroska source is spooled into a side file first, so everything downstream
//! reads samples the same way whatever the container was.

pub mod isobmff;
pub mod matroska;

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use crate::error::{Result, TranscodeError};
use crate::limits;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoCodec {
    H264,
    Hevc,
}

/// How uncompressed sound is laid out in the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PcmLayout {
    pub bits: u16,
    pub float: bool,
    pub big_endian: bool,
    /// Eight-bit PCM in QuickTime (`raw `) and WAV conventions is unsigned; every wider integer
    /// format is signed.
    pub unsigned: bool,
}

impl PcmLayout {
    pub fn bytes_per_sample(&self) -> usize {
        usize::from(self.bits / 8)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioCodec {
    Aac,
    Mp3,
    Flac,
    Pcm(PcmLayout),
}

/// One coded sample (a video access unit, or an audio packet) in a data file. Times are in the
/// track's timescale; `composition_time` is the presentation time, `decode_time` the decode time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Sample {
    pub offset: u64,
    pub size: u32,
    pub decode_time: i64,
    pub composition_time: i64,
    pub duration: u32,
    pub sync: bool,
}

#[derive(Debug, Clone)]
pub struct VideoTrack {
    pub codec: VideoCodec,
    /// The decoder configuration record exactly as stored: `avcC` for H.264, `hvcC` for HEVC.
    pub configuration: Vec<u8>,
    pub timescale: u32,
    pub width: u32,
    pub height: u32,
    /// The track's display transform (a phone's rotation lives here), copied into the rendition.
    pub matrix: [i32; 9],
    /// The media time the presentation starts at, from the source's edit list.
    pub start_offset: i64,
    pub samples: Vec<Sample>,
    pub data: PathBuf,
}

#[derive(Debug, Clone)]
pub struct AudioTrack {
    pub codec: AudioCodec,
    /// The AudioSpecificConfig for AAC, the STREAMINFO block for FLAC, empty otherwise.
    pub configuration: Vec<u8>,
    pub sample_rate: u32,
    pub channels: u16,
    pub timescale: u32,
    pub start_offset: i64,
    pub samples: Vec<Sample>,
    pub data: PathBuf,
}

#[derive(Debug, Clone)]
pub struct Media {
    pub video: VideoTrack,
    pub audio: Option<AudioTrack>,
}

/// The identity matrix in the ISO base media file format's 16.16 / 2.30 fixed-point encoding.
pub const IDENTITY_MATRIX: [i32; 9] = [0x0001_0000, 0, 0, 0, 0x0001_0000, 0, 0, 0, 0x4000_0000];

/// Which container the bytes are, by their signature rather than by the name the caller gave.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Container {
    IsoBaseMedia,
    Matroska,
}

pub fn sniff(path: &Path) -> Result<Container> {
    let mut head = [0u8; 12];
    let mut file = File::open(path)?;
    let read = file.read(&mut head)?;
    let head = head.get(..read).unwrap_or_default();
    if head.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        return Ok(Container::Matroska);
    }
    if let Some(kind) = head.get(4..8) {
        if matches!(
            kind,
            b"ftyp" | b"moov" | b"mdat" | b"wide" | b"free" | b"skip" | b"pnot"
        ) {
            return Ok(Container::IsoBaseMedia);
        }
    }
    Err(TranscodeError::unsupported(
        "the file is neither MP4, QuickTime nor Matroska",
    ))
}

/// Read a source into its tracks. `spool_directory` receives the side file a Matroska source needs.
pub fn open(path: &Path, spool_directory: &Path) -> Result<Media> {
    let media = match sniff(path)? {
        Container::IsoBaseMedia => isobmff::read(path)?,
        Container::Matroska => matroska::read(path, spool_directory)?,
    };
    check(&media)?;
    Ok(media)
}

fn check(media: &Media) -> Result<()> {
    let video = &media.video;
    if video.samples.is_empty() {
        return Err(TranscodeError::malformed("the video track has no samples"));
    }
    if video.timescale == 0 {
        return Err(TranscodeError::malformed(
            "the video track has no timescale",
        ));
    }
    let duration_ticks: i64 = video
        .samples
        .iter()
        .map(|sample| i64::from(sample.duration))
        .sum();
    let duration_seconds = duration_ticks / i64::from(video.timescale);
    if duration_seconds > limits::MAX_DURATION_SECONDS {
        return Err(TranscodeError::too_large(format!(
            "the video runs {duration_seconds} seconds, over the {} second ceiling",
            limits::MAX_DURATION_SECONDS
        )));
    }
    if let Some(audio) = &media.audio {
        if audio.timescale == 0 || audio.sample_rate == 0 || audio.channels == 0 {
            return Err(TranscodeError::malformed(
                "the audio track has no rate or channels",
            ));
        }
    }
    Ok(())
}

/// Reads samples out of a track's data file.
pub struct SampleReader {
    file: File,
    length: u64,
}

impl SampleReader {
    pub fn open(path: &Path) -> Result<Self> {
        let file = File::open(path)?;
        let length = file.metadata()?.len();
        Ok(Self { file, length })
    }

    pub fn read(&mut self, sample: &Sample, buffer: &mut Vec<u8>) -> Result<()> {
        let end = sample.offset.checked_add(u64::from(sample.size));
        if end.is_none_or(|end| end > self.length) {
            return Err(TranscodeError::malformed("a sample lies outside the file"));
        }
        if sample.size > limits::MAX_SAMPLE_BYTES {
            return Err(TranscodeError::too_large(
                "a single sample is over the size ceiling",
            ));
        }
        buffer.resize(sample.size as usize, 0);
        self.file.seek(SeekFrom::Start(sample.offset))?;
        self.file.read_exact(buffer)?;
        Ok(())
    }
}
