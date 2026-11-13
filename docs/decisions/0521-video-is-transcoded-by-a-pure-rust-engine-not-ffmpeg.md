---
number: 521
slug: video-is-transcoded-by-a-pure-rust-engine-not-ffmpeg
status: Accepted
date: 2026-11-10
area: File preview
summary: "Video is converted by a pure-Rust engine in its own Container, not by self-hosted FFmpeg. It reads MP4, QuickTime and Matroska carrying H.264 or HEVC, with AAC, MP3, PCM or FLAC sound, and writes an MP4 with the movie header first: H.264 copied when every browser already plays it and re-encoded otherwise, AAC copied and everything else encoded to AAC-LC. A format with no proven Rust decoder stays download-only. This supersedes the self-hosted FFmpeg transcoding that the inline-preview and in-app-conversion decisions named."
---

**Video is transcoded by a pure-Rust engine, not FFmpeg.**

**Context:** the inline-preview decision (ADR-0029) deferred transcoding to self-hosted FFmpeg in a
Container, and the in-app conversion decision (ADR-0030) listed FFmpeg among the engines it would
dispatch to. Neither was built. FFmpeg is about 2.2 million lines of C, 1.2 million of them codecs,
and parsing untrusted, privileged video is exactly the memory-unsafe work golden rule 14 keeps C
away from. A spike on 2026-11-10 measured the pure-Rust decoders against FFmpeg: `rust_h264` matched
it on 132 of 137 H.264 conformance streams and `rust_h265` on 177 of 188 HEVC ones, including 10-bit
and interlaced, with no crash or hang on 600 corrupted inputs each. On the same day the owner ruled
"Rust only": no FFmpeg and no C anywhere in the media path, and set the codecs wanted as H.264, HEVC,
AAC-LC, MP3, PCM, FLAC, WMV, WMA, MPEG-4 and MPEG-2.

**Decision.**

1. **One engine, `containers/transcode`, all Rust.** An axum service on the raster engine's contract
   (`POST /convert` with `x-source-format`, `x-target-format`, `x-recipe`; `GET /ready`). Its own MP4
   and QuickTime demuxer, `matroska-demuxer` for Matroska, `rust_h264` and `rust_h265` to decode,
   `rusty_h264` to encode, Symphonia for MP3 and FLAC, `rusty_aac` to encode AAC. No `-sys` crate and
   no C compiler in the dependency graph.
2. **One recipe, `mp4-h264-aac-faststart`.** The output plays in every browser: H.264, AAC-LC, the
   movie header before the media data, the two tracks interleaved in half-second chunks, and the
   source's display rotation kept. H.264 that is already 8-bit 4:2:0 progressive at Baseline, Main or
   High is copied untouched; anything else is decoded and re-encoded at no more than 1920 by 1080.
   AAC is copied; MP3, FLAC and PCM are decoded and encoded.
3. **A new target format, `playable-mp4`.** An HEVC phone video is already an MP4, and pathfinding
   treats a self-edge as no path, so "make this play here" needs its own node, as `searchable-pdf`
   did. MP4, QuickTime and Matroska each have an edge to it; QuickTime and Matroska keep one to `mp4`.
   WebM loses its placeholder edge: its codecs have no Rust decoder here.
4. **Refuse rather than misrepresent.** A codec the engine cannot decode is a 415, never a rendition
   with the sound dropped. Every ceiling (input size, duration, picture size, samples) is a refusal.
5. **Formats with no proven Rust decoder stay download-only.** WMV and WMA have no reliable one yet
   (the 2026-11-10 spike found `wmv-decoder` wrong on a WMV9 sample). MPEG-2 and MPEG-4 Part 2 have
   promising decoders (`oxideav-mpeg12video`, `oxideav-mpeg4video`) that still need the AVI and MPEG
   stream readers and a test against real files; each joins the engine behind the same recipe when
   it is proven. An FFmpeg container is not a fallback for any of them.

**Consequences.** The engine is roughly twice as slow as FFmpeg would be (a 1080p HEVC re-encode runs
at about two-thirds of real time on the four-vCPU instance) and its AAC encoder needs 256 kbit/s for
the fidelity FFmpeg's reaches at 160, both acceptable for a viewing copy made once and kept. The
engine is deployed in the convert worker, but the buffered conversion port in the app worker does
not route to it, because a video would exhaust a Worker's memory; the playable-copy path streams to
it instead. HDR video is converted to 8-bit without tone mapping, so it looks flatter than the
original. Supersedes the FFmpeg parts of ADR-0029 and ADR-0030.
