//! The RFC 5322 / MIME lane.

use crate::limits::Limits;
use crate::model::{
    Address, Disposition, IntegrityFacts, MessageIdentifier, ParsedMessage, PartDescriptor,
    PartLocator, SourceFormat,
};
use crate::EmailError;
use mail_parser::{MessageParser, MimeHeaders, PartType};

pub fn parse_eml(bytes: &[u8]) -> Result<ParsedMessage, EmailError> {
    parse_eml_with_limits(bytes, &Limits::default())
}

/// The `.eml` lane with explicit caps. The input-size cap is checked before the
/// parser runs; the structural caps are checked while walking the parsed tree.
pub fn parse_eml_with_limits(bytes: &[u8], limits: &Limits) -> Result<ParsedMessage, EmailError> {
    if bytes.len() > limits.max_input_bytes {
        return Err(EmailError::LimitExceeded);
    }
    parse_eml_with_source_format(bytes, SourceFormat::Eml, limits)
}

/// Shared by the `.eml` lane and each mbox member so both apply the same
/// not-a-message guard, structural caps, and record path: an mbox member carrying
/// junk bytes must be rejected exactly as those bytes would be rejected standalone,
/// not silently recorded because it happened to arrive framed inside a mailbox
/// rather than as its own file. The whole-input byte cap is not applied here — an
/// mbox member is bounded by the mbox lane's own per-member cap, not the
/// single-message input cap — so this operates on already-size-checked bytes.
pub(crate) fn parse_eml_with_source_format(
    bytes: &[u8],
    source_format: SourceFormat,
    limits: &Limits,
) -> Result<ParsedMessage, EmailError> {
    let message = MessageParser::default()
        .parse(bytes)
        .ok_or(EmailError::Malformed)?;

    // `parse` is lenient by design: when it cannot find any real header, it folds
    // whatever bytes it read into a single fallback header rather than failing, so
    // `Option` alone cannot separate "not a message" from "a message with an
    // imperfect body". The same leniency is exactly what we want to keep, because it
    // is also what lets the parser recover headers, addresses, and the DKIM
    // signature from a body that fails to transfer-decode cleanly (a stray byte in
    // base64, a literal `==` in quoted-printable text) — and for evidence, those
    // headers are the point, so a body-decode fault must never discard them.
    //
    // What genuinely marks "not a message" is the fallback header itself: it is
    // built from whatever raw bytes were read before the parser gave up, with no
    // regard for whether they are printable. A real RFC 5322 field name is one or
    // more printable US-ASCII characters other than colon; junk input yields a name
    // that fails that test — non-ASCII bytes, control bytes, or both. So a message
    // is only rejected here when none of its headers carry a legitimate field name.
    if !message
        .headers()
        .iter()
        .any(|header| is_legitimate_field_name(header.name()))
    {
        return Err(EmailError::Malformed);
    }

    enforce_structural_limits(&message, limits)?;

    Ok(from_mail_parser_message(&message, source_format))
}

/// Reject a message whose MIME structure exceeds the caps before any consumer walks
/// it. Three bounds are enforced together over the parsed tree: total part count,
/// multipart nesting depth, and `message/rfc822` embedding depth.
///
/// The walk is depth-first and returns the moment a depth cap is passed, so its own
/// recursion never descends deeper than the cap — a nesting bomb is refused at the
/// bound, not walked to the bottom. `mail_parser` itself parses multiparts
/// iteratively and stops descending into embedded messages after a few levels, so
/// the tree handed here is already finite; these caps make the acceptance policy
/// this engine's own rather than a byproduct of the parser's internals.
pub(crate) fn enforce_structural_limits(
    message: &mail_parser::Message<'_>,
    limits: &Limits,
) -> Result<(), EmailError> {
    let mut total_parts: usize = 0;
    enforce_message_limits(message, 0, limits, &mut total_parts)
}

/// Enforce the caps for one `Message` node (the top message or a nested
/// `message/rfc822`). `embedded_depth` counts how many message boundaries have been
/// crossed to reach this node.
fn enforce_message_limits(
    message: &mail_parser::Message<'_>,
    embedded_depth: usize,
    limits: &Limits,
    total_parts: &mut usize,
) -> Result<(), EmailError> {
    if embedded_depth > limits.max_embedded_message_depth {
        return Err(EmailError::LimitExceeded);
    }
    *total_parts = total_parts.saturating_add(message.parts.len());
    if *total_parts > limits.max_part_count {
        return Err(EmailError::LimitExceeded);
    }
    if !message.parts.is_empty() {
        enforce_part_limits(message, 0, 1, embedded_depth, limits, total_parts)?;
    }
    Ok(())
}

