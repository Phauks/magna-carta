//! The mbox lane. An mbox is not a message — it is a `From_`-delimited concatenation
//! of RFC 5322 messages, so this is a framing iterator over the `.eml` lane, not a parser.
//!
//! An upstream reader exists at `mail_parser::mailbox::mbox::MessageIterator`, but it
//! takes `T: std::io::BufRead`, which would drag I/O into this I/O-free crate, and it
//! also rewrites escaped `>From ` lines in place while reading, whereas this lane
//! leaves member bytes verbatim for the `.eml` lane to parse. So framing here stays a
//! byte-range scan over `&[u8]` instead.
//!
//! Framing and parsing are kept separate for a second reason: a single malformed
//! member (garbage bytes, or an empty member from two consecutive separator lines)
//! must not cost the archive every message around it. Each member is parsed
//! independently and a failure is recorded against its own index rather than
//! propagated to abort the whole mbox.

use crate::eml::parse_eml_with_source_format;
use crate::limits::Limits;
use crate::model::{ParsedMessage, PartLocator, SourceFormat};
use crate::EmailError;

const SEPARATOR: &[u8] = b"From ";

/// True when `position` begins a line that is an mbox separator. A separator is only
/// recognised at the start of a line; `>From ` in a body is an escaped literal, not a frame.
fn is_separator_at(bytes: &[u8], position: usize) -> bool {
    if !bytes[position..].starts_with(SEPARATOR) {
        return false;
    }
    position == 0 || bytes[position - 1] == b'\n'
}

/// Byte ranges of each member, delimited by `From_` separator lines. An mbox with no
/// separator at all (including an empty buffer) yields no members rather than treating
/// the whole buffer as one, since a member with no separator line is not a valid frame.
pub fn mbox_member_ranges(bytes: &[u8]) -> Vec<core::ops::Range<usize>> {
    let mut starts: Vec<usize> = Vec::new();
    for position in 0..bytes.len() {
        if is_separator_at(bytes, position) {
            starts.push(position);
        }
    }

    starts
        .iter()
        .enumerate()
        .map(|(index, &start)| {
            let end = starts.get(index + 1).copied().unwrap_or(bytes.len());
            start..end
        })
        .collect()
}

/// A member that could not be parsed. Its byte range is retained so the raw bytes
/// remain recoverable from the original buffer for inspection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberFailure {
    pub index: usize,
    pub byte_range: core::ops::Range<usize>,
    pub error: EmailError,
}

/// The outcome of framing and parsing an mbox. A malformed member never discards a
/// well-formed one, and every failure is recorded rather than silently dropped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MboxParseOutcome {
    pub messages: Vec<ParsedMessage>,
    pub failures: Vec<MemberFailure>,
}

/// Parses every member of an mbox, reusing the `.eml` lane's not-a-message guard and
/// record builder for each. A garbage or empty member is recorded as a `MemberFailure`
/// against its own index, never discarding the messages already recovered from its
/// well-formed siblings.
pub fn parse_mbox(bytes: &[u8]) -> MboxParseOutcome {
    parse_mbox_with_limits(bytes, &Limits::default())
}

/// The mbox lane with explicit caps. Two bounds guard an mbox archive: the member
/// count and each member's byte length.
///
/// An mbox legitimately runs to many gigabytes, so the single-message input cap does
/// not apply to the whole archive; the per-member byte cap bounds any one message the
/// `.eml` lane will parse, and the member-count cap bounds how many it will attempt.
///
/// A member count over the cap refuses the whole archive before parsing anything —
/// every member is recorded as a `LimitExceeded` failure and no message is returned,
/// because a mailbox that large is a denial-of-service shape, not correspondence to
/// recover piecemeal. A single over-long member, by contrast, is a local fault: it
/// alone becomes a `LimitExceeded` failure while its well-formed siblings still parse.
pub fn parse_mbox_with_limits(bytes: &[u8], limits: &Limits) -> MboxParseOutcome {
    let ranges = mbox_member_ranges(bytes);

    if ranges.len() > limits.max_mbox_member_count {
        let failures = ranges
            .into_iter()
            .enumerate()
            .map(|(index, range)| MemberFailure {
                index,
                byte_range: range,
                error: EmailError::LimitExceeded,
            })
            .collect();
        return MboxParseOutcome {
            messages: Vec::new(),
            failures,
        };
    }

    let mut messages = Vec::new();
    let mut failures = Vec::new();

    for (index, range) in ranges.into_iter().enumerate() {
        // A member longer than the per-member cap is refused without reading it into
        // the parser; it becomes a failure of its own, leaving its siblings untouched.
        if range.len() > limits.max_mbox_member_bytes {
            failures.push(MemberFailure {
                index,
                byte_range: range,
                error: EmailError::LimitExceeded,
            });
            continue;
        }

        // Skip the separator line itself; the RFC 5322 message starts after it.
        let member = &bytes[range.clone()];
        let body_start = member
            .iter()
            .position(|&byte| byte == b'\n')
            .map(|newline| newline + 1)
            .unwrap_or(member.len());

        match parse_eml_with_source_format(&member[body_start..], SourceFormat::MboxMember, limits)
        {
            // The `.eml` lane frames each part's `InputRange` relative to the slice it
            // was actually handed — `&member[body_start..]` here, not the original
            // mbox buffer — because it has no way to know it was ever handed a
            // sub-slice. `PartLocator::InputRange` is documented as a span of the
            // original input, and every other producer of one (a standalone `.eml`)
            // honors that. Rebasing here, once, at the one place that knows the
            // member's true offset, is what keeps that contract true for mbox
            // members too: any later `extract_part(original_mbox_bytes, part)` call
            // then indexes the right bytes without the caller needing to know an
            // mbox was ever involved.
            Ok(message) => messages.push(absolute_input_ranges(message, range.start + body_start)),
            Err(error) => failures.push(MemberFailure {
                index,
                byte_range: range,
                error,
            }),
        }
    }

    MboxParseOutcome { messages, failures }
}

