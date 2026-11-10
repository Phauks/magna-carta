---
category: Added
audience: public
---

**Stronger noise removal in meetings, in Rust.** `crates/noise-suppression-core` wraps nnnoiseless
(the pure-Rust port of RNNoise, BSD-3, built with no default features so no C reaches the tree) and
compiles to WebAssembly for `packages/noise-suppression`. The web client runs it in an
`AudioWorklet` (`effects/noise-removal.worklet.ts`) on 480-sample frames, with the engine module
compiled on the main thread and passed in `processorOptions`, and swaps the filtered track into the
microphone's sender with `replaceTrack`. It is a second, opt-in switch beside the browser's own noise
reduction, which it asks off while it runs; a failure turns it off and hands the sound back. The web
worker's build gains the `rust-wasm-build-noise-suppression` task. Measured in Chromium against a
fake microphone: a low rumble at 0.10 RMS came out at about 0.001, and a voiced sound was kept.

## Public

**Stronger noise removal in meetings.** Under **Effects**, a new **Stronger noise removal** switch
runs a noise filter on your own computer that takes out fans, typing and street noise more thoroughly
than your browser does. It is off until you turn it on, uses a little more of your computer's power,
and if it ever stops working your browser's own noise reduction takes over again.