/// Walk one part of `message` (index `part_index`) at MIME nesting depth `mime_depth`,
/// following multipart children and descending into embedded messages. Returns
/// `LimitExceeded` before recursing past either depth cap.
fn enforce_part_limits(
    message: &mail_parser::Message<'_>,
    part_index: usize,
    mime_depth: usize,
    embedded_depth: usize,
    limits: &Limits,
    total_parts: &mut usize,
) -> Result<(), EmailError> {
    if mime_depth > limits.max_mime_depth {
        return Err(EmailError::LimitExceeded);
    }
    // A crafted index that does not resolve is treated as a leaf rather than an
    // index panic; `mail_parser` builds this tree so it always resolves, but the
    // bounds check keeps this total on any input.
    let Some(part) = message.parts.get(part_index) else {
        return Ok(());
    };
    match &part.body {
        PartType::Multipart(children) => {
            for &child in children {
                enforce_part_limits(
                    message,
                    child as usize,
                    mime_depth + 1,
                    embedded_depth,
                    limits,
                    total_parts,
                )?;
            }
        }
        // An embedded `message/rfc822` is its own message with its own part tree;
        // MIME depth restarts inside it while the embedding depth advances.
        PartType::Message(embedded) => {
            enforce_message_limits(embedded, embedded_depth + 1, limits, total_parts)?;
        }
        _ => {}
    }
    Ok(())
}

/// A field name recoverable mail actually carries: one or more printable
/// US-ASCII characters, none of them the colon that terminates the name.
fn is_legitimate_field_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|byte| byte.is_ascii_graphic() && byte != b':')
}

/// Shared by the `.eml` lane and each mbox member.
///
/// `message.raw_message` is the public field holding the entire buffer given to
/// `parse` (mail-parser's own `header_raw` indexes it the same way); every offset
/// on `Header` and `MessagePart` is absolute within that buffer, including inside
/// nested `message/rfc822` parts, so slicing it directly is safe and exact — no
/// separate byte-range bookkeeping needed for this lane.
pub(crate) fn from_mail_parser_message(
    message: &mail_parser::Message<'_>,
    source_format: SourceFormat,
) -> ParsedMessage {
    let raw_headers: Vec<(String, String)> = message
        .headers()
        .iter()
        .map(|header| {
            let start = header.offset_start() as usize;
            let end = header.offset_end() as usize;
            (
                header.name().to_owned(),
                String::from_utf8_lossy(&message.raw_message[start..end])
                    .trim()
                    .to_owned(),
            )
        })
        .collect();

    let collect = |name: &str| -> Vec<String> {
        raw_headers
            .iter()
            .filter(|(header_name, _)| header_name.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.clone())
            .collect()
    };

    let integrity = IntegrityFacts {
        dkim_signatures: collect("DKIM-Signature"),
        authentication_results: collect("Authentication-Results"),
        received_chain: collect("Received"),
    };

    let message_identifier = match message.message_id() {
        Some(value) => MessageIdentifier::FromHeader(value.to_owned()),
        None => MessageIdentifier::Absent,
    };

    let html_bodies: Vec<String> = message.html_bodies().filter_map(part_text).collect();
    let references_remote_content = html_bodies.iter().any(|body| {
        let lowered = body.to_ascii_lowercase();
        lowered.contains("src=\"http://") || lowered.contains("src=\"https://")
    });

    ParsedMessage {
        message_identifier,
        in_reply_to: message.in_reply_to().as_text().map(str::to_owned),
        references: message
            .references()
            .as_text_list()
            .unwrap_or_default()
            .iter()
            .map(|value| value.as_ref().to_owned())
            .collect(),
        subject: message.subject().map(str::to_owned),
        date_raw: collect("Date").into_iter().next(),
        from: addresses(message.from()),
        to: addresses(message.to()),
        cc: addresses(message.cc()),
        bcc: addresses(message.bcc()),
        raw_headers,
        text_bodies: message.text_bodies().filter_map(part_text).collect(),
        html_bodies,
        rtf_body: None,
        parts: message.attachments().map(descriptor).collect(),
        integrity,
        source_format,
        references_remote_content,
    }
}

