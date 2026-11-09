---
category: Changed
audience: internal
---

**Background blur's Rust path has its first number.** The owner chose to build blur memory-safely, Rust first, on 2026-11-09, and asked for image backgrounds on the same mask. The first slice-2 measurement is recorded as an amendment to `docs/research/2026-09-20-browser-media-effects.md`. `tract-tflite` cannot load MediaPipe's SelfieSegmenter as it stands, because of one custom operator, `Convolution2DTransposeBias`. With a small safe-Rust handler for that operator, the model runs in `wasm32` with SIMD at a p95 of 13.3 ms per inference and matches the reference interpreter exactly. The module is 2.17 MB gzipped, over the 1.5 MB budget. The `meetings.backgrounds-and-noise` ledger node records both rulings and drops its `awaiting-owner` question.
