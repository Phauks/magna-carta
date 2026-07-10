//! Caps for attacker-controlled input. A declared length never sizes an allocation;
//! every violation is a typed error, never a panic and never a truncated success.
//!
//! These bounds exist because the bytes handed to this engine are hostile and
//! legally privileged, and the engine runs where the stack cannot unwind: an
//! unbounded recursion or allocation is not a slow parse but an aborted isolate.
//! The walk that enforces the structural caps returns as soon as a cap is passed,
//! so the walk's own recursion depth is itself bounded by the cap it checks.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub max_input_bytes: usize,
    pub max_mime_depth: usize,
    pub max_part_count: usize,
    /// Base64 expands roughly 1.37x, so a part's decoded size is bounded independently
    /// of whatever length the message claims. Enforced by
    /// [`crate::extract_part_with_limits`] on every locator kind: an `InputRange`
    /// longer than this is refused before it is copied, and a `MapiStream` read is
    /// capped at whichever is tighter, this value or the `.msg` decoder's own fixed
    /// clamp.
    pub max_decoded_part_bytes: usize,
    pub max_embedded_message_depth: usize,
    pub max_mbox_member_count: usize,
    pub max_mbox_member_bytes: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_input_bytes: 128 * 1024 * 1024,
            max_mime_depth: 32,
            max_part_count: 512,
            max_decoded_part_bytes: 64 * 1024 * 1024,
            max_embedded_message_depth: 8,
            max_mbox_member_count: 100_000,
            max_mbox_member_bytes: 128 * 1024 * 1024,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{parse_mbox_with_limits, parse_with_limits, EmailError};

    #[test]
    fn default_limits_are_conservative() {
        let limits = Limits::default();
        assert_eq!(limits.max_mime_depth, 32);
        assert_eq!(limits.max_part_count, 512);
        assert_eq!(limits.max_embedded_message_depth, 8);
        assert_eq!(limits.max_mbox_member_count, 100_000);
    }

    #[test]
    fn a_message_exceeding_the_input_cap_is_rejected_before_parsing() {
        let limits = Limits {
            max_input_bytes: 16,
            ..Limits::default()
        };
        let oversized = vec![b'A'; 64];
        assert_eq!(
            parse_with_limits(&oversized, &limits),
            Err(EmailError::LimitExceeded)
        );
    }

    #[test]
    fn an_mbox_exceeding_the_member_cap_is_refused_whole() {
        // `parse_mbox` is total: it returns an outcome, never a `Result`, so its
        // limited twin does too. A member count over the cap refuses the whole
        // archive before parsing any member, recording each member as a
        // `LimitExceeded` failure rather than pretending some parsed.
        let limits = Limits {
            max_mbox_member_count: 1,
            ..Limits::default()
        };
        let two_members = b"From a@b Tue Jul 07 10:00:00 2026\nSubject: One\n\nx\n\nFrom c@d Tue Jul 07 11:00:00 2026\nSubject: Two\n\ny\n";
        let outcome = parse_mbox_with_limits(two_members, &limits);
        assert!(outcome.messages.is_empty());
        assert!(!outcome.failures.is_empty());
        assert!(outcome
            .failures
            .iter()
            .all(|failure| failure.error == EmailError::LimitExceeded));
    }

    #[test]
    fn an_oversized_mbox_member_becomes_a_failure_while_its_sibling_parses() {
        // The member-bytes cap is enforced per member: an over-cap member is
        // recorded as a `LimitExceeded` failure without discarding a well-formed
        // sibling on the other side of it.
        let mut oversized_member = Vec::new();
        oversized_member.extend_from_slice(b"From big@example.test Tue Jul 07 10:00:00 2026\n");
        oversized_member.extend_from_slice(b"Subject: Oversized\n\n");
        oversized_member.extend(std::iter::repeat_n(b'x', 4096));
        oversized_member.push(b'\n');

        let mut bytes = oversized_member;
        bytes.extend_from_slice(b"From small@example.test Tue Jul 07 11:00:00 2026\n");
        bytes.extend_from_slice(b"Message-ID: <small@example.test>\n");
        bytes.extend_from_slice(b"Subject: Small\n\nbody\n");

        let limits = Limits {
            max_mbox_member_bytes: 256,
            ..Limits::default()
        };
        let outcome = parse_mbox_with_limits(&bytes, &limits);

        assert_eq!(outcome.messages.len(), 1);
        assert_eq!(outcome.messages[0].subject.as_deref(), Some("Small"));
        assert_eq!(outcome.failures.len(), 1);
        assert_eq!(outcome.failures[0].index, 0);
        assert_eq!(outcome.failures[0].error, EmailError::LimitExceeded);
    }

    #[test]
    fn a_deeply_nested_multipart_is_rejected_rather_than_recursed() {
        // A genuinely nested multipart: each level opens its own boundary and is a
        // child part of its parent's, so the MIME tree is `max_levels` deep rather
        // than a single multipart with `max_levels` flat siblings. A flat fixture
        // (every part delimited by the same top boundary) could never exercise a
        // depth cap at all.
        let limits = Limits {
            max_mime_depth: 3,
            ..Limits::default()
        };
        let max_levels = 10;
        let mut nested = String::from("Content-Type: multipart/mixed; boundary=L0\r\n\r\n");
        for level in 0..max_levels {
            nested.push_str(&format!("--L{level}\r\n"));
            if level + 1 < max_levels {
                nested.push_str(&format!(
                    "Content-Type: multipart/mixed; boundary=L{}\r\n\r\n",
                    level + 1
                ));
            } else {
                nested.push_str("Content-Type: text/plain\r\n\r\ndeepest\r\n");
            }
        }
        for level in (0..max_levels).rev() {
            nested.push_str(&format!("--L{level}--\r\n"));
        }

        // The failure is the depth cap, not some other bound: the tree has only
        // eleven parts (ten multiparts and one leaf), far under `max_part_count`,
        // and the input is far under `max_input_bytes`. Raising only `max_mime_depth`
        // past the nesting makes the very same bytes parse, which pins the rejection
        // to depth and nothing else.
        assert_eq!(
            parse_with_limits(nested.as_bytes(), &limits),
            Err(EmailError::LimitExceeded)
        );
        let relaxed = Limits {
            max_mime_depth: max_levels + 2,
            ..Limits::default()
        };
        assert!(parse_with_limits(nested.as_bytes(), &relaxed).is_ok());
    }
}
