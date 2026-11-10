# segmentation-core (crates/segmentation-core) — CLAUDE.md

**Purpose.** Person segmentation for a meeting's camera: a 256 × 144 RGB frame in, a mask out saying
for each pixel how likely it is to be the member rather than the room. The browser blurs or replaces
the background with it. Compiles to `wasm32-unknown-unknown` (shipped, through
[`@magna-carta/segmentation`](../../packages/segmentation/CLAUDE.md)) and to a native `rlib` (tests).

## Pure Rust, no native build

The runtime is `rten`, chosen over `tract` because tract's linear-algebra crate assembles hand-written
kernels with `cc` when built for a native target, which golden rule 14 would need the owner's consent
for. `rten` has no `cc`, no `-sys` crate and no build script that compiles anything. Keep it that way:
check `cargo tree -i cc` before adding a dependency.

## Speed is the constraint

A frame has to segment inside the meeting's frame budget (20 ms at p95 on the reference laptop), so:

- **SIMD128** is on for this crate's wasm build only, through `.cargo/config.toml` in this directory.
  Without it a frame takes about twice as long.
- **`opt-level = 3`** for this crate and the `rten` crates, in the workspace `Cargo.toml`, where every
  other crate builds for size.
- **The model is compiled in** (`include_bytes!`), so the Worker loads one file.

## The model is a build input

`model/README.md` says where it came from, why it is converted to ONNX, how, and how the conversion is
checked. `tests/reference.rs` compares the engine's mask with the reference interpreter's on a real
portrait; it is the test that fails if the model, the conversion or the runtime drifts.

## `wasm.rs` is marshalling only

Every failure crosses the edge as one of the codes on `SegmentationError::code()`. Nothing in a code
carries frame content.
