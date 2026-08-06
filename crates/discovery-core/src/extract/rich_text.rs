//! Rich Text Format: control words out, words in.
//!
//! RTF is a stream of groups and backslash control words with the text interleaved, and the whole
//! job is telling the two apart. Three rules carry it:
//!
//! - A control word runs from the backslash to the first character that cannot be part of it, with
//!   an optional numeric parameter and one optional trailing space that belongs to the control word
//!   rather than the text.
//! - A group opened by `{\*` is IGNORABLE by the format's own definition — the producer is saying
//!   "skip this if you do not understand it" — and so are the tables that describe fonts, colours,
//!   styles, and embedded pictures. Those groups are skipped whole, which is what keeps a font
//!   table's names and a picture's hex bytes out of a search index.
//! - `\'hh` is a raw byte in the document's code page and `\uN` is a Unicode code point with a
//!   replacement character following it for readers that predate Unicode; the replacement is
//!   consumed so a word does not come out doubled.
//!
//! Bounded by construction: group depth is a counter and every branch consumes at least one
//! character, so no input produces a loop that does not advance.

use super::{single_page, ExtractedDocument};
use crate::error::DiscoveryError;
use crate::identify::IdentifiedFormat;
use crate::limits::Limits;
use crate::normalize::normalize_lines;

/// Groups whose content is machinery rather than words.
const SKIPPED_DESTINATIONS: &[&str] = &[
    "fonttbl",
    "colortbl",
    "stylesheet",
    "listtable",
    "listoverridetable",
    "revtbl",
    "rsidtbl",
    "generator",
    "info",
    "pict",
    "object",
    "themedata",
    "datastore",
    "latentstyles",
    "xmlnstbl",
];

/// The deepest RTF group nesting this engine will follow. Real documents sit in the low tens; a file
/// nested thousands deep is a document built to be a bomb.
const MAX_GROUP_DEPTH: usize = 512;

pub fn extract(bytes: &[u8], limits: &Limits) -> Result<ExtractedDocument, DiscoveryError> {
    let text = to_text(bytes, limits)?;
    Ok(ExtractedDocument {
        format: IdentifiedFormat::RichTextFormat,
        charset: None,
        pages: single_page(normalize_lines(&text)),
        // RTF describes a flow, not pages: where the pages fall is the renderer's answer.
        page_count: None,
        // The optional `\info` group carries `\creatim`; reading it belongs with the metadata
        // sidecar that 5·1·3 writes, which reads every format's properties in one place.
        document_date: None,
        pages_needing_recognition: Vec::new(),
    })
}

/// Strip an RTF stream down to its text. Public within the crate because a `.msg`'s compressed-RTF
/// body arrives already decompressed from the email engine and needs exactly this treatment.
pub(crate) fn to_text(bytes: &[u8], limits: &Limits) -> Result<String, DiscoveryError> {
    // RTF is defined over 7-bit ASCII with everything else escaped, so the stream is read as bytes
    // and only the escapes produce non-ASCII characters.
    let mut out = String::new();
    let mut depth = 0usize;
    // The depth of the outermost skipped group, if inside one.
    let mut skipping_from: Option<usize> = None;
    let mut index = 0usize;
    let mut skip_unicode_replacements = 0usize;
    while index < bytes.len() {
        if out.len() > limits.max_extracted_text_bytes {
            return Err(DiscoveryError::LimitExceeded);
        }
        let byte = bytes[index];
        match byte {
            b'{' => {
                depth += 1;
                if depth > MAX_GROUP_DEPTH {
                    return Err(DiscoveryError::LimitExceeded);
                }
                index += 1;
                // `{\*\destination ...}` — ignorable by the producer's own instruction.
                if bytes[index..].starts_with(br"\*") && skipping_from.is_none() {
                    skipping_from = Some(depth);
                }
            }
            b'}' => {
                if skipping_from == Some(depth) {
                    skipping_from = None;
                }
                depth = depth.saturating_sub(1);
                index += 1;
            }
            b'\\' => {
                let (consumed, produced) = control_word(&bytes[index..]);
                index += consumed;
                if skipping_from.is_some() {
                    continue;
                }
                match produced {
                    Produced::Destination(name) => {
                        if SKIPPED_DESTINATIONS.contains(&name.as_str()) {
                            skipping_from = Some(depth);
                        }
                    }
                    Produced::Text(text) => {
                        if skip_unicode_replacements > 0 {
                            skip_unicode_replacements -= 1;
                        } else {
                            out.push_str(&text);
                        }
                    }
                    Produced::UnicodeCharacter(character, replacements) => {
                        out.push(character);
                        skip_unicode_replacements = replacements;
                    }
                    Produced::Nothing => {}
                }
            }
            _ => {
                index += 1;
                if skipping_from.is_some() {
                    continue;
                }
                if skip_unicode_replacements > 0 && byte != b'\n' && byte != b'\r' {
                    skip_unicode_replacements -= 1;
                    continue;
                }
                // Literal newlines in the stream are formatting, not content: RTF ends a paragraph
                // with `\par`, never with a line feed.
                if byte == b'\n' || byte == b'\r' {
                    continue;
                }
                out.push(byte as char);
            }
        }
    }
    Ok(out)
}

enum Produced {
    /// A control word that names a group's purpose.
    Destination(String),
    /// A control word that stands for characters.
    Text(String),
    /// A `\uN` escape, and how many following characters are its legacy replacement.
    UnicodeCharacter(char, usize),
    Nothing,
}