fn addresses(group: Option<&mail_parser::Address<'_>>) -> Vec<Address> {
    group
        .map(|address| {
            address
                .iter()
                .map(|single| Address {
                    display_name: single.name().map(str::to_owned),
                    address: single.address().map(str::to_owned),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn part_text(part: &mail_parser::MessagePart<'_>) -> Option<String> {
    part.text_contents().map(str::to_owned)
}

fn descriptor(part: &mail_parser::MessagePart<'_>) -> PartDescriptor {
    // `MessagePart` carries no `is_inline`/`is_attachment` of its own; that lives on
    // the parsed Content-Disposition (`ContentType::is_inline`), reached through the
    // `MimeHeaders` trait. Absent a Content-Disposition header, `message.attachments()`
    // already means "not a body part", so default to `Attachment`.
    let disposition = match part.content_disposition() {
        Some(content_type) if content_type.is_inline() => Disposition::Inline,
        _ => Disposition::Attachment,
    };
    let byte_range = part.offset_body as usize..part.offset_end as usize;
    PartDescriptor {
        filename: part.attachment_name().map(str::to_owned),
        media_type: part
            .content_type()
            .map(|content_type| match content_type.subtype() {
                Some(subtype) => format!("{}/{}", content_type.ctype(), subtype),
                None => content_type.ctype().to_owned(),
            }),
        content_identifier: part.content_id().map(str::to_owned),
        disposition,
        size: byte_range.len(),
        locator: PartLocator::InputRange(byte_range),
        is_embedded_message: matches!(part.body, mail_parser::PartType::Message(_)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Disposition, MessageIdentifier, PartLocator, SourceFormat};

    const SIMPLE: &[u8] = include_bytes!("../tests/fixtures/simple.eml");
    const WITH_ATTACHMENT: &[u8] = include_bytes!("../tests/fixtures/with-attachment.eml");

    #[test]
    fn parses_envelope_and_marks_identifier_as_header_sourced() {
        let message = parse_eml(SIMPLE).expect("fixture parses");

        assert_eq!(
            message.message_identifier,
            MessageIdentifier::FromHeader("first@example.test".to_owned())
        );
        assert_eq!(message.subject.as_deref(), Some("Retainer"));
        assert_eq!(
            message.from[0].address.as_deref(),
            Some("alice@example.test")
        );
        assert_eq!(message.to[0].display_name.as_deref(), Some("Bob Client"));
        assert_eq!(message.source_format, SourceFormat::Eml);
    }

    #[test]
    fn captures_the_dkim_signature_verbatim_without_a_verdict() {
        let message = parse_eml(SIMPLE).expect("fixture parses");
        assert_eq!(message.integrity.dkim_signatures.len(), 1);
        assert!(message.integrity.dkim_signatures[0].contains("d=example.test"));
    }

    #[test]
    fn preserves_the_full_ordered_header_list() {
        let message = parse_eml(SIMPLE).expect("fixture parses");
        let names: Vec<&str> = message
            .raw_headers
            .iter()
            .map(|(name, _)| name.as_str())
            .collect();
        assert_eq!(names.first(), Some(&"Message-ID"));
        assert!(names.contains(&"DKIM-Signature"));
    }

    #[test]
    fn rejects_bytes_that_are_not_a_message() {
        assert!(parse_eml(&[0xFF, 0xFE, 0x00]).is_err());
    }

    #[test]
    fn an_encoding_fault_in_the_body_does_not_discard_the_message() {
        // A single-part message with real, well-formed headers, but a
        // quoted-printable body containing a literal "====" — not a valid escape,
        // so the transfer decoder gives up partway through the body. The headers
        // are fully parsed before the decoder ever runs, and must survive.
        let raw = concat!(
            "Message-ID: <fault@example.test>\r\n",
            "From: Alice Attorney <alice@example.test>\r\n",
            "To: Bob Client <bob@example.test>\r\n",
            "Subject: Retainer\r\n",
            "DKIM-Signature: v=1; a=rsa-sha256; d=example.test; s=sel; b=AAAA\r\n",
            "Content-Type: text/plain; charset=utf-8\r\n",
            "Content-Transfer-Encoding: quoted-printable\r\n",
            "\r\n",
            "Retainer terms follow.\r\n",
            "====\r\n",
            "The remainder of the body.\r\n",
        )
        .as_bytes();

        let message = parse_eml(raw).expect("a body encoding fault must not discard the message");

        assert_eq!(message.subject.as_deref(), Some("Retainer"));
        assert_eq!(message.integrity.dkim_signatures.len(), 1);
        assert!(message.integrity.dkim_signatures[0].contains("d=example.test"));
    }

    #[test]
    fn describes_the_attachment_without_materializing_its_bytes() {
        let message = parse_eml(WITH_ATTACHMENT).expect("fixture parses");

        assert_eq!(message.parts.len(), 1);
        let part = &message.parts[0];
        assert_eq!(part.filename.as_deref(), Some("engagement-letter.pdf"));
        assert_eq!(part.media_type.as_deref(), Some("application/pdf"));
        assert_eq!(part.disposition, Disposition::Attachment);
        assert!(!part.is_embedded_message);

        let PartLocator::InputRange(byte_range) = &part.locator else {
            panic!("an .eml attachment must locate its bytes as an input range");
        };
        assert!(byte_range.start < byte_range.end);
        assert_eq!(byte_range.end - byte_range.start, part.size);

        // The byte range indexes the original input directly (including the
        // trailing CRLF that precedes the next MIME boundary line).
        let attachment_slice = &WITH_ATTACHMENT[byte_range.clone()];
        assert_eq!(attachment_slice, b"JVBERi0xLjQKJeLjz9MK\r\n");
    }
}
