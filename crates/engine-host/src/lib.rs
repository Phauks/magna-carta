//! magna-carta-engine-host: the shared runtime seam for the pure-Rust document
//! engines. It owns hosting only — magic-byte format detection, the wasm32 JS
//! marshalling edge, and the axum container skeleton. NO document parsing lives
//! here; engines parse, the harness hosts.

pub mod format;

pub mod wasm_edge;

#[cfg(not(target_arch = "wasm32"))]
pub mod host;