/// Shift every part's `InputRange` forward by `member_offset`, the member body's
/// absolute position in the original mbox buffer. The `.eml` lane that produced
/// `message` only ever saw `&member[body_start..]`, so its ranges are relative to
/// that sub-slice; adding the sub-slice's own absolute start turns each one back into
/// a span of the original buffer, which is what `PartLocator::InputRange` promises
/// everywhere else it is produced. `MapiStream` locators never appear on a message
/// this lane produces, but the match leaves them untouched rather than assuming that.
///
/// `saturating_add` rather than plain `+`: this runs on attacker-controlled input in
/// an isolate that cannot unwind, so an offset that could ever approach `usize::MAX`
/// must saturate rather than overflow-panic, even though a real mbox buffer's size
/// makes that practically unreachable.
fn absolute_input_ranges(mut message: ParsedMessage, member_offset: usize) -> ParsedMessage {
    for part in &mut message.parts {
        if let PartLocator::InputRange(range) = &part.locator {
            part.locator = PartLocator::InputRange(
                range.start.saturating_add(member_offset)..range.end.saturating_add(member_offset),
            );
        }
    }
    message
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{MessageIdentifier, SourceFormat};

    const MBOX: &[u8] = include_bytes!("../tests/fixtures/two-messages.mbox");

    #[test]
    fn splits_on_the_separator_and_not_on_an_escaped_body_line() {
        let ranges = mbox_member_ranges(MBOX);
        assert_eq!(
            ranges.len(),
            2,
            "an escaped >From line must not start a new member"
        );
    }

    #[test]
    fn each_member_parses_and_is_tagged_as_an_mbox_member() {
        let outcome = parse_mbox(MBOX);
        assert!(outcome.failures.is_empty());
        assert_eq!(outcome.messages.len(), 2);
        assert_eq!(
            outcome.messages[0].message_identifier,
            MessageIdentifier::FromHeader("one@example.test".to_owned())
        );
        assert_eq!(outcome.messages[1].subject.as_deref(), Some("Second"));
        assert_eq!(outcome.messages[1].source_format, SourceFormat::MboxMember);
    }

    #[test]
    fn an_empty_buffer_yields_no_members() {
        assert!(mbox_member_ranges(b"").is_empty());
    }

    #[test]
    fn a_garbage_member_is_recorded_as_a_failure_not_a_message() {
        // The same bytes the `.eml` lane rejects standalone must be rejected here too,
        // rather than folded into a record whose only header name is raw junk bytes.
        let outcome = parse_mbox(b"From a b\n\xFF\xFE\x00");

        assert!(outcome.messages.is_empty());
        assert_eq!(outcome.failures.len(), 1);
        assert_eq!(outcome.failures[0].index, 0);
        assert_eq!(outcome.failures[0].error, EmailError::Malformed);
    }

    #[test]
    fn one_bad_member_does_not_discard_its_well_formed_siblings() {
        // A good member, then a garbage member, then another good member. Against the
        // old `collect::<Result<Vec<_>, _>>()` shape, the garbage member's `Err` would
        // short-circuit the whole collect and both good messages would be lost along
        // with it; this asserts they survive and the failure is attributed to its own
        // index instead.
        let mut bytes: Vec<u8> = Vec::new();
        bytes.extend_from_slice(b"From alice@example.test Mon Jan  1 00:00:00 2024\n");
        bytes.extend_from_slice(b"Message-ID: <one@example.test>\n");
        bytes.extend_from_slice(b"From: Alice <alice@example.test>\n");
        bytes.extend_from_slice(b"Subject: One\n");
        bytes.extend_from_slice(b"\n");
        bytes.extend_from_slice(b"Body one.\n");
        bytes.extend_from_slice(b"From b\n");
        bytes.extend_from_slice(&[0xFF, 0xFE, 0x00, b'\n']);
        bytes.extend_from_slice(b"From carol@example.test Mon Jan  1 00:00:00 2024\n");
        bytes.extend_from_slice(b"Message-ID: <two@example.test>\n");
        bytes.extend_from_slice(b"From: Carol <carol@example.test>\n");
        bytes.extend_from_slice(b"Subject: Two\n");
        bytes.extend_from_slice(b"\n");
        bytes.extend_from_slice(b"Body two.\n");

        let outcome = parse_mbox(&bytes);

        assert_eq!(outcome.messages.len(), 2);
        assert_eq!(outcome.failures.len(), 1);
        assert_eq!(outcome.failures[0].index, 1);
    }

    #[test]
    fn an_empty_member_is_recorded_as_a_failure() {
        // Two consecutive separator lines: each member is only its own separator line,
        // with no RFC 5322 content following it before the next separator.
        let outcome = parse_mbox(b"From a\nFrom b\n");

        assert!(outcome.messages.is_empty());
        assert_eq!(outcome.failures.len(), 2);
        assert_eq!(outcome.failures[0].index, 0);
        assert_eq!(outcome.failures[1].index, 1);
    }

    /// A second member's attachment `InputRange` must index the ORIGINAL mbox
    /// buffer, not the member's own sub-slice the `.eml` lane actually parsed.
    ///
    /// Before the rebasing this test exercises, `parse_mbox_with_limits` handed the
    /// member's `InputRange` straight through from the `.eml` lane unmodified: those
    /// ranges are relative to `&member[body_start..]`, which starts partway into
    /// `bytes`, so slicing the ORIGINAL buffer at the range the old code returned
    /// would land short of the real attachment bytes by exactly the first member's
    /// length plus the second member's own header block — this test would fail (a
    /// wrong slice, not a panic) against that code.
    #[test]
    fn a_member_attachment_input_range_indexes_the_original_mbox_buffer() {
        let mut bytes: Vec<u8> = Vec::new();
        // First member: plain, no attachment, to guarantee the second member's
        // absolute offset is nonzero and would expose a member-relative bug.
        bytes.extend_from_slice(b"From alice@example.test Tue Jul 07 10:00:00 2026\n");
        bytes.extend_from_slice(b"Message-ID: <one@example.test>\n");
        bytes.extend_from_slice(b"From: alice@example.test\n");
        bytes.extend_from_slice(b"Subject: First\n");
        bytes.extend_from_slice(b"\n");
        bytes.extend_from_slice(b"Body one.\n");
        bytes.extend_from_slice(b"\n");

        // Second member: a multipart message carrying one attachment, the same
        // shape as the `.eml` lane's own `with-attachment.eml` fixture.
        bytes.extend_from_slice(b"From bob@example.test Tue Jul 07 11:00:00 2026\n");
        bytes.extend_from_slice(
            concat!(
                "Message-ID: <two@example.test>\r\n",
                "From: bob@example.test\r\n",
                "Subject: Second\r\n",
                "MIME-Version: 1.0\r\n",
                "Content-Type: multipart/mixed; boundary=\"boundary42\"\r\n",
                "\r\n",
                "--boundary42\r\n",
                "Content-Type: text/plain; charset=utf-8\r\n",
                "\r\n",
                "See the attached engagement letter.\r\n",
                "\r\n",
                "--boundary42\r\n",
                "Content-Type: application/pdf; name=\"engagement-letter.pdf\"\r\n",
                "Content-Disposition: attachment; filename=\"engagement-letter.pdf\"\r\n",
                "Content-Transfer-Encoding: base64\r\n",
                "\r\n",
                "JVBERi0xLjQKJeLjz9MK\r\n",
                "\r\n",
                "--boundary42--\r\n",
            )
            .as_bytes(),
        );

        let outcome = parse_mbox(&bytes);
        assert!(outcome.failures.is_empty());
        assert_eq!(outcome.messages.len(), 2);

        let second = &outcome.messages[1];
        assert_eq!(second.parts.len(), 1);
        let PartLocator::InputRange(range) = &second.parts[0].locator else {
            panic!("an mbox member's attachment must locate its bytes as an input range");
        };

        // The proof: slicing the ORIGINAL mbox buffer (not the second member's own
        // bytes) at the returned range recovers exactly the attachment bytes.
        let attachment_slice = &bytes[range.clone()];
        assert_eq!(attachment_slice, b"JVBERi0xLjQKJeLjz9MK\r\n");
    }
}
