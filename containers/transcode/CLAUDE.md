# magna-carta-transcode (containers/transcode) — CLAUDE.md

**Purpose.** The audio/video transcode engine for the conversion pipeline and the preview's playable
copy: a pure-Rust Cloudflare Container. An axum service (`GET /ready`, `POST /convert`) that turns an
MP4, QuickTime or Matroska file carrying H.264 or HEVC into an MP4 every browser plays. **No FFmpeg
and no C codec library**: the owner ruled "Rust only" for the media path on 2026-11-10, so untrusted
video is parsed and decoded by memory-safe Rust from the first byte.

**Decision:** `docs/decisions/pending/video-is-transcoded-by-a-pure-rust-engine-not-ffmpeg.md` (until
the register assembles it on `main`). **Worker side:** `apps/convert-worker/src/transcode-engine-container.ts`
(the `TranscodeEngineContainer` Durable Object) behind the convert worker's `/convert` proxy.
**Deploy:** [`docs/conventions/operations.md`](../../docs/conventions/operations.md).

## Key files

- `src/lib.rs` — the router. `POST /convert` checks the three headers against `SOURCE_FORMATS`,
  `TARGET_FORMATS` and `RECIPE`, spools the body to a temporary directory, runs the conversion on a
  blocking thread and streams the rendition back from disk. Status codes: 400 missing header, 415
  unsupported (including a codec with no Rust decoder), 422 malformed, 413 over a ceiling, 500 engine
  fault. `x-video` and `x-audio` say what was copied and what was encoded.
- `src/transcode.rs` — one conversion: demux, video stage, audio stage, mux.
- `src/demux/` — `isobmff.rs` (this crate's own MP4/QuickTime reader: sample tables, edit lists, the
  display matrix, QuickTime PCM), `matroska.rs` (spools the chosen tracks into a side file and indexes
  them, deriving decode times from presentation times).
- `src/video.rs` — copy or re-encode. `src/picture.rs` — any decoded picture to 8-bit 4:2:0 at the
  rendition's size. `src/h264_sps.rs` + `src/bits.rs` — the SPS fields the copy decision reads.
- `src/audio.rs` — AAC copy, or MP3/FLAC (Symphonia) and PCM (read directly) to AAC-LC.
- `src/mux.rs` — the faststart MP4 writer. `src/limits.rs` — every ceiling, in one place.
- `examples/transcode_file.rs` — run one conversion by hand on a real file.

## Local rules / invariants

- **Pure Rust: no `-sys` crate, no C.** Check `cargo tree -e normal,build` for `cc`, `cmake`,
  `bindgen` or a `-sys` crate (other than `linux-raw-sys`, which is Rust) after any dependency
  change. A codec with no Rust decoder stays download-only; it is never a reason for a C library.
- **Refuse, never misrepresent.** An audio track the engine cannot decode fails the conversion (415);
  it is never dropped to produce a silent rendition of a recording. A ceiling is a refusal, not a
  clamp.
- **Copy only what every browser plays.** H.264 is copied only when every sequence parameter set (in
  the configuration record and in-band on sync samples) is 8-bit 4:2:0 progressive at Baseline, Main
  or High. Do not widen that set without checking Safari, Chrome and Firefox.
- **Sample times start at zero in the file; the edit list carries the offset.** `mux.rs` writes the
  edit's media time relative to the first sample's decode time. A stage may keep its own clock, but
  the start offset it reports must be on that same clock.
- **The AAC encoder buffers what it is given.** `audio.rs` hands it one-minute segments that overlap
  by one hop and drops the priming and closing packets at each seam, so the joined stream is the one
  a single encoder would have written. Keep that arithmetic if the segment length changes.
- **Never log content.** Error messages name formats, codecs and limits only.
- **No runtime egress.** The Container runs with `enableInternet = false`; the image has no trust store.

## Commands

```
cargo test --release     # unit tests plus tests/transcode.rs, one fixture per codec path
cargo fmt --check && cargo clippy --all-targets -- -D warnings
cargo run --release --example transcode_file -- <source> <output.mp4>
```
