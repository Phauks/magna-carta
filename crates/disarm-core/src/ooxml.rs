//! Office packages (Word, Excel, PowerPoint, with or without macros): the macro project, ActiveX
//! controls, the custom ribbon, links to other workbooks and every relationship that fetches
//! something from outside on open are removed or blanked; embedded objects are emptied, except an
//! embedded Office package (a chart's workbook), which is disarmed in turn and kept; DDE and include
//! fields in Word and DDE formulas in Excel are neutralized, with their last shown result kept.
//!
//! The package is rebuilt part by part. A part that is copied is copied byte for byte; a part that is
//! rewritten is streamed through an XML reader and writer, never parsed into a tree, so its size
//! costs memory once.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{Cursor, Read, Write};

use quick_xml::events::{BytesStart, BytesText, Event};
use quick_xml::{Reader, Writer};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::limits::Limits;
use crate::report::{DisarmReport, RemovalKind};
use crate::{DisarmError, Disarmed, DocumentKind};

const CONTENT_TYPES: &str = "[Content_Types].xml";

/// Field codes that run a command or pull content from somewhere else when the document updates.
const DANGEROUS_FIELDS: [&str; 6] = [
    "DDE",
    "DDEAUTO",
    "INCLUDETEXT",
    "INCLUDEPICTURE",
    "LINK",
    "IMPORT",
];

/// Macro-enabled main-part content types, each with the plain type it becomes and the extension a
/// file of that type carries.
const MACRO_MAIN_TYPES: [(&str, &str, &str); 9] = [
    (
        "application/vnd.ms-word.document.macroEnabled.main+xml",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        "docx",
    ),
    (
        "application/vnd.ms-word.template.macroEnabledTemplate.main+xml",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml",
        "dotx",
    ),
    (
        "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
        "xlsx",
    ),
    (
        "application/vnd.ms-excel.template.macroEnabled.main+xml",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml",
        "xltx",
    ),
    (
        "application/vnd.ms-excel.addin.macroEnabled.main+xml",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
        "xlsx",
    ),
    (
        "application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
        "pptx",
    ),
    (
        "application/vnd.ms-powerpoint.slideshow.macroEnabled.main+xml",
        "application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml",
        "ppsx",
    ),
    (
        "application/vnd.ms-powerpoint.template.macroEnabled.main+xml",
        "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml",
        "potx",
    ),
    (
        "application/vnd.ms-powerpoint.addin.macroEnabled.main+xml",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
        "pptx",
    ),
];

/// Whether a zip is an Office package: it declares its content types where every package must.
pub(crate) fn is_office_package(bytes: &[u8]) -> bool {
    ZipArchive::new(Cursor::new(bytes))
        .map(|archive| archive.index_for_name(CONTENT_TYPES).is_some())
        .unwrap_or(false)
}

/// Why a part is dropped from the package.
fn removal_for_part(name: &str, content_type: Option<&str>) -> Option<RemovalKind> {
    let lowered = name.to_ascii_lowercase();
    let content_type = content_type.unwrap_or("").to_ascii_lowercase();
    if lowered.ends_with("vbaproject.bin")
        || lowered.ends_with("vbadata.xml")
        || lowered.contains("vbaprojectsignature")
        || content_type.contains("vbaproject")
        || content_type.contains("vbadata")
        || content_type.contains("attachedtoolbars")
        || content_type.contains("keymapcustomizations")
    {
        return Some(RemovalKind::Script);
    }
    if lowered.contains("/activex/") || content_type.contains("activex") {
        return Some(RemovalKind::Control);
    }
    if lowered.starts_with("customui/") || lowered.contains("/customui/") {
        return Some(RemovalKind::CustomInterface);
    }
    if lowered.contains("/externallinks/") || content_type.contains("externallink") {
        return Some(RemovalKind::ExternalLink);
    }
    None
}

