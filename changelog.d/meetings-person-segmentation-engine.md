---
category: Added
audience: internal
---

**The person-segmentation engine for background blur and image backgrounds.** `crates/segmentation-core` runs MediaPipe's landscape selfie segmenter on the pure-Rust `rten` runtime. The model was converted once to ONNX by `model/convert-tflite-to-onnx.py`, because its custom final layer defeats off-the-shelf converters, and is compiled into the WebAssembly module. `packages/segmentation` is the TypeScript seam (`ensureReady`, `loadPersonSegmenter`). Both the native test and the WebAssembly test hold the mask to the one Google's reference interpreter produces for a real portrait, on every pixel. The crate builds with SIMD128 (crate-local `.cargo/config.toml`) and at `opt-level 3` with the `rten` crates. It measures 14 ms a frame at p50 in headless Chromium and 1.16 MB gzipped. `rten` was chosen over `tract` because `tract` assembles native kernels with `cc`, which golden rule 14 would need consent for. Wired into bootstrap, the dev build and its own Docker task. It is not yet in the deploy composite, because nothing deployed imports it until the meeting client's effects Worker does.
