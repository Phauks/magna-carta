# noise-suppression-core (crates/noise-suppression-core) — CLAUDE.md

**Purpose.** Background noise taken out of a meeting microphone: one 10 ms frame of 48 kHz mono audio
in, the same frame with the speech kept and the steady noise taken out, plus how likely the frame was
to hold a voice. Compiles to `wasm32-unknown-unknown` (shipped, through
[`@magna-carta/noise-suppression`](../../packages/noise-suppression/CLAUDE.md), which the meeting
client runs in an AudioWorklet) and to a native `rlib` (tests).

## Pure Rust, no native build

The denoiser is `nnnoiseless` 0.5, a pure-Rust port of Xiph's RNNoise (BSD-3-Clause), with its
trained weights compiled in. Default features are off: they bring the command-line tool and its WAV
and resampling crates. `capi` stays off, because it is the C interface. `cargo tree -i cc` finds
nothing; `libc` appears only as `parking_lot`'s bindings to the platform, which compile no C. Check
`cargo tree -i cc` again before adding a dependency (golden rule 14).

## What the tests hold it to

The network keeps tonal, voiced sound and takes steady noise out. The tests prove both against fixed
synthetic signals (a smoothed noise sequence at four levels, and a harmonic tone), and that every
output sample and the voice probability stay in range whatever the input, NaN included. White noise
is deliberately not a fixture: RNNoise treats it inconsistently across levels, and no room sounds
like it.

## Speed

A frame is cleaned on the browser's audio thread inside the 10 ms it covers. SIMD128 is on for this
crate's wasm build only, through `.cargo/config.toml` in this directory, on the segmentation engine's
precedent. The module is about 200 KB gzipped and loads only when a member turns the filter on.
