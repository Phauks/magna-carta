//! One conversion, start to finish, on files in a working directory: read the source's tracks,
//! convert the video and the sound into a payload file, and write the faststart MP4.

use std::fs::File;
use std::io::{BufWriter, Seek, Write};
use std::path::Path;

use crate::audio::{self, AudioOutput};
use crate::demux;
use crate::error::Result;
use crate::mux;
use crate::video::{self, VideoOutput};

/// What a conversion did, for the response headers and the logs. Never anything about the content.
#[derive(Debug, Clone)]
pub struct Report {
    pub video_copied: bool,
    pub audio: Option<bool>,
    pub width: u32,
    pub height: u32,
}

pub fn transcode(source: &Path, working: &Path, output: &Path) -> Result<Report> {
    let media = demux::open(source, working)?;
    let payload_path = working.join("payload");
    let mut payload = BufWriter::new(File::create(&payload_path)?);
    let video: VideoOutput = video::convert(&media.video, &mut payload, 0)?;
    payload.flush()?;
    let audio_start = payload.get_mut().stream_position()?;
    let audio: Option<AudioOutput> = match &media.audio {
        Some(track) => Some(audio::convert(track, &mut payload, audio_start)?),
        None => None,
    };
    payload.flush()?;
    drop(payload);
    mux::write(&video, audio.as_ref(), &payload_path, output)?;
    Ok(Report {
        video_copied: video.copied,
        audio: audio.as_ref().map(|audio| audio.copied),
        width: video.width,
        height: video.height,
    })
}
