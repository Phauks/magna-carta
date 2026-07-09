//! email-core: a pure, I/O-free email parse engine. Bytes in, a `ParsedMessage` out.
//!
//! Parse-only by construction. Rendering and DKIM signature verification stand on this
//! crate rather than inside it: the record carries authenticity evidence verbatim and
//! attaches no verdict to it.

pub mod eml;
pub mod error;
pub mod mbox;
pub mod model;
pub mod msg;

pub use eml::parse_eml;
pub use error::{EmailError, EMAIL_ERROR_CODES};
pub use mbox::{mbox_member_ranges, parse_mbox, MboxParseOutcome, MemberFailure};
pub use model::{
    Address, Disposition, IntegrityFacts, MessageIdentifier, ParsedMessage, PartDescriptor,
    PartLocator, SourceFormat,
};
pub use msg::parse_msg;

use engine_host::format::{detect, Format};

/// Parse one email of any single-message format this engine handles, dispatching on
/// the leading magic bytes. An OLE2 compound file is an Outlook `.msg`; anything that
/// is not a recognized container is treated as an RFC 5322 `.eml`. Formats this engine
/// deliberately has no lane for are reported as unsupported rather than misparsed.
///
/// An mbox is a concatenation of many messages, not one, so it keeps its own entry
/// point ([`parse_mbox`]); this function is single-message only.
pub fn parse(bytes: &[u8]) -> Result<ParsedMessage, EmailError> {
    // Empty input claims no format at all; name it malformed rather than letting it
    // fall through to the lenient `.eml` path.
    if bytes.is_empty() {
        return Err(EmailError::Malformed);
    }
    match detect(bytes) {
        Some(Format::Ole2) => parse_msg(bytes),
        // Recognized containers this engine does not read as email.
        Some(Format::Pdf) | Some(Format::Zip) => Err(EmailError::Unsupported),
        // Not a recognized container: parse as RFC 5322.
        None => parse_eml(bytes),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pdf_routes_to_unsupported() {
        assert_eq!(
            parse(b"%PDF-1.7\nnot an email"),
            Err(EmailError::Unsupported)
        );
    }

    #[test]
    fn a_zip_routes_to_unsupported() {
        assert_eq!(
            parse(b"PK\x03\x04rest of a zip"),
            Err(EmailError::Unsupported)
        );
    }

    #[test]
    fn empty_input_is_malformed() {
        assert_eq!(parse(b""), Err(EmailError::Malformed));
    }

    #[test]
    fn an_eml_fixture_routes_to_the_eml_lane() {
        let message =
            parse(include_bytes!("../tests/fixtures/simple.eml")).expect("the .eml fixture parses");
        assert_eq!(message.source_format, SourceFormat::Eml);
    }

    #[test]
    fn an_ole2_compound_file_routes_to_the_msg_lane() {
        // A minimal valid compound file with the OLE2 magic routes to the .msg lane,
        // which produces a Msg-sourced record even when the message is near-empty.
        use std::io::Cursor;
        let mut compound = cfb::CompoundFile::create(Cursor::new(Vec::new())).unwrap();
        compound.flush().unwrap();
        let bytes = compound.into_inner().into_inner();

        let message =
            parse(&bytes).expect("an OLE2 container routes to and parses in the msg lane");
        assert_eq!(message.source_format, SourceFormat::Msg);
    }
}

// The wasm-edge module (`mod wasm`, cfg-gated to target_arch = "wasm32") is declared
// once it has bytes to marshal across the boundary, not before: `cargo fmt` resolves
// a cfg-gated `mod` file path unconditionally, so declaring it ahead of the file
// breaks the format gate on every non-wasm target.
