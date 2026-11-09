# @magna-carta/segmentation (packages/segmentation) — CLAUDE.md

**Purpose.** The TypeScript seam over [`crates/segmentation-core`](../../crates/segmentation-core/CLAUDE.md):
loads the WebAssembly engine and answers a `PersonSegmenter` that turns a small RGB frame into a
person mask. The meeting client's background blur and image backgrounds are built on it.

- **Run it in a Web Worker.** A frame takes about 14 ms; the meeting's main thread cannot spare that
  thirty times a second.
- **The generated `src/pkg/` is git-ignored.** `pnpm exec vp run bootstrap` builds it; the Docker build
  in `crates/segmentation-core/wasm.Dockerfile` is the canonical one.
- **Errors are codes** (`SEGMENTATION_ERROR_CODES`), never frame content.
- **The test runs the real engine** on the crate's reference fixtures, so the WebAssembly edge is held to
  the same answer as the native test.
