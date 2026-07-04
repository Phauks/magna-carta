//! recovery-core: the file-corruption recovery engine. Pure compute on the
//! magna-carta-engine-host harness — bytes in, a diagnosis or a salvaged result
//! out. NO I/O lives here; the worker/container host it. Diagnose broadly,
//! repair narrowly: per-format diagnosers and repairers register in later plans.

pub mod carve;
pub mod cfb_repair;
pub mod diagnose;
pub mod error;
pub mod limits;
pub mod model;
pub mod ooxml;
pub mod pdf_repair;
pub mod repair;
pub mod salvage;
pub mod zip_repair;

pub use carve::carve;
pub use diagnose::diagnose;
pub use repair::repair;
