//! email-core: a pure, I/O-free email parse engine. Bytes in, a `ParsedMessage` out.
//!
//! Parse-only by construction. Rendering and DKIM signature verification stand on this
//! crate rather than inside it: the record carries authenticity evidence verbatim and
//! attaches no verdict to it.

pub mod eml;
pub mod error;
pub mod limits;
mod lzfu;
pub mod mbox;
pub mod model;
pub mod msg;

pub use eml::{parse_eml, parse_eml_with_limits};
pub use error::{EmailError, EMAIL_ERROR_CODES};
pub use limits::Limits;
pub use mbox::{
    mbox_member_ranges, parse_mbox, parse_mbox_with_limits, MboxParseOutcome, MemberFailure,
};
pub use model::{
    Address, Disposition, IntegrityFacts, MessageIdentifier, ParsedMessage, PartDescriptor,
    PartLocator, SourceFormat,
};
pub use msg::{parse_msg, parse_msg_with_limits};

use engine_host::format::{detect, Format};
use std::path::Path;

/// Parse one email of any single-message format this engine handles, dispatching on
/// the leading magic bytes. An OLE2 compound file is an Outlook `.msg`; anything that
/// is not a recognized container is treated as an RFC 5322 `.eml`. Formats this engine
/// deliberately has no lane for are reported as unsupported rather than misparsed.
///
/// An mbox is a concatenation of many messages, not one, so it keeps its own entry
/// point ([`parse_mbox`]); this function is single-message only.
pub fn parse(bytes: &[u8]) -> Result<ParsedMessage, EmailError> {
    parse_with_limits(bytes, &Limits::default())
}

/// [`parse`] with explicit caps for attacker-controlled input. The input-size cap is
/// enforced before the format is even detected — an oversized buffer is refused
/// before any parser touches it — and the per-lane structural caps are enforced as
/// each lane walks the message.
pub fn parse_with_limits(bytes: &[u8], limits: &Limits) -> Result<ParsedMessage, EmailError> {
    if bytes.len() > limits.max_input_bytes {
        return Err(EmailError::LimitExceeded);
    }
    // Empty input claims no format at all; name it malformed rather than letting it
    // fall through to the lenient `.eml` path.
    if bytes.is_empty() {
        return Err(EmailError::Malformed);
    }
    match detect(bytes) {
        Some(Format::Ole2) => parse_msg_with_limits(bytes, limits),
        // Recognized containers this engine does not read as email.
        Some(Format::Pdf) | Some(Format::Zip) => Err(EmailError::Unsupported),
        // Not a recognized container: parse as RFC 5322.
        None => parse_eml_with_limits(bytes, limits),
    }
}

/// [`extract_part`] with [`Limits::default`], whose `max_decoded_part_bytes` is the
/// same 64 MiB the `.msg` decode paths already clamp to — so this is not a looser
/// cap, just the default one.
pub fn extract_part(bytes: &[u8], descriptor: &PartDescriptor) -> Result<Vec<u8>, EmailError> {
    extract_part_with_limits(bytes, descriptor, &Limits::default())
}

