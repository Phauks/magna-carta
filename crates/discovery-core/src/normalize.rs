//! The determinism boundary. Everything derived from a document's text — the passages, the
//! fingerprint, and therefore the splits and the near-duplicate answer — is derived from the output
//! of this module and never from raw extracted text.
//!
//! Why it has to exist at all: the same document read on a firm's desktop and on the server must
//! produce the same words in the same bytes, because the two feed one index and one fingerprint. A
//! non-breaking space here and a plain space there is not a cosmetic difference — it is two
//! documents that say the same thing hashing differently and failing to deduplicate.
//!
//! The rules, applied in this order, and pinned by the tests below because their ORDER is part of
//! the contract:
//!
//! 1. Line endings collapse: CRLF, a lone CR, and the Unicode line/paragraph separators all become
//!    a single line feed, so a Windows document and a Mac-classic document of the same text agree.
//! 2. Canonical composition (NFC), so "é" written as one code point and as "e" plus a combining
//!    accent become the same characters. Done per line, after the split, so it can never introduce
//!    or remove a line break.
//! 3. Every other whitespace character — tab, non-breaking space, the typographic spaces, zero-width
//!    marks — becomes a plain space, then runs of spaces collapse to one and the line is trimmed.
//! 4. Remaining control characters are dropped. They are never content, and they are how a crafted
//!    document tries to make two different texts look identical to a reviewer.
//! 5. Leading and trailing blank lines are dropped; interior blank lines are kept, because a blank
//!    line between paragraphs is real structure a reviewer reads by.

use unicode_normalization::UnicodeNormalization;

/// Normalize a document's text into the canonical form everything derived is derived from.
pub fn normalize(input: &str) -> String {
    normalize_lines(input).join("\n")
}

/// The same normalization, kept as lines. The chunker takes lines, so this is the form that avoids
/// splitting a string the caller is about to split again.
pub fn normalize_lines(input: &str) -> Vec<String> {
    let mut lines: Vec<String> = split_lines(input)
        .iter()
        .map(|line| normalize_line(line))
        .collect();
    while lines.first().is_some_and(|line| line.is_empty()) {
        lines.remove(0);
    }
    while lines.last().is_some_and(|line| line.is_empty()) {
        lines.pop();
    }
    lines
}

/// Normalize one already-split line. Public because an extractor that already has its text in lines
/// (a PDF text layer, a spreadsheet row) normalizes line by line rather than rejoining first.
pub fn normalize_line(line: &str) -> String {
    let composed: String = line.nfc().collect();
    let mut normalized = String::with_capacity(composed.len());
    let mut pending_space = false;
    for character in composed.chars() {
        if is_line_break(character) {
            // Cannot occur after split_lines, but a caller may hand a raw line straight in.
            pending_space = true;
            continue;
        }
        // A zero-width character is DROPPED rather than turned into a space: it renders as nothing,
        // so replacing it with a space would split a word that a reader sees as whole — which is
        // exactly the evasion, in reverse.
        if is_zero_width(character) {
            continue;
        }
        if character.is_whitespace() {
            pending_space = true;
            continue;
        }
        if character.is_control() {
            continue;
        }
        if pending_space && !normalized.is_empty() {
            normalized.push(' ');
        }
        pending_space = false;
        normalized.push(character);
    }
    normalized
}

/// Split on every line terminator the formats in scope actually emit, so the caller does not have to
/// know which convention a document was written under. `str::lines` handles LF and CRLF only.
///
/// CRLF is one terminator, not two: splitting on each character in turn would make every Windows
/// document gain a blank line between every pair of real ones, which changes its passages and
/// therefore its index.
fn split_lines(input: &str) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();
    let mut characters = input.chars().peekable();
    while let Some(character) = characters.next() {
        if character == '\r' {
            if characters.peek() == Some(&'\n') {
                characters.next();
            }
            lines.push(std::mem::take(&mut current));
        } else if is_line_break(character) {
            lines.push(std::mem::take(&mut current));
        } else {
            current.push(character);
        }
    }
    lines.push(current);
    lines
}

fn is_line_break(character: char) -> bool {
    matches!(
        character,
        '\n' | '\r' | '\u{2028}' | '\u{2029}' | '\u{0085}'
    )
}

/// Zero-width characters are not whitespace by Unicode's definition but are invisible to a reader,
/// which is exactly what makes them a way to make two different texts look like one.
fn is_zero_width(character: char) -> bool {
    matches!(
        character,
        '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{2060}' | '\u{FEFF}'
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_line_ending_convention_produces_the_same_text() {
        let expected = "first line\nsecond line";
        for input in [
            "first line\nsecond line",
            "first line\r\nsecond line",
            "first line\rsecond line",
            "first line\u{2028}second line",
        ] {
            assert_eq!(normalize(input), expected, "input {input:?}");
        }
    }

    #[test]
    fn the_same_text_written_two_unicode_ways_normalizes_identically() {
        let precomposed = "Renée";
        let decomposed = "Rene\u{0301}e";
        assert_ne!(precomposed, decomposed);
        assert_eq!(normalize(precomposed), normalize(decomposed));
    }

    #[test]
    fn exotic_spacing_collapses_so_two_copies_of_a_document_agree() {
        let typographic = "the\u{00A0}seller\u{2003}shall\tindemnify";
        let plain = "the seller  shall indemnify";
        assert_eq!(normalize(typographic), "the seller shall indemnify");
        assert_eq!(normalize(plain), "the seller shall indemnify");
    }

    #[test]
    fn invisible_characters_cannot_make_two_texts_look_like_one() {
        // Zero-width joiners between every letter render identically and must not survive into the
        // fingerprint, or a document can be made to evade deduplication while looking unchanged.
        let smuggled = "in\u{200B}dem\u{200B}nify";
        assert_eq!(normalize(smuggled), "indemnify");
    }

    #[test]
    fn control_characters_are_dropped_rather_than_carried() {
        // Dropped, not spaced: a control character is not a word boundary, and inserting one would
        // split a word that a reader sees as whole.
        assert_eq!(normalize("clean\u{0000}\u{0007}text"), "cleantext");
    }

    #[test]
    fn interior_blank_lines_survive_and_surrounding_ones_do_not() {
        assert_eq!(
            normalize("\n\n  first\n\nsecond  \n\n\n"),
            "first\n\nsecond"
        );
    }

    #[test]
    fn normalization_is_idempotent() {
        // Anything derived is derived from this output, so normalizing twice must be normalizing
        // once — otherwise a re-processing produces different passages from identical bytes.
        let messy = "\u{FEFF}The\u{00A0}witness\r\nstated\u{2028}\u{200D}plainly.\r\n\r\n";
        let once = normalize(messy);
        assert_eq!(normalize(&once), once);
    }

    #[test]
    fn a_leading_byte_order_mark_character_never_reaches_the_text() {
        assert_eq!(normalize("\u{FEFF}Exhibit A"), "Exhibit A");
    }
}
