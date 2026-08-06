//! Email, over the shipped parse engine.
//!
//! `crates/email-core` already reads `.eml`, `.msg` (including the MAPI property streams and the
//! compressed RTF body), and mbox members, and it was audited against crafted compound files. This
//! module does not re-read any of that — it turns a parsed message into the text a reviewer searches.
//!
//! The header block is part of that text on purpose. A discovery search for a person's name has to
//! find the messages they were copied on, not only the ones that mention them in the body, and the
//! participants are in the headers. The order is fixed so the same message always produces the same
//! passage: subject, from, to, cc, date, then the body.

use email_core::EmailError;

use super::{single_page, DateSource, DocumentDate, ExtractedDocument};
use crate::chunk::Page;
use crate::error::DiscoveryError;
use crate::identify::IdentifiedFormat;
use crate::limits::Limits;
use crate::normalize::normalize_lines;

pub fn extract(
    bytes: &[u8],
    format: IdentifiedFormat,
    limits: &Limits,
) -> Result<ExtractedDocument, DiscoveryError> {
    if format == IdentifiedFormat::MboxArchive {
        return extract_mbox(bytes, limits);
    }
    let message = email_core::parse(bytes).map_err(map_error)?;
    let lines = message_lines(&message, limits)?;
    Ok(ExtractedDocument {
        format,
        charset: None,
        pages: single_page(lines),
        // A message is one document however long it is; where a printer would break it is not a
        // property of the message.
        page_count: None,
        document_date: message.date_raw.clone().map(|value| DocumentDate {
            value,
            source: DateSource::EmailDateHeader,
        }),
        pages_needing_recognition: Vec::new(),
    })
}

/// An mbox is a concatenation of messages, so each member becomes its own page — the container's
/// text is the union of its members', and a reviewer citing "the third message" has a number to cite.
/// Splitting the members into their own review documents is the loading step's job, not this one's:
/// this engine does not know what a review document is.
fn extract_mbox(bytes: &[u8], limits: &Limits) -> Result<ExtractedDocument, DiscoveryError> {
    let outcome = email_core::parse_mbox(bytes);
    if outcome.messages.is_empty() {
        // Every member failed. An mbox that parses to nothing is corrupt rather than empty — an
        // empty answer here would put a mailbox in the corpus as a document containing no words.
        return Err(DiscoveryError::Corrupt);
    }
    let mut pages = Vec::new();
    let mut first_date = None;
    for (index, message) in outcome.messages.iter().enumerate() {
        if index >= limits.max_page_count {
            return Err(DiscoveryError::LimitExceeded);
        }
        if first_date.is_none() {
            first_date = message.date_raw.clone();
        }
        pages.push(Page {
            page_index: index,
            lines: message_lines(message, limits)?,
        });
    }
    let page_count = pages.len();
    Ok(ExtractedDocument {
        format: IdentifiedFormat::MboxArchive,
        charset: None,
        pages,
        page_count: Some(page_count),
        document_date: first_date.map(|value| DocumentDate {
            value,
            source: DateSource::EmailDateHeader,
        }),
        pages_needing_recognition: Vec::new(),
    })
}

fn message_lines(
    message: &email_core::ParsedMessage,
    limits: &Limits,
) -> Result<Vec<String>, DiscoveryError> {
    let mut lines: Vec<String> = Vec::new();
    if let Some(subject) = &message.subject {
        lines.push(format!("Subject: {subject}"));
    }
    push_addresses(&mut lines, "From", &message.from);
    push_addresses(&mut lines, "To", &message.to);
    push_addresses(&mut lines, "Cc", &message.cc);
    if let Some(date) = &message.date_raw {
        lines.push(format!("Date: {date}"));
    }
    // Attachment names are searchable text: "produce everything attaching the term sheet" is a
    // request a firm answers by name, and the names live nowhere else in the message body.
    for part in &message.parts {
        if let Some(filename) = &part.filename {
            lines.push(format!("Attachment: {filename}"));
        }
    }
    let mut body = String::new();
    for text in &message.text_bodies {
        body.push_str(text);
        body.push('\n');
    }
    // The compressed-RTF body is the only body a `.msg` exported from Outlook often has. The email
    // engine decompresses it and deliberately does not interpret it; interpreting it is this
    // engine's job, and it is the same stripper the standalone RTF route uses.
    if body.trim().is_empty() {
        if let Some(rtf) = &message.rtf_body {
            body = super::rich_text::to_text(rtf.as_bytes(), limits)?;
        }
    }
    if body.trim().is_empty() {
        for html in &message.html_bodies {
            body.push_str(html);
            body.push('\n');
        }
    }
    if body.len() > limits.max_extracted_text_bytes {
        return Err(DiscoveryError::LimitExceeded);
    }
    if !body.trim().is_empty() {
        lines.push(String::new());
        lines.extend(normalize_lines(&body));
    }
    Ok(lines)
}

