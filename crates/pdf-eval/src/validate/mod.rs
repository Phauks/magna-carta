//! Reusable document-engine validation harness: run engine operations over a
//! corpus, classifying robustness (no panic/hang), safety (invariants hold), and
//! coverage (good path vs. fallback), and diff the summary against a baseline.

pub mod operation;
