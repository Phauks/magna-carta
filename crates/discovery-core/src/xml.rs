//! A bounded, text-only walk over an XML part.
//!
//! Shared by every package format, because `.docx`, `.xlsx`, `.pptx`, and OpenDocument all reduce to
//! the same problem: pull the character data out of a tree, break lines where the format says a
//! paragraph ends, and never let the tree itself become the attack.
//!
//! Three properties this walk has by construction, and they are why it is a pull parser rather than
//! a tree builder:
//!
//! - **No entity expansion.** The parser resolves only the five predefined XML entities and numeric
//!   character references. A document type definition declaring an entity in terms of other entities
//!   — the classic exponential expansion — has no decoder here to reach, so the bomb is not guarded
//!   against, it is absent.
//! - **No recursion.** Depth is a counter, not a call stack, so a tree nested a million deep costs a
//!   number rather than a stack frame, and the depth ceiling refuses it long before that.
//! - **No external references.** Nothing here opens a file, a URL, or another part; the caller hands
//!   in bytes it already holds.

use quick_xml::events::Event;
use quick_xml::Reader;

use crate::error::DiscoveryError;
use crate::limits::Limits;

/// Which elements mean what, for one format's parts.
pub struct XmlTextRules {
    /// Elements whose END means "the line ends here" — a paragraph, a table row, a slide's text
    /// body. Matched on the local name, so a namespace prefix does not have to be predicted.
    pub line_break_elements: &'static [&'static str],
    /// Elements whose character data is markup rather than content — a style table, a settings part,
    /// binary data carried inline. Their whole subtree is skipped.
    pub skipped_elements: &'static [&'static str],
    /// Elements that emit a space where they appear, rather than character data: a tab, a soft
    /// break, a cell boundary.
    pub space_elements: &'static [&'static str],
}

/// Walk one XML part and return its character data as lines, already normalized. Empty lines are
/// dropped here rather than by the caller, so a part of nothing but markup returns an empty vector
/// and the caller can tell "no text" from "one blank line".
pub fn text_lines(
    xml: &[u8],
    rules: &XmlTextRules,
    limits: &Limits,
) -> Result<Vec<String>, DiscoveryError> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut lines: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut depth = 0usize;
    let mut events = 0usize;
    // Depth of the outermost skipped element, if we are inside one. Tracked as a depth rather than a
    // name so a skipped element containing another of its own kind still un-skips exactly once.
    let mut skipping_from: Option<usize> = None;
    let mut buffer = Vec::new();
    loop {
        events += 1;
        if events > limits.max_xml_events {
            return Err(DiscoveryError::LimitExceeded);
        }
        let event = match reader.read_event_into(&mut buffer) {
            Ok(event) => event,
            // A damaged part is a corrupt document, never a panic and never a partial answer
            // presented as a whole one.
            Err(_) => return Err(DiscoveryError::Corrupt),
        };
        match event {
            Event::Start(start) => {
                depth += 1;
                if depth > limits.max_xml_depth {
                    return Err(DiscoveryError::LimitExceeded);
                }
                let name = local_name(start.name().as_ref());
                if skipping_from.is_none() && rules.skipped_elements.contains(&name.as_str()) {
                    skipping_from = Some(depth);
                }
                if skipping_from.is_none() && rules.space_elements.contains(&name.as_str()) {
                    current.push(' ');
                }
            }
            Event::Empty(empty) => {
                let name = local_name(empty.name().as_ref());
                if skipping_from.is_none() {
                    if rules.space_elements.contains(&name.as_str()) {
                        current.push(' ');
                    }
                    if rules.line_break_elements.contains(&name.as_str()) {
                        push_line(&mut lines, &mut current);
                    }
                }
            }
            Event::End(end) => {
                let name = local_name(end.name().as_ref());
                if skipping_from == Some(depth) {
                    skipping_from = None;
                } else if skipping_from.is_none()
                    && rules.line_break_elements.contains(&name.as_str())
                {
                    push_line(&mut lines, &mut current);
                }
                depth = depth.saturating_sub(1);
            }
            Event::Text(_) | Event::CData(_) if skipping_from.is_some() => {}
            Event::Text(text) => {
                // Character data only — every entity reference arrives as its own event, handled
                // below, so nothing here needs to unescape anything.
                match text.decode() {
                    Ok(decoded) => current.push_str(decoded.as_ref()),
                    Err(_) => return Err(DiscoveryError::Corrupt),
                }
                if current.len() > limits.max_extracted_text_bytes {
                    return Err(DiscoveryError::LimitExceeded);
                }
            }
            Event::CData(data) => {
                match std::str::from_utf8(data.as_ref()) {
                    Ok(decoded) => current.push_str(decoded),
                    Err(_) => return Err(DiscoveryError::Corrupt),
                }
                if current.len() > limits.max_extracted_text_bytes {
                    return Err(DiscoveryError::LimitExceeded);
                }
            }
            // An entity reference arrives as its own event and is NEVER looked up: the five
            // predefined entities and numeric character references resolve to their characters, and
            // anything else — including an entity a document type definition declared in terms of
            // other entities — is emitted as the literal text it was written as. That is what makes
            // exponential entity expansion impossible here rather than merely bounded.
            Event::GeneralRef(reference) if skipping_from.is_none() => {
                current.push_str(&resolve_reference(reference.as_ref()));
            }
            Event::Eof => {
                // Elements still open at the end of input means the part was cut off. A partial
                // answer presented as a whole one is the one outcome that must not happen: a
                // document silently missing its second half is worse than a named exception.
                if depth > 0 {
                    return Err(DiscoveryError::Corrupt);
                }
                break;
            }
            _ => {}
        }
        buffer.clear();
        if lines.len() > limits.max_xml_events {
            return Err(DiscoveryError::LimitExceeded);
        }
    }
    push_line(&mut lines, &mut current);
    Ok(lines)
}

