---
category: Changed
audience: public
---

**HEVC and MKV recordings play where the browser can decode them.** The server no longer refuses
HEVC video, or Matroska files whose tracks carry browser codecs (H.264, HEVC, VP8, VP9 or AV1 with
AAC, Opus, Vorbis or FLAC sound); the player offers the download when the reader's own browser
reports a media error or shows no picture. ProRes, MPEG-2 and Dolby Digital sound stay download-only.
A per-firm data migration clears every stored `download-only` verdict once, so videos refused under
the old rule are judged again the next time they are opened.

## Public

**More videos play without downloading.** Videos recorded on phones in HEVC, and MKV files, now play
in the browser wherever your browser can decode them, which includes Safari, Edge and Chrome on most
newer computers. If yours cannot, the player says so and offers the download.