/// Read one backslash escape. Returns how many bytes it occupied and what it means. Always consumes
/// at least one byte, so the caller's loop cannot stall.
fn control_word(bytes: &[u8]) -> (usize, Produced) {
    if bytes.len() < 2 {
        return (bytes.len().max(1), Produced::Nothing);
    }
    match bytes[1] {
        // The three literal escapes.
        b'\\' => (2, Produced::Text("\\".to_owned())),
        b'{' => (2, Produced::Text("{".to_owned())),
        b'}' => (2, Produced::Text("}".to_owned())),
        b'*' => (2, Produced::Nothing),
        // A raw byte in the document's code page. Read as windows-1252, the code page essentially
        // every RTF in a production was written in; a wrong guess costs one character, and refusing
        // the document would cost the document.
        b'\'' => {
            if bytes.len() < 4 {
                return (bytes.len(), Produced::Nothing);
            }
            let hex = std::str::from_utf8(&bytes[2..4]).ok();
            let value = hex.and_then(|hex| u8::from_str_radix(hex, 16).ok());
            match value {
                Some(byte) => {
                    let raw = [byte];
                    let (decoded, _) = encoding_rs::WINDOWS_1252.decode_without_bom_handling(&raw);
                    (4, Produced::Text(decoded.into_owned()))
                }
                None => (4, Produced::Nothing),
            }
        }
        byte if byte.is_ascii_alphabetic() => {
            let mut end = 1;
            while end < bytes.len() && bytes[end].is_ascii_alphabetic() {
                end += 1;
            }
            let name = String::from_utf8_lossy(&bytes[1..end]).into_owned();
            let mut parameter_end = end;
            if parameter_end < bytes.len() && (bytes[parameter_end] == b'-') {
                parameter_end += 1;
            }
            while parameter_end < bytes.len() && bytes[parameter_end].is_ascii_digit() {
                parameter_end += 1;
            }
            let parameter: Option<i64> = std::str::from_utf8(&bytes[end..parameter_end])
                .ok()
                .and_then(|digits| digits.parse().ok());
            // One space after a control word delimits it and is not text.
            let mut consumed = parameter_end;
            if consumed < bytes.len() && bytes[consumed] == b' ' {
                consumed += 1;
            }
            match name.as_str() {
                "par" | "line" | "sect" | "page" | "row" => {
                    (consumed, Produced::Text("\n".to_owned()))
                }
                "tab" | "cell" => (consumed, Produced::Text(" ".to_owned())),
                "emdash" => (consumed, Produced::Text("\u{2014}".to_owned())),
                "endash" => (consumed, Produced::Text("\u{2013}".to_owned())),
                "lquote" => (consumed, Produced::Text("\u{2018}".to_owned())),
                "rquote" => (consumed, Produced::Text("\u{2019}".to_owned())),
                "ldblquote" => (consumed, Produced::Text("\u{201C}".to_owned())),
                "rdblquote" => (consumed, Produced::Text("\u{201D}".to_owned())),
                "bullet" => (consumed, Produced::Text("\u{2022}".to_owned())),
                "u" => match parameter.and_then(|value| {
                    let scalar = if value < 0 { value + 65_536 } else { value };
                    u32::try_from(scalar).ok().and_then(char::from_u32)
                }) {
                    // One replacement character follows a `\u` escape by default.
                    Some(character) => (consumed, Produced::UnicodeCharacter(character, 1)),
                    None => (consumed, Produced::Nothing),
                },
                _ => (consumed, Produced::Destination(name)),
            }
        }
        _ => (2, Produced::Nothing),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extract::{extract as extract_document, ExtractionOutcome};

    fn text_of(rtf: &[u8]) -> String {
        match extract_document(rtf).unwrap() {
            ExtractionOutcome::Extracted(document) => document.pages[0].lines.join("\n"),
            other => panic!("expected an extraction, got {other:?}"),
        }
    }

    #[test]
    fn control_words_come_out_and_words_stay_in() {
        let rtf = br"{\rtf1\ansi\deff0 The seller shall\par indemnify the buyer.\par}";
        assert_eq!(text_of(rtf), "The seller shall\nindemnify the buyer.");
    }

    #[test]
    fn the_font_and_colour_tables_never_reach_the_text() {
        let rtf = br"{\rtf1{\fonttbl{\f0\froman Times New Roman;}}{\colortbl;\red255\green0\blue0;}Body text.}";
        assert_eq!(text_of(rtf), "Body text.");
    }

    #[test]
    fn an_ignorable_destination_is_skipped_whole() {
        let rtf = br"{\rtf1{\*\generator Riched20 10.0;}Visible.}";
        assert_eq!(text_of(rtf), "Visible.");
    }

    #[test]
    fn escaped_characters_and_unicode_escapes_decode() {
        let rtf = br"{\rtf1 Fee \'a3100 for M\u252?ller \{braces\}.}";
        assert_eq!(text_of(rtf), "Fee £100 for Müller {braces}.");
    }

    #[test]
    fn a_truncated_stream_returns_its_text_rather_than_failing() {
        // Half a document is still half a document; a production is full of files that were cut off
        // in transit, and each one still has to reach a reviewer.
        let rtf = br"{\rtf1\ansi The witness stated\par that the meet";
        assert!(text_of(rtf).contains("The witness stated"));
    }

    #[test]
    fn a_group_nested_past_the_ceiling_is_refused_rather_than_recursed() {
        let mut bomb = br"{\rtf1".to_vec();
        bomb.extend(std::iter::repeat_n(b'{', 2000));
        assert_eq!(
            to_text(&bomb, &Limits::default()),
            Err(DiscoveryError::LimitExceeded)
        );
    }

    #[test]
    fn a_stream_of_backslashes_terminates() {
        // Every branch consumes at least one byte, so no input can make the walk stall.
        let pathological = vec![b'\\'; 100_000];
        assert!(to_text(&pathological, &Limits::default()).is_ok());
    }
}