/// The character data of the first element whose local name is one of `names`, in the order given —
/// the shape every package format's property part takes. Returns `None` rather than an error for a
/// part that is absent or damaged, because a missing property is a document without that property,
/// not a document that failed to read.
pub fn first_element_text(xml: &[u8], names: &[&str], limits: &Limits) -> Option<String> {
    for name in names {
        if let Some(value) = read_named(xml, name, limits) {
            return Some(value);
        }
    }
    None
}

fn read_named(xml: &[u8], wanted: &str, limits: &Limits) -> Option<String> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::new();
    let mut inside = false;
    let mut events = 0usize;
    loop {
        events += 1;
        if events > limits.max_xml_events {
            return None;
        }
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(start)) => inside = local_name(start.name().as_ref()) == wanted,
            Ok(Event::Text(text)) if inside => {
                let decoded = text.decode().ok()?;
                let value = crate::normalize::normalize_line(decoded.as_ref());
                if !value.is_empty() {
                    return Some(value);
                }
                inside = false;
            }
            Ok(Event::End(_)) => inside = false,
            Ok(Event::Eof) | Err(_) => return None,
            Ok(_) => {}
        }
        buffer.clear();
    }
}

/// The five predefined XML entities and numeric character references, and nothing else. An
/// unrecognized reference comes back as the literal `&name;` it was written as, so no text is lost
/// and no lookup ever happens.
fn resolve_reference(content: &[u8]) -> String {
    let name = String::from_utf8_lossy(content);
    match name.as_ref() {
        "amp" => return "&".to_owned(),
        "lt" => return "<".to_owned(),
        "gt" => return ">".to_owned(),
        "quot" => return "\"".to_owned(),
        "apos" => return "'".to_owned(),
        _ => {}
    }
    if let Some(digits) = name.strip_prefix('#') {
        let code = match digits
            .strip_prefix('x')
            .or_else(|| digits.strip_prefix('X'))
        {
            Some(hex) => u32::from_str_radix(hex, 16).ok(),
            None => digits.parse::<u32>().ok(),
        };
        if let Some(character) = code.and_then(char::from_u32) {
            return character.to_string();
        }
    }
    format!("&{name};")
}

fn push_line(lines: &mut Vec<String>, current: &mut String) {
    let line = crate::normalize::normalize_line(current);
    current.clear();
    if !line.is_empty() {
        lines.push(line);
    }
}

/// The element name with any namespace prefix removed. Package formats prefix everything (`w:p`,
/// `a:t`, `text:p`) and the prefix is bound by a declaration this walk deliberately does not read,
/// so matching on the local name is both simpler and more robust than predicting prefixes.
fn local_name(raw: &[u8]) -> String {
    let name = String::from_utf8_lossy(raw);
    match name.rsplit_once(':') {
        Some((_, local)) => local.to_owned(),
        None => name.into_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RULES: XmlTextRules = XmlTextRules {
        line_break_elements: &["p"],
        skipped_elements: &["binData"],
        space_elements: &["tab"],
    };

    #[test]
    fn character_data_comes_out_as_lines_broken_where_the_format_says() {
        let xml = b"<body><w:p>first para</w:p><w:p>second<w:tab/>para</w:p></body>";
        assert_eq!(
            text_lines(xml, &RULES, &Limits::default()).unwrap(),
            vec!["first para", "second para"]
        );
    }

    #[test]
    fn a_skipped_subtree_contributes_nothing() {
        let xml = b"<body><w:p>kept</w:p><binData>AAAABBBB</binData></body>";
        assert_eq!(
            text_lines(xml, &RULES, &Limits::default()).unwrap(),
            vec!["kept"]
        );
    }

    #[test]
    fn predefined_entities_resolve_and_an_unknown_one_survives_as_written() {
        let xml = b"<body><w:p>Smith &amp; Jones</w:p><w:p>fee &pound; due</w:p></body>";
        let lines = text_lines(xml, &RULES, &Limits::default()).unwrap();
        assert_eq!(lines[0], "Smith & Jones");
        assert!(lines[1].contains("fee"));
    }

    /// The billion-laughs shape. There is no entity-expansion decoder here to reach, so the nested
    /// declarations are inert: the document produces its literal text and returns, in bounded time
    /// and bounded memory, rather than expanding.
    #[test]
    fn an_entity_expansion_bomb_expands_nothing() {
        let bomb = br#"<?xml version="1.0"?>
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
 <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
 <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
]>
<body><p>&lol4;</p></body>"#;
        let lines = text_lines(bomb, &RULES, &Limits::default()).unwrap();
        let total: usize = lines.iter().map(String::len).sum();
        assert!(total < 1_000, "the bomb expanded to {total} bytes");
    }

    #[test]
    fn a_tree_nested_past_the_depth_ceiling_is_refused_rather_than_walked() {
        let limits = Limits {
            max_xml_depth: 16,
            ..Limits::default()
        };
        let mut deep = String::new();
        for _ in 0..1000 {
            deep.push_str("<a>");
        }
        deep.push_str("text");
        for _ in 0..1000 {
            deep.push_str("</a>");
        }
        assert_eq!(
            text_lines(deep.as_bytes(), &RULES, &limits),
            Err(DiscoveryError::LimitExceeded)
        );
    }

    #[test]
    fn a_truncated_part_is_corrupt_rather_than_a_partial_answer() {
        let truncated = b"<body><w:p>half a sentence";
        assert_eq!(
            text_lines(truncated, &RULES, &Limits::default()),
            Err(DiscoveryError::Corrupt)
        );
    }
}
