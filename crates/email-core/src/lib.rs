//! email-core: a pure, I/O-free email parse engine. Bytes in, a `ParsedMessage` out.
//!
//! Parse-only by construction. Rendering and DKIM signature verification stand on this
//! crate rather than inside it: the record carries authenticity evidence verbatim and
//! attaches no verdict to it.

pub mod eml;
pub mod error;
pub mod mbox;
pub mod model;

pub use eml::parse_eml;
pub use error::{EmailError, EMAIL_ERROR_CODES};
pub use mbox::{mbox_member_ranges, parse_mbox, MboxParseOutcome, MemberFailure};
pub use model::{
    Address, Disposition, IntegrityFacts, MessageIdentifier, ParsedMessage, PartDescriptor,
    SourceFormat,
};

// The wasm-edge module (`mod wasm`, cfg-gated to target_arch = "wasm32") is declared
// once it has bytes to marshal across the boundary, not before: `cargo fmt` resolves
// a cfg-gated `mod` file path unconditionally, so declaring it ahead of the file
// breaks the format gate on every non-wasm target.