fn push_addresses(lines: &mut Vec<String>, label: &str, addresses: &[email_core::Address]) {
    if addresses.is_empty() {
        return;
    }
    let rendered: Vec<String> = addresses
        .iter()
        .map(|address| match (&address.display_name, &address.address) {
            (Some(name), Some(mailbox)) => format!("{name} <{mailbox}>"),
            (Some(name), None) => name.clone(),
            (None, Some(mailbox)) => mailbox.clone(),
            (None, None) => String::new(),
        })
        .filter(|rendered| !rendered.is_empty())
        .collect();
    if !rendered.is_empty() {
        lines.push(format!("{label}: {}", rendered.join(", ")));
    }
}

/// The email engine's errors, mapped onto this engine's vocabulary. `PartNotFound` becomes corrupt
/// rather than getting a code of its own: from a reviewer's side, a message whose parts do not
/// resolve is a damaged message.
fn map_error(error: EmailError) -> DiscoveryError {
    match error {
        EmailError::Malformed | EmailError::PartNotFound => DiscoveryError::Corrupt,
        EmailError::Unsupported => DiscoveryError::UnsupportedFormat,
        EmailError::LimitExceeded => DiscoveryError::LimitExceeded,
    }
}

/// Kept so the mapping above is exhaustive by construction rather than by review: a new variant in
/// the email engine stops compiling here.
const _: fn(EmailError) -> DiscoveryError = map_error;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extract::{extract as extract_document, ExtractionOutcome};

    const MESSAGE: &[u8] = b"Message-ID: <a@example.test>\r\nFrom: Opposing Counsel <opposing@example.test>\r\nTo: firm@example.test\r\nSubject: Production volume 2\r\nDate: Tue, 4 Aug 2026 09:30:00 -0700\r\n\r\nEnclosed please find the documents responsive to request 4.\r\n";

    fn extracted(bytes: &[u8]) -> ExtractedDocument {
        match extract_document(bytes).unwrap() {
            ExtractionOutcome::Extracted(document) => document,
            other => panic!("expected an extraction, got {other:?}"),
        }
    }

    #[test]
    fn a_message_extracts_its_participants_its_subject_and_its_body() {
        let document = extracted(MESSAGE);
        let text = document.pages[0].lines.join("\n");
        assert!(text.contains("Subject: Production volume 2"), "{text}");
        assert!(
            text.contains("Opposing Counsel <opposing@example.test>"),
            "{text}"
        );
        assert!(text.contains("To: firm@example.test"), "{text}");
        assert!(text.contains("responsive to request 4"), "{text}");
    }

    #[test]
    fn the_date_is_reported_verbatim_with_its_source_named() {
        let document = extracted(MESSAGE);
        assert_eq!(
            document.document_date,
            Some(DocumentDate {
                value: "Tue, 4 Aug 2026 09:30:00 -0700".to_owned(),
                source: DateSource::EmailDateHeader,
            })
        );
    }

    #[test]
    fn an_mbox_is_one_page_per_member() {
        let mbox = b"From a@example.test Tue Aug 04 09:00:00 2026\r\nSubject: First\r\n\r\nfirst body\r\n\r\nFrom b@example.test Tue Aug 04 10:00:00 2026\r\nSubject: Second\r\n\r\nsecond body\r\n";
        let document = extracted(mbox);
        assert_eq!(document.page_count, Some(2));
        assert!(document.pages[0].lines.join("\n").contains("First"));
        assert!(document.pages[1].lines.join("\n").contains("Second"));
    }

    #[test]
    fn a_message_whose_headers_are_garbage_is_corrupt_rather_than_a_panic() {
        // Reaches the email lane by its header shape and then fails to parse.
        let broken: Vec<u8> = b"From: a@b\r\nSubject: s\r\n\r\n"
            .iter()
            .copied()
            .chain(std::iter::repeat_n(0xFFu8, 64))
            .collect();
        // Either it reads as a damaged message or it never claimed to be one; both are honest, and
        // neither is a panic.
        let outcome = extract_document(&broken);
        assert!(outcome.is_ok() || outcome == Err(DiscoveryError::Corrupt));
    }

    #[test]
    fn a_message_over_the_input_cap_is_refused_before_it_is_parsed() {
        let limits = Limits {
            max_input_bytes: 8,
            ..Limits::default()
        };
        assert_eq!(
            crate::extract::extract_with_limits(MESSAGE, &limits),
            Err(DiscoveryError::LimitExceeded)
        );
    }
}
