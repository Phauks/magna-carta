# @magna-carta/noise-suppression (packages/noise-suppression) — CLAUDE.md

**Purpose.** The TypeScript seam over [`crates/noise-suppression-core`](../../crates/noise-suppression-core/CLAUDE.md):
loads the WebAssembly denoiser and answers a `NoiseSuppressor` that cleans 10 ms frames of 48 kHz mono
audio. The meeting client's stronger noise removal is built on it.

- **Run it in an AudioWorklet.** A frame has to be cleaned inside the 10 ms it covers, on the audio
  thread, or the member's voice stutters.
- **A worklet cannot fetch.** Compile the module on the main thread and hand the `WebAssembly.Module`
  over; `ensureReadySync` instantiates it where it lands.
- **Import `./text-decoder.ts` first in a worklet.** The generated bindings build a `TextDecoder` as
  they load, and a worklet's scope does not have one in every browser.
- **The generated `src/pkg/` is git-ignored.** `pnpm exec vp run bootstrap` builds it; the Docker build
  in `crates/noise-suppression-core/wasm.Dockerfile` is the canonical one.
- **Errors are codes** (`NOISE_SUPPRESSION_ERROR_CODES`), never audio.
- **The test runs the real engine**, so the WebAssembly edge is held to what the crate's native tests
  hold it to.
