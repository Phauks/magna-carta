//! The acceptance suite's structural inspector.
//!
//! A PDF is not byte-reproducible — the creation date, the document identifier, and font subset
//! naming all vary per run — so the golden files are structural rather than byte-equal. This prints
//! the three facts they pin: page count, extracted text, and the names of the embedded fonts.
//!
//! The embedded-font assertion is the one that actually catches the font-substitution regression:
//! a source document asking for Calibri must come back carrying Carlito, not Liberation.
//!
//! Reading is done with `lopdf` — the same crate, at the same pinned version, that `crates/pdf-core`
//! extracts text with — so this reuses the repository's PDF reader rather than introducing a second
//! one, and taking it directly rather than through `pdf-core` keeps the render and image stacks out
//! of this workspace's test build.
//!
//! Usage: `cargo run --example inspect-conversion -- <file.pdf>`

use std::collections::BTreeSet;

fn main() -> std::process::ExitCode {
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("usage: inspect-conversion <file.pdf>");
        return std::process::ExitCode::from(2);
    };

    let document = match lopdf::Document::load(&path) {
        Ok(document) => document,
        Err(error) => {
            eprintln!("inspect-conversion: {path} did not parse as a PDF: {error}");
            return std::process::ExitCode::from(1);
        }
    };

    let pages: Vec<u32> = document.get_pages().keys().copied().collect();
    let text = document.extract_text(&pages).unwrap_or_default();
    let fonts = embedded_font_names(&document);

    // One fact per line, so the shell gate can assert on each without a JSON parser.
    println!("pages: {}", pages.len());
    println!("fonts: {}", fonts.into_iter().collect::<Vec<_>>().join(","));
    // Extraction preserves the page's line breaks, so a sentence that wraps arrives split across
    // lines with the break inside it. Assertions must be about whether the CONTENT survived, not
    // about where the text happened to wrap: a line break moves whenever a font or a suite version
    // changes, and pinning it would redden the build for a layout shift that broke nothing. So the
    // collapsed form is the line the gate greps, and the raw block below is kept only so a failure
    // can be read in the log.
    println!("text: {}", collapse_whitespace(&text));
    println!("text-begin");
    println!("{text}");
    println!("text-end");
    std::process::ExitCode::SUCCESS
}

/// Every run of whitespace — including the newlines extraction inserts at each line break — reduced
/// to a single space, and the ends trimmed.
fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Every `/BaseFont` name reachable from a page's font resources, with the subset prefix stripped.
///
/// A subsetted font is named like `ABCDEF+Carlito`; the six-letter prefix is generated per file, so
/// keeping it would make the golden file vary run to run — exactly what a structural assertion is
/// meant to avoid.
fn embedded_font_names(document: &lopdf::Document) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    for object in document.objects.values() {
        let Ok(dictionary) = object.as_dict() else {
            continue;
        };
        let Ok(base_font) = dictionary.get(b"BaseFont") else {
            continue;
        };
        let Ok(name) = base_font.as_name() else {
            continue;
        };
        let name = String::from_utf8_lossy(name).into_owned();
        let stripped = match name.split_once('+') {
            Some((prefix, rest)) if prefix.len() == 6 => rest.to_owned(),
            _ => name,
        };
        names.insert(stripped);
    }
    names
}
