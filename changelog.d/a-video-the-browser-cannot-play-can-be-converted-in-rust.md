---
category: Added
audience: internal
---

**A pure-Rust video transcode engine, in place of the FFmpeg that was never built.**
`containers/transcode` reads MP4, QuickTime and Matroska carrying H.264 or HEVC, with AAC, MP3, PCM
or FLAC sound, and writes an MP4 every browser plays: H.264 copied when it already plays and
re-encoded at up to 1080p otherwise, AAC copied and everything else encoded to AAC-LC, the movie
header first and the display rotation kept. It is deployed as `TranscodeEngineContainer` in the
convert worker, and the conversion registry names it `transcode` (replacing the `ffmpeg`
placeholder) with a new `playable-mp4` target and a `mkv` source. The app worker's buffered
conversion port does not route to it yet; the playable-copy path that streams to it comes next.
Checked against FFmpeg as a reference: copied streams are frame-identical, re-encoded pictures about
41 dB PSNR, sound aligned to the sample.
