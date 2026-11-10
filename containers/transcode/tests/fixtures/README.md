# Transcode engine fixtures

Small (one-second, 160x96) source files, one per path through the engine. They were generated once
with a reference encoder from synthetic test patterns and pink noise, so they carry no real content.

| File                   | Video                  | Sound           | Path it exercises                            |
| ---------------------- | ---------------------- | --------------- | -------------------------------------------- |
| `h264-aac.mp4`         | H.264 High 8-bit, B    | AAC-LC          | both tracks copied                           |
| `h264-pcm.mov`         | H.264 High 8-bit       | PCM 16-bit      | video copied, QuickTime PCM encoded to AAC   |
| `h264-high422-mp3.mp4` | H.264 High 4:2:2 10-bit| MP3             | H.264 re-encoded, MP3 encoded to AAC         |
| `hevc10-flac.mkv`      | HEVC Main 10           | FLAC            | Matroska, HEVC re-encoded, FLAC encoded      |
| `hevc-rotated.mp4`     | HEVC Main, rotated 90  | AAC-LC          | the display rotation survives                |
| `h264-ac3.mkv`         | H.264                  | AC-3            | refused: a sound codec with no Rust decoder  |