/// Whether a removed part is worth one count in the report. The macro project is one script however
/// many parts carry it, and an ActiveX control is its XML part, not its binary.
fn counts_once(name: &str, kind: RemovalKind) -> bool {
    let lowered = name.to_ascii_lowercase();
    match kind {
        RemovalKind::Script => lowered.ends_with("vbaproject.bin"),
        RemovalKind::Control => lowered.ends_with(".xml"),
        RemovalKind::CustomInterface => lowered.ends_with(".xml"),
        RemovalKind::ExternalLink => lowered.ends_with(".xml"),
        _ => true,
    }
}

struct Part {
    name: String,
    bytes: Vec<u8>,
}

/// Read every part, enforcing the package limits as it goes.
fn read_parts(bytes: &[u8], limits: &Limits, inflated: &mut u64) -> Result<Vec<Part>, DisarmError> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|_| DisarmError::Malformed)?;
    if archive.len() > limits.max_package_entries {
        return Err(DisarmError::LimitExceeded);
    }
    let mut parts = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|error| match error {
            zip::result::ZipError::UnsupportedArchive(_) => DisarmError::Encrypted,
            _ => DisarmError::Malformed,
        })?;
        if entry.is_dir() {
            continue;
        }
        let name = entry
            .name()
            .map_err(|_| DisarmError::Malformed)?
            .into_owned();
        let mut content = Vec::new();
        entry
            .take(limits.max_part_bytes.saturating_add(1))
            .read_to_end(&mut content)
            .map_err(|_| DisarmError::Malformed)?;
        let length = u64::try_from(content.len()).map_err(|_| DisarmError::LimitExceeded)?;
        if length > limits.max_part_bytes {
            return Err(DisarmError::LimitExceeded);
        }
        *inflated = inflated.saturating_add(length);
        if *inflated > limits.max_package_inflated_bytes {
            return Err(DisarmError::LimitExceeded);
        }
        parts.push(Part {
            name,
            bytes: content,
        });
    }
    Ok(parts)
}

/// The declared content types: overrides by part name (no leading slash) and defaults by extension.
#[derive(Default)]
struct ContentTypes {
    overrides: BTreeMap<String, String>,
    defaults: BTreeMap<String, String>,
}

