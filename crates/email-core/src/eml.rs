//! The RFC 5322 / MIME lane.

use crate::model::{
    Address, Disposition, IntegrityFacts, MessageIdentifier, ParsedMessage, PartDescriptor,
    SourceFormat,
};
use crate::EmailError;
use mail_parser::{MessageParser, MimeHeaders};

pub fn parse_eml(bytes: &[u8]) -> Result<ParsedMessage, EmailError> {
    let message = MessageParser::default()
        .parse(bytes)
        .ok_or(EmailError::Malformed)?;

    // `parse` is best-effort and returns `Some` for almost any input, including
    // bytes with no RFC 5322 structure at all (no header colon, no CRLF) — it folds
    // the whole input into one bogus header rather than failing. When that recovery
    // path is taken on the root part, `is_encoding_problem` is the flag mail-parser
    // itself sets to record it, so it doubles as the "this was not a message" signal
    // `Option` alone no longer carries.
    if message.root_part().is_encoding_problem {
        return Err(EmailError::Malformed);
    }

    Ok(from_mail_parser_message(&message, SourceFormat::Eml))
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
        byte_range,
        is_embedded_message: matches!(part.body, mail_parser::PartType::Message(_)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Disposition, MessageIdentifier, SourceFormat};

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
    fn describes_the_attachment_without_materializing_its_bytes() {
        let message = parse_eml(WITH_ATTACHMENT).expect("fixture parses");

        assert_eq!(message.parts.len(), 1);
        let part = &message.parts[0];
        assert_eq!(part.filename.as_deref(), Some("engagement-letter.pdf"));
        assert_eq!(part.media_type.as_deref(), Some("application/pdf"));
        assert_eq!(part.disposition, Disposition::Attachment);
        assert!(!part.is_embedded_message);
        assert!(part.byte_range.start < part.byte_range.end);
        assert_eq!(part.byte_range.end - part.byte_range.start, part.size);

        // The byte range indexes the original input directly (including the
        // trailing CRLF that precedes the next MIME boundary line).
        let attachment_slice = &WITH_ATTACHMENT[part.byte_range.clone()];
        assert_eq!(attachment_slice, b"JVBERi0xLjQKJeLjz9MK\r\n");
    }
}
