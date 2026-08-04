//! The LibreOffice conversion engine's supervisor library.
//!
//! The supervisor process owns an HTTP surface and a small pool of long-lived worker child
//! processes. Each worker initialises LibreOfficeKit exactly once and then serves conversions one
//! at a time; the supervisor holds no suite state of its own, so a wedged or segfaulting
//! conversion kills its own child and nothing else.
//!
//! Everything in this library is host-testable: no module here links, loads, or needs LibreOffice.
//! The pool is exercised against a fake worker binary that speaks the same pipe protocol, which is
//! where the risk actually lives — the suite itself is proved by the Docker acceptance suite.

pub mod dispatch;
pub mod package;
pub mod pool;
pub mod protocol;
pub mod resident;
pub mod service;

pub use service::{router, ServiceConfiguration};
