//! The mbox lane. An mbox is not a message — it is a `From_`-delimited concatenation
//! of RFC 5322 messages, so this is a framing iterator over the `.eml` lane, not a parser.
//!
//! `mail_parser::mailbox::mbox::MessageIterator` was checked first (golden rule: reuse
//! before building) and set aside: it takes `T: std::io::BufRead`, which would drag I/O
//! into this I/O-free crate, and it also rewrites escaped `>From ` lines in place while
//! reading, which this lane leaves verbatim in the member bytes it hands to the `.eml`
//! lane. Framing here stays a byte-range scan over `&[u8]`.

use crate::eml::from_mail_parser_message;
use crate::model::{ParsedMessage, SourceFormat};
use crate::EmailError;
use mail_parser::MessageParser;

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

/// Parses every member of an mbox, reusing the `.eml` lane's record builder for each.
pub fn parse_mbox(bytes: &[u8]) -> Result<Vec<ParsedMessage>, EmailError> {
    let parser = MessageParser::default();
    mbox_member_ranges(bytes)
        .into_iter()
        .map(|range| {
            // Skip the separator line itself; the RFC 5322 message starts after it.
            let member = &bytes[range];
            let body_start = member
                .iter()
                .position(|&byte| byte == b'\n')
                .map(|newline| newline + 1)
                .unwrap_or(member.len());
            let message = parser
                .parse(&member[body_start..])
                .ok_or(EmailError::Malformed)?;
            Ok(from_mail_parser_message(&message, SourceFormat::MboxMember))
        })
        .collect()
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
        let messages = parse_mbox(MBOX).expect("fixture parses");
        assert_eq!(messages.len(), 2);
        assert_eq!(
            messages[0].message_identifier,
            MessageIdentifier::FromHeader("one@example.test".to_owned())
        );
        assert_eq!(messages[1].subject.as_deref(), Some("Second"));
        assert_eq!(messages[1].source_format, SourceFormat::MboxMember);
    }

    #[test]
    fn an_empty_buffer_yields_no_members() {
        assert!(mbox_member_ranges(b"").is_empty());
    }
}