impl ContentTypes {
    fn parse(bytes: &[u8]) -> Result<Self, DisarmError> {
        let mut types = Self::default();
        let mut reader = Reader::from_reader(bytes);
        let mut buffer = Vec::new();
        loop {
            match reader
                .read_event_into(&mut buffer)
                .map_err(|_| DisarmError::Malformed)?
            {
                Event::Eof => break,
                Event::Start(element) | Event::Empty(element) => {
                    match element.local_name().as_ref() {
                        b"Override" => {
                            let part = attribute(&element, b"PartName")?;
                            let kind = attribute(&element, b"ContentType")?;
                            if let (Some(part), Some(kind)) = (part, kind) {
                                types.overrides.insert(
                                    part.trim_start_matches('/').to_ascii_lowercase(),
                                    kind,
                                );
                            }
                        }
                        b"Default" => {
                            let extension = attribute(&element, b"Extension")?;
                            let kind = attribute(&element, b"ContentType")?;
                            if let (Some(extension), Some(kind)) = (extension, kind) {
                                types.defaults.insert(extension.to_ascii_lowercase(), kind);
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
            buffer.clear();
        }
        Ok(types)
    }

    fn of(&self, name: &str) -> Option<&str> {
        let lowered = name.to_ascii_lowercase();
        if let Some(kind) = self.overrides.get(&lowered) {
            return Some(kind);
        }
        let extension = lowered.rsplit_once('.').map(|(_, extension)| extension)?;
        self.defaults.get(extension).map(String::as_str)
    }
}

/// An attribute's unescaped value, by its full name.
fn attribute(element: &BytesStart<'_>, key: &[u8]) -> Result<Option<String>, DisarmError> {
    for found in element.attributes() {
        let found = found.map_err(|_| DisarmError::Malformed)?;
        if found.key.as_ref() == key {
            let value = found
                .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                .map_err(|_| DisarmError::Malformed)?;
            return Ok(Some(value.into_owned()));
        }
    }
    Ok(None)
}

/// The part a relationships file describes: `word/_rels/document.xml.rels` describes
/// `word/document.xml`, and `_rels/.rels` describes the package itself (the empty name).
fn source_of_relationships(name: &str) -> Option<String> {
    let (directory, file) = match name.rsplit_once('/') {
        Some((directory, file)) => (directory, file),
        None => ("", name),
    };
    let directory = directory.strip_suffix("_rels")?;
    let file = file.strip_suffix(".rels")?;
    Some(format!("{directory}{file}"))
}

/// Resolve a relationship's internal target against its source part, to a package part name.
fn resolve_target(source: &str, target: &str) -> String {
    let mut segments: Vec<&str> = Vec::new();
    if let Some(absolute) = target.strip_prefix('/') {
        segments.extend(absolute.split('/'));
    } else {
        if let Some((directory, _)) = source.rsplit_once('/') {
            segments.extend(directory.split('/'));
        }
        for segment in target.split('/') {
            match segment {
                ".." => {
                    segments.pop();
                }
                "." | "" => {}
                other => segments.push(other),
            }
        }
    }
    segments.retain(|segment| !segment.is_empty());
    segments.join("/").to_ascii_lowercase()
}

/// A link a person can follow in a browser: never a file path, a network share or a script.
fn is_web_address(target: &str) -> bool {
    let lowered = target.trim_start().to_ascii_lowercase();
    lowered.starts_with("https://")
        || lowered.starts_with("http://")
        || lowered.starts_with("mailto:")
}

/// An empty compound file: what an emptied embedded object is replaced with, so the relationship
/// to it stays valid and the document opens without a repair prompt, but there is nothing to open.
fn empty_compound_file() -> Result<Vec<u8>, DisarmError> {
    let compound =
        cfb::CompoundFile::create(Cursor::new(Vec::new())).map_err(|_| DisarmError::Write)?;
    Ok(compound.into_inner().into_inner())
}

pub(crate) fn disarm(bytes: &[u8], limits: &Limits, depth: u8) -> Result<Disarmed, DisarmError> {
    let mut inflated = 0_u64;
    disarm_package(bytes, limits, depth, &mut inflated)
}

fn disarm_package(
    bytes: &[u8],
    limits: &Limits,
    depth: u8,
    inflated: &mut u64,
) -> Result<Disarmed, DisarmError> {
    if depth > limits.max_package_depth {
        return Err(DisarmError::LimitExceeded);
    }
    let mut parts = read_parts(bytes, limits, inflated)?;
    let content_types = parts
        .iter()
        .find(|part| part.name == CONTENT_TYPES)
        .map(|part| ContentTypes::parse(&part.bytes))
        .ok_or(DisarmError::Malformed)??;
    let mut report = DisarmReport::new();

    // 1. Decide which parts go.
    let mut removed_parts: BTreeSet<String> = BTreeSet::new();
    for part in &parts {
        if let Some(kind) = removal_for_part(&part.name, content_types.of(&part.name)) {
            if counts_once(&part.name, kind) {
                report.add(kind, 1);
            }
            removed_parts.insert(part.name.to_ascii_lowercase());
        }
    }

    // 2. Rewrite every relationships file: drop relationships to removed parts, blank external
    //    targets that are not web links. Remember the dropped identifiers per source part.
    let mut dropped_identifiers: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for part in parts.iter_mut() {
        let lowered = part.name.to_ascii_lowercase();
        if removed_parts.contains(&lowered) || !lowered.ends_with(".rels") {
            continue;
        }
        let Some(source) = source_of_relationships(&lowered) else {
            continue;
        };
        let (rewritten, dropped, blanked) =
            rewrite_relationships(&part.bytes, &source, &removed_parts)?;
        report.add(RemovalKind::ExternalLink, blanked);
        part.bytes = rewritten;
        if !dropped.is_empty() {
            dropped_identifiers.insert(source, dropped);
        }
    }

    // 3. Content types, body parts and embedded objects.
    let mut output_extension = None;
    for part in parts.iter_mut() {
        let lowered = part.name.to_ascii_lowercase();
        if removed_parts.contains(&lowered) {
            continue;
        }
        if part.name == CONTENT_TYPES {
            let (rewritten, extension) = rewrite_content_types(&part.bytes, &removed_parts)?;
            part.bytes = rewritten;
            output_extension = extension;
        } else if lowered.contains("/embeddings/") {
            if engine_host::format::detect(&part.bytes) == Some(engine_host::format::Format::Zip)
                && is_office_package(&part.bytes)
            {
                let inner = disarm_package(&part.bytes, limits, depth.saturating_add(1), inflated)?;
                report.absorb(&inner.report);
                part.bytes = inner.bytes;
            } else {
                report.add(RemovalKind::EmbeddedObject, 1);
                part.bytes = empty_compound_file()?;
            }
        } else if lowered.ends_with(".xml") || lowered.ends_with(".vml") {
            let dropped = dropped_identifiers.get(&lowered);
            let is_word = lowered.starts_with("word/");
            let is_sheet = lowered.starts_with("xl/worksheets/");
            if dropped.is_some() || is_word || is_sheet {
                let empty = BTreeSet::new();
                let (rewritten, neutralized) =
                    rewrite_body(&part.bytes, dropped.unwrap_or(&empty), is_word, is_sheet)?;
                report.add(RemovalKind::DynamicField, neutralized);
                part.bytes = rewritten;
            }
        }
    }

    // 4. Write the package, content types first.
    parts.retain(|part| !removed_parts.contains(&part.name.to_ascii_lowercase()));
    parts.sort_by_key(|part| part.name != CONTENT_TYPES);
    let output = write_package(&parts)?;
    verify(&output, limits)?;
    Ok(Disarmed {
        bytes: output,
        kind: DocumentKind::OfficePackage,
        report,
        output_extension,
    })
}

fn write_package(parts: &[Part]) -> Result<Vec<u8>, DisarmError> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for part in parts {
        writer
            .start_file(part.name.as_str(), options)
            .map_err(|_| DisarmError::Write)?;
        writer
            .write_all(&part.bytes)
            .map_err(|_| DisarmError::Write)?;
    }
    let cursor = writer.finish().map_err(|_| DisarmError::Write)?;
    Ok(cursor.into_inner())
}

/// Returns the rewritten file, the identifiers of relationships dropped, and how many external
/// targets were blanked.
fn rewrite_relationships(
    bytes: &[u8],
    source: &str,
    removed_parts: &BTreeSet<String>,
) -> Result<(Vec<u8>, BTreeSet<String>, u32), DisarmError> {
    let mut reader = Reader::from_reader(bytes);
    let mut writer = Writer::new(Vec::with_capacity(bytes.len()));
    let mut buffer = Vec::new();
    let mut dropped = BTreeSet::new();
    let mut blanked = 0_u32;
    let mut skipping_depth = 0_usize;
    loop {
        let event = reader
            .read_event_into(&mut buffer)
            .map_err(|_| DisarmError::Malformed)?;
        if skipping_depth > 0 {
            match event {
                Event::Start(_) => skipping_depth = skipping_depth.saturating_add(1),
                Event::End(_) => skipping_depth = skipping_depth.saturating_sub(1),
                Event::Eof => break,
                _ => {}
            }
            buffer.clear();
            continue;
        }
        match event {
            Event::Eof => break,
            Event::Start(ref element) | Event::Empty(ref element)
                if element.local_name().as_ref() == b"Relationship" =>
            {
                let is_start = matches!(event, Event::Start(_));
                let identifier = attribute(element, b"Id")?.unwrap_or_default();
                let target = attribute(element, b"Target")?.unwrap_or_default();
                let kind = attribute(element, b"Type")?.unwrap_or_default();
                let external = attribute(element, b"TargetMode")?
                    .map(|mode| mode.eq_ignore_ascii_case("External"))
                    .unwrap_or(false);
                if !external && removed_parts.contains(&resolve_target(source, &target)) {
                    dropped.insert(identifier);
                    if is_start {
                        skipping_depth = 1;
                    }
                } else if external
                    && !(kind.ends_with("/hyperlink") && is_web_address(&target))
                    && !target.is_empty()
                {
                    blanked = blanked.saturating_add(1);
                    let mut replacement = BytesStart::new(
                        String::from_utf8_lossy(element.name().as_ref()).into_owned(),
                    );
                    for found in element.attributes() {
                        let found = found.map_err(|_| DisarmError::Malformed)?;
                        if found.key.as_ref() == b"Target" {
                            replacement.push_attribute(("Target", ""));
                        } else {
                            replacement.push_attribute(found);
                        }
                    }
                    let rewritten = if is_start {
                        Event::Start(replacement)
                    } else {
                        Event::Empty(replacement)
                    };
                    writer
                        .write_event(rewritten)
                        .map_err(|_| DisarmError::Write)?;
                } else {
                    writer
                        .write_event(event.borrow())
                        .map_err(|_| DisarmError::Write)?;
                }
            }
            other => writer.write_event(other).map_err(|_| DisarmError::Write)?,
        }
        buffer.clear();
    }
    Ok((writer.into_inner(), dropped, blanked))
}

/// Drop overrides for removed parts and turn a macro-enabled main type into its plain one. Returns
/// the rewritten file and, when the main type changed, the extension the copy should carry.
fn rewrite_content_types(
    bytes: &[u8],
    removed_parts: &BTreeSet<String>,
) -> Result<(Vec<u8>, Option<&'static str>), DisarmError> {
    let mut reader = Reader::from_reader(bytes);
    let mut writer = Writer::new(Vec::with_capacity(bytes.len()));
    let mut buffer = Vec::new();
    let mut extension = None;
    loop {
        let event = reader
            .read_event_into(&mut buffer)
            .map_err(|_| DisarmError::Malformed)?;
        match event {
            Event::Eof => break,
            Event::Start(ref element) | Event::Empty(ref element)
                if element.local_name().as_ref() == b"Override" =>
            {
                let part = attribute(element, b"PartName")?.unwrap_or_default();
                if removed_parts.contains(&part.trim_start_matches('/').to_ascii_lowercase()) {
                    buffer.clear();
                    continue;
                }
                let content_type = attribute(element, b"ContentType")?.unwrap_or_default();
                let plain = MACRO_MAIN_TYPES
                    .iter()
                    .find(|(macro_type, _, _)| macro_type.eq_ignore_ascii_case(&content_type));
                match plain {
                    Some((_, plain_type, plain_extension)) => {
                        extension = Some(*plain_extension);
                        let mut replacement = BytesStart::new(
                            String::from_utf8_lossy(element.name().as_ref()).into_owned(),
                        );
                        for found in element.attributes() {
                            let found = found.map_err(|_| DisarmError::Malformed)?;
                            if found.key.as_ref() == b"ContentType" {
                                replacement.push_attribute(("ContentType", *plain_type));
                            } else {
                                replacement.push_attribute(found);
                            }
                        }
                        writer
                            .write_event(Event::Empty(replacement))
                            .map_err(|_| DisarmError::Write)?;
                        if matches!(event, Event::Start(_)) {
                            // An Override never has content; swallow its end tag.
                            let mut inner = Vec::new();
                            reader
                                .read_to_end_into(element.name(), &mut inner)
                                .map_err(|_| DisarmError::Malformed)?;
                        }
                    }
                    None => writer
                        .write_event(event.borrow())
                        .map_err(|_| DisarmError::Write)?,
                }
            }
            other => writer.write_event(other).map_err(|_| DisarmError::Write)?,
        }
        buffer.clear();
    }
    Ok((writer.into_inner(), extension))
}

/// The first word of a field instruction, upper-cased.
fn field_keyword(instruction: &str) -> String {
    instruction
        .split(|character: char| character.is_whitespace() || character == '"')
        .find(|word| !word.is_empty())
        .unwrap_or("")
        .to_ascii_uppercase()
}

fn is_dangerous_field(instruction: &str) -> bool {
    let keyword = field_keyword(instruction);
    DANGEROUS_FIELDS.contains(&keyword.as_str())
}

/// Excel's DDE formula form is `application|topic!item`. A pipe outside a quoted string is that
/// form; a pipe inside one is text.
fn is_dde_formula(formula: &str) -> bool {
    let mut quoted = false;
    for character in formula.chars() {
        match character {
            '"' => quoted = !quoted,
            '|' if !quoted => return true,
            _ => {}
        }
    }
    false
}

/// Whether an element references one of the dropped relationships through an `r:`-style id.
fn references_dropped(
    element: &BytesStart<'_>,
    dropped: &BTreeSet<String>,
) -> Result<bool, DisarmError> {
    if dropped.is_empty() {
        return Ok(false);
    }
    for found in element.attributes() {
        let found = found.map_err(|_| DisarmError::Malformed)?;
        let key = found.key.as_ref();
        let is_relationship_reference =
            key.ends_with(b":id") || key.ends_with(b":embed") || key.ends_with(b":link");
        if is_relationship_reference {
            let value = found
                .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                .map_err(|_| DisarmError::Malformed)?;
            if dropped.contains(value.as_ref()) {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// A field being read: its instruction so far, and whether the reader has passed its separator.
struct OpenField {
    instruction: String,
    separated: bool,
}

/// Whether any open field's instruction is still being read, which is when events are held.
fn reading_instruction(fields: &[OpenField]) -> bool {
    fields.iter().any(|field| !field.separated)
}

/// Stream a body part: drop elements that reference dropped relationships; in Word, blank the
/// instruction of a dangerous field (its shown result stays); in a worksheet, drop a DDE formula
/// (its cached value stays). Returns the part and how many fields or formulas were neutralized.
fn rewrite_body(
    bytes: &[u8],
    dropped: &BTreeSet<String>,
    is_word: bool,
    is_sheet: bool,
) -> Result<(Vec<u8>, u32), DisarmError> {
    let mut reader = Reader::from_reader(bytes);
    let mut writer = Writer::new(Vec::with_capacity(bytes.len()));
    let mut buffer = Vec::new();
    let mut neutralized = 0_u32;
    let mut skipping_depth = 0_usize;

    // Complex Word fields span runs, so the events from a field's begin to its separator are held
    // until its instruction is known. Fields nest; `fields` is the stack of open ones.
    let mut held: Vec<Event<'static>> = Vec::new();
    let mut fields: Vec<OpenField> = Vec::new();
    let mut dangerous_in_held = false;
    let mut in_instruction_text = false;

    // A worksheet formula is held until its text is known.
    let mut held_formula: Option<Vec<Event<'static>>> = None;
    let mut formula_text = String::new();

    loop {
        let event = reader
            .read_event_into(&mut buffer)
            .map_err(|_| DisarmError::Malformed)?;
        if matches!(event, Event::Eof) {
            break;
        }
        if skipping_depth > 0 {
            match event {
                Event::Start(_) => skipping_depth = skipping_depth.saturating_add(1),
                Event::End(_) => skipping_depth = skipping_depth.saturating_sub(1),
                _ => {}
            }
            buffer.clear();
            continue;
        }
        let event = event.into_owned();

        if let Event::Start(ref element) | Event::Empty(ref element) = event {
            if references_dropped(element, dropped)? {
                if matches!(event, Event::Start(_)) {
                    skipping_depth = 1;
                }
                buffer.clear();
                continue;
            }
        }

        if is_sheet {
            match &event {
                Event::Start(element)
                    if element.local_name().as_ref() == b"f" && held_formula.is_none() =>
                {
                    held_formula = Some(vec![event.clone()]);
                    formula_text.clear();
                    buffer.clear();
                    continue;
                }
                Event::End(element) if element.local_name().as_ref() == b"f" => {
                    if let Some(mut formula) = held_formula.take() {
                        formula.push(event.clone());
                        if is_dde_formula(&formula_text) {
                            neutralized = neutralized.saturating_add(1);
                        } else {
                            for held_event in formula {
                                emit(&mut writer, &mut held, &fields, held_event)?;
                            }
                        }
                        buffer.clear();
                        continue;
                    }
                }
                Event::Text(text) => {
                    if let Some(formula) = held_formula.as_mut() {
                        formula_text.push_str(&text.decode().map_err(|_| DisarmError::Malformed)?);
                        formula.push(event.clone());
                        buffer.clear();
                        continue;
                    }
                }
                _ => {
                    if let Some(formula) = held_formula.as_mut() {
                        formula.push(event.clone());
                        buffer.clear();
                        continue;
                    }
                }
            }
        }

        if is_word {
            match &event {
                Event::Start(element) | Event::Empty(element)
                    if element.local_name().as_ref() == b"fldSimple" =>
                {
                    let instruction = attribute(element, b"w:instr")?.unwrap_or_default();
                    if is_dangerous_field(&instruction) {
                        neutralized = neutralized.saturating_add(1);
                        let mut replacement = BytesStart::new(
                            String::from_utf8_lossy(element.name().as_ref()).into_owned(),
                        );
                        for found in element.attributes() {
                            let found = found.map_err(|_| DisarmError::Malformed)?;
                            if found.key.as_ref() == b"w:instr" {
                                replacement.push_attribute(("w:instr", ""));
                            } else {
                                replacement.push_attribute(found);
                            }
                        }
                        let rewritten = if matches!(event, Event::Start(_)) {
                            Event::Start(replacement)
                        } else {
                            Event::Empty(replacement)
                        };
                        emit(&mut writer, &mut held, &fields, rewritten.into_owned())?;
                        buffer.clear();
                        continue;
                    }
                }
                Event::Start(element) | Event::Empty(element)
                    if element.local_name().as_ref() == b"fldChar" =>
                {
                    let character_type = attribute(element, b"w:fldCharType")?.unwrap_or_default();
                    match character_type.as_str() {
                        "begin" => {
                            fields.push(OpenField {
                                instruction: String::new(),
                                separated: false,
                            });
                            held.push(event.clone());
                            buffer.clear();
                            continue;
                        }
                        "separate" | "end" => {
                            let ending = character_type == "end";
                            let unread = if ending {
                                fields.pop().filter(|field| !field.separated)
                            } else {
                                fields
                                    .last_mut()
                                    .filter(|field| !field.separated)
                                    .map(|field| {
                                        field.separated = true;
                                        OpenField {
                                            instruction: std::mem::take(&mut field.instruction),
                                            separated: true,
                                        }
                                    })
                            };
                            if let Some(field) = unread {
                                if is_dangerous_field(&field.instruction) {
                                    dangerous_in_held = true;
                                    neutralized = neutralized.saturating_add(1);
                                }
                            }
                            held.push(event.clone());
                            if !reading_instruction(&fields) {
                                flush_held(&mut writer, &mut held, dangerous_in_held)?;
                                dangerous_in_held = false;
                            }
                            buffer.clear();
                            continue;
                        }
                        _ => {}
                    }
                }
                Event::Start(element) if element.local_name().as_ref() == b"instrText" => {
                    in_instruction_text = true;
                }
                Event::End(element) if element.local_name().as_ref() == b"instrText" => {
                    in_instruction_text = false;
                }
                Event::Text(text) if in_instruction_text => {
                    if let Some(field) = fields.iter_mut().rev().find(|field| !field.separated) {
                        field
                            .instruction
                            .push_str(&text.decode().map_err(|_| DisarmError::Malformed)?);
                    }
                }
                _ => {}
            }
        }
        emit(&mut writer, &mut held, &fields, event)?;
        buffer.clear();
    }
    if let Some(formula) = held_formula.take() {
        for held_event in formula {
            emit(&mut writer, &mut held, &fields, held_event)?;
        }
    }
    flush_held(&mut writer, &mut held, dangerous_in_held)?;
    Ok((writer.into_inner(), neutralized))
}

/// Write an event, or hold it while a Word field's instruction is still being read.
fn emit(
    writer: &mut Writer<Vec<u8>>,
    held: &mut Vec<Event<'static>>,
    fields: &[OpenField],
    event: Event<'static>,
) -> Result<(), DisarmError> {
    if !reading_instruction(fields) && held.is_empty() {
        writer.write_event(event).map_err(|_| DisarmError::Write)
    } else {
        held.push(event);
        Ok(())
    }
}

/// Write the held events; when a field among them was dangerous, every instruction text in the
/// span is written empty, so no part of the command survives.
fn flush_held(
    writer: &mut Writer<Vec<u8>>,
    held: &mut Vec<Event<'static>>,
    blank_instructions: bool,
) -> Result<(), DisarmError> {
    let mut in_instruction_text = false;
    for event in held.drain(..) {
        match &event {
            Event::Start(element) if element.local_name().as_ref() == b"instrText" => {
                in_instruction_text = true
            }
            Event::End(element) if element.local_name().as_ref() == b"instrText" => {
                in_instruction_text = false
            }
            Event::Text(_) | Event::GeneralRef(_) | Event::CData(_)
                if in_instruction_text && blank_instructions =>
            {
                writer
                    .write_event(Event::Text(BytesText::new("")))
                    .map_err(|_| DisarmError::Write)?;
                continue;
            }
            _ => {}
        }
        writer.write_event(event).map_err(|_| DisarmError::Write)?;
    }
    Ok(())
}

/// Reopen the written package and confirm nothing that should be gone is still there.
fn verify(output: &[u8], limits: &Limits) -> Result<(), DisarmError> {
    let mut inflated = 0_u64;
    let parts =
        read_parts(output, limits, &mut inflated).map_err(|_| DisarmError::VerificationFailed)?;
    let content_types = parts
        .iter()
        .find(|part| part.name == CONTENT_TYPES)
        .map(|part| ContentTypes::parse(&part.bytes))
        .ok_or(DisarmError::VerificationFailed)?
        .map_err(|_| DisarmError::VerificationFailed)?;
    if content_types
        .overrides
        .values()
        .any(|kind| kind.to_ascii_lowercase().contains("macroenabled.main"))
    {
        return Err(DisarmError::VerificationFailed);
    }
    let empty = BTreeSet::new();
    for part in &parts {
        let lowered = part.name.to_ascii_lowercase();
        if removal_for_part(&part.name, content_types.of(&part.name)).is_some() {
            return Err(DisarmError::VerificationFailed);
        }
        if lowered.ends_with(".rels") {
            if let Some(source) = source_of_relationships(&lowered) {
                let (_, _, blanked) = rewrite_relationships(&part.bytes, &source, &BTreeSet::new())
                    .map_err(|_| DisarmError::VerificationFailed)?;
                if blanked > 0 {
                    return Err(DisarmError::VerificationFailed);
                }
            }
        }
        let is_word = lowered.starts_with("word/") && lowered.ends_with(".xml");
        let is_sheet = lowered.starts_with("xl/worksheets/") && lowered.ends_with(".xml");
        if is_word || is_sheet {
            let (_, neutralized) = rewrite_body(&part.bytes, &empty, is_word, is_sheet)
                .map_err(|_| DisarmError::VerificationFailed)?;
            if neutralized > 0 {
                return Err(DisarmError::VerificationFailed);
            }
        }
    }
    Ok(())
}