/// Materialize one part's bytes on demand. [`parse`] returns descriptors that locate
/// their bytes rather than carry them, so a caller that wants only headers and text —
/// bulk indexing, a listing view — never pays for attachment bytes it discards. The
/// bytes handed back come from the same original input the descriptor was parsed from.
///
/// A part locates its bytes one of two ways, and this handles both from that same
/// input, each honoring `limits.max_decoded_part_bytes`:
///
/// - [`PartLocator::InputRange`] — an `.eml`/mbox part is literally a span of the
///   input. The range is bounds-checked against the input and returned as a copy; a
///   range that runs past the end, or is inverted, is a [`EmailError::PartNotFound`]
///   rather than an index panic. A range that is in-bounds but longer than the cap is
///   [`EmailError::LimitExceeded`] — checked before the copy, so an oversized range
///   never sizes an allocation.
/// - [`PartLocator::MapiStream`] — a `.msg` part's bytes are scattered across
///   compound-file sectors, denoted by no span of the input. The container is
///   re-opened and the named stream is read back through a reader bounded by
///   whichever is tighter, the caller's cap or the decoder's own fixed clamp, so a
///   caller-supplied cap can only shrink the read, never grow it past what the
///   decoder itself allows. A stream longer than that bound is
///   [`EmailError::LimitExceeded`], not a truncated success. A stream that is now
///   absent, or any other container fault, is [`EmailError::PartNotFound`] — the
///   container already parsed once, so a missing named part is not-found, and no
///   underlying container-error text is allowed to surface.
pub fn extract_part_with_limits(
    bytes: &[u8],
    descriptor: &PartDescriptor,
    limits: &Limits,
) -> Result<Vec<u8>, EmailError> {
    match &descriptor.locator {
        PartLocator::InputRange(range) => {
            if range.start > range.end || range.end > bytes.len() {
                return Err(EmailError::PartNotFound);
            }
            if range.len() > limits.max_decoded_part_bytes {
                return Err(EmailError::LimitExceeded);
            }
            Ok(bytes[range.clone()].to_vec())
        }
        PartLocator::MapiStream { name } => {
            // A container-open fault here is a not-found, not a malformed: the
            // container parsed successfully once already, and its error text must
            // not leak.
            let mut compound =
                msg::open_compound_file(bytes).map_err(|_| EmailError::PartNotFound)?;
            match msg::read_stream_bounded_with_cap(
                &mut compound,
                Path::new(name),
                limits.max_decoded_part_bytes,
            ) {
                Ok(part_bytes) => Ok(part_bytes),
                Err(EmailError::LimitExceeded) => Err(EmailError::LimitExceeded),
                // Every other fault (stream absent, read error) collapses to
                // not-found for the same reason the open fault above does.
                Err(_) => Err(EmailError::PartNotFound),
            }
        }
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
    fn extract_part_returns_input_range_bytes_and_rejects_a_foreign_range() {
        const WITH_ATTACHMENT: &[u8] = include_bytes!("../tests/fixtures/with-attachment.eml");
        let message = parse(WITH_ATTACHMENT).expect("fixture parses");
        let descriptor = &message.parts[0];

        // The `.eml` attachment is a span of the input: extraction returns exactly
        // those bytes, and their length is the descriptor's declared size.
        let bytes = extract_part(WITH_ATTACHMENT, descriptor).expect("part extracts");
        assert_eq!(bytes.len(), descriptor.size);
        assert_eq!(bytes, b"JVBERi0xLjQKJeLjz9MK\r\n");

        // A range reaching past the input is not-found, never an index panic.
        let mut foreign = descriptor.clone();
        foreign.locator = PartLocator::InputRange(0..(WITH_ATTACHMENT.len() + 1));
        assert_eq!(
            extract_part(WITH_ATTACHMENT, &foreign),
            Err(EmailError::PartNotFound)
        );

        // An inverted range (start past end) is refused the same way. Built from
        // values so it is an inverted range at runtime, not a compile-time literal.
        let (start, end) = (10usize, 1usize);
        let mut inverted = descriptor.clone();
        inverted.locator = PartLocator::InputRange(start..end);
        assert_eq!(
            extract_part(WITH_ATTACHMENT, &inverted),
            Err(EmailError::PartNotFound)
        );
    }

    #[test]
    fn an_input_range_over_a_tightened_cap_is_refused_not_copied() {
        const WITH_ATTACHMENT: &[u8] = include_bytes!("../tests/fixtures/with-attachment.eml");
        let message = parse(WITH_ATTACHMENT).expect("fixture parses");
        let descriptor = &message.parts[0];

        // The range is in-bounds — well under `WITH_ATTACHMENT.len()` — so only the
        // tightened cap, not the bounds check, can be what rejects it.
        let tight_limits = Limits {
            max_decoded_part_bytes: descriptor.size - 1,
            ..Limits::default()
        };
        assert_eq!(
            extract_part_with_limits(WITH_ATTACHMENT, descriptor, &tight_limits),
            Err(EmailError::LimitExceeded)
        );

        // The default cap (64 MiB) is nowhere near this fixture's size, so the
        // untightened path still extracts the same bytes as before.
        let bytes = extract_part(WITH_ATTACHMENT, descriptor).expect("part extracts");
        assert_eq!(bytes, b"JVBERi0xLjQKJeLjz9MK\r\n");
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

// The wasm-edge module carries the `#[wasm_bindgen]` exports. Gated to
// target_arch = "wasm32" so it never compiles into the native build or its tests.
// Declaring it turns its exports into real cdylib codegen roots, which is what
// finally roots the container-open path (and the rest of the engine) through the
// export graph rather than only through the rlib half of the crate.
#[cfg(target_arch = "wasm32")]
mod wasm;
