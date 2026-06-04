# Rust conventions

**Status:** Stub — to be written when the first Rust crate lands (Tauri shell / Tantivy / shared core).

**Scope (single home for):** Rust-specific style, tooling, and idioms. Shared cross-language principles live in [`code-style.md`](code-style.md); don't repeat them here.

**Authoritative context:** the [white paper](../Magna-Carta-White-Paper.md) — _Delivery model_ (Rust scope: Tauri shell, Tantivy, the shared document/discovery core compiled to **WASM** for web + **native** for desktop, native Rust in Containers for heavy work).

**To document:**

- **rustfmt** + **clippy** settings and the lint bar; how to run; CI gate.
- Error handling: `Result` everywhere; `thiserror` for libraries, `anyhow` (or equivalent) for binaries; no `unwrap()` on fallible paths outside tests.
- **WASM vs. native** discipline: keep the shared core target-agnostic; isolate platform-specific code behind features/modules so web and desktop behave identically.
- Crate/workspace layout for the shared core, Tauri shell, and Container services.
- FFI / WASM-binding conventions (how TS calls into the WASM core).
- Tantivy and Tauri integration patterns and gotchas.
- When hot-path TS logic is promoted to Rust→WASM (only on profiling evidence — see the white paper's _Delivery model_).
