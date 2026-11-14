//! PDF: scripts, automatic actions, actions that reach outside the document, embedded files, dynamic
//! forms and self-playing media come out. Pages, text, pictures, ordinary form fields, bookmarks and
//! web links stay.
//!
//! The pass is pdf-core's guard and attachment scrub first, so a PDF pdf-core refuses as a bomb or a
//! locked file is refused here in the same terms, and then a walk over every object in the file. A
//! dangerous action that is its own object is replaced with null, so every reference to it, from
//! anywhere, now points at nothing; one written inline is removed from the dictionary holding it.

use std::collections::BTreeSet;

use lopdf::{Dictionary, Document, Object, ObjectId};
use pdf_core::{ScrubError, ScrubOptions};

use crate::report::{DisarmReport, RemovalKind};
use crate::{DisarmError, Disarmed, DocumentKind};

/// Nested direct objects deeper than this are refused rather than walked. A real document nests a
/// handful of levels; the ceiling exists so a crafted one cannot spend the stack.
const MAX_DEPTH: usize = 256;

/// Annotation types that run a player of their own.
const ACTIVE_ANNOTATIONS: [&[u8]; 5] = [b"RichMedia", b"Screen", b"Movie", b"Sound", b"3D"];

/// The removal an action dictionary amounts to, or `None` for an action left alone (a jump to a page
/// in this document, a web link).
fn action_removal(dictionary: &Dictionary) -> Option<RemovalKind> {
    let kind = dictionary.get(b"S").and_then(Object::as_name).ok()?;
    match kind {
        b"JavaScript" => Some(RemovalKind::Script),
        b"Launch" | b"SubmitForm" | b"ImportData" | b"GoToR" | b"GoToE" | b"Thread" => {
            Some(RemovalKind::ExternalAction)
        }
        b"RichMediaExecute" | b"Rendition" | b"Movie" | b"Sound" | b"GoTo3DView" => {
            Some(RemovalKind::ActiveContent)
        }
        b"URI" => {
            let target = dictionary.get(b"URI").and_then(Object::as_str).ok();
            match target {
                Some(target) if is_web_address(target) => None,
                _ => Some(RemovalKind::ExternalAction),
            }
        }
        _ => None,
    }
}

/// A link a person can follow in a browser, and nothing else: no `file:`, no network share, no
/// `javascript:`.
fn is_web_address(target: &[u8]) -> bool {
    let lowered: Vec<u8> = target
        .iter()
        .skip_while(|byte| byte.is_ascii_whitespace())
        .take(8)
        .map(u8::to_ascii_lowercase)
        .collect();
    lowered.starts_with(b"https://")
        || lowered.starts_with(b"http://")
        || lowered.starts_with(b"mailto:")
}

fn is_active_annotation(dictionary: &Dictionary) -> bool {
    dictionary
        .get(b"Subtype")
        .and_then(Object::as_name)
        .map(|subtype| ACTIVE_ANNOTATIONS.contains(&subtype))
        .unwrap_or(false)
}

fn dictionary_of(object: &Object) -> Option<&Dictionary> {
    match object {
        Object::Dictionary(dictionary) => Some(dictionary),
        Object::Stream(stream) => Some(&stream.dict),
        _ => None,
    }
}

fn dictionary_of_mut(object: &mut Object) -> Option<&mut Dictionary> {
    match object {
        Object::Dictionary(dictionary) => Some(dictionary),
        Object::Stream(stream) => Some(&mut stream.dict),
        _ => None,
    }
}

/// Map pdf-core's refusal onto this crate's vocabulary.
fn from_scrub(error: ScrubError) -> DisarmError {
    match error {
        ScrubError::Encrypted => DisarmError::Encrypted,
        ScrubError::Rejected => DisarmError::LimitExceeded,
        ScrubError::Parse => DisarmError::Malformed,
        ScrubError::Reassemble => DisarmError::Write,
        ScrubError::GateFailed { .. } => DisarmError::VerificationFailed,
    }
}

fn scrub_options() -> ScrubOptions {
    ScrubOptions {
        metadata: false,
        attachments: true,
        xfa: true,
        form_field_values: false,
        structure_tree: false,
        outlines: false,
        optional_content: false,
    }
}

pub(crate) fn disarm(bytes: &[u8]) -> Result<Disarmed, DisarmError> {
    // pdf-core's sanitize is the gate: its guard refuses a bomb before anything inflates, and its
    // lock check refuses ciphertext. Once it has accepted these bytes they are safe to load here.
    pdf_core::sanitize(bytes.to_vec(), &scrub_options()).map_err(from_scrub)?;
    let mut document = Document::load_mem(bytes).map_err(|_| DisarmError::Malformed)?;

    let mut report = DisarmReport::new();
    count_carried_files(&document, &mut report);
    pdf_core::sanitize_document(&mut document, &scrub_options()).map_err(from_scrub)?;

    let removed = null_dangerous_objects(&mut document, &mut report);
    let identifiers: Vec<ObjectId> = document.objects.keys().copied().collect();
    for identifier in identifiers {
        if let Some(object) = document.objects.get_mut(&identifier) {
            clean(object, &removed, &mut report, 0)?;
        }
    }
    document.prune_objects();

    let mut output = Vec::new();
    document
        .save_to(&mut output)
        .map_err(|_| DisarmError::Write)?;
    verify(&output)?;
    Ok(Disarmed {
        bytes: output,
        kind: DocumentKind::Pdf,
        report,
        output_extension: None,
    })
}

/// Count what pdf-core's scrub is about to take, so the report can say so.
fn count_carried_files(document: &Document, report: &mut DisarmReport) {
    let mut carried = 0_u32;
    for object in document.objects.values() {
        if let Some(dictionary) = dictionary_of(object) {
            if dictionary.has(b"EF") {
                carried = carried.saturating_add(1);
            }
            if let Ok(form) = dictionary.get(b"AcroForm") {
                let has_dynamic_form = match form {
                    Object::Dictionary(form) => form.has(b"XFA"),
                    Object::Reference(identifier) => document
                        .get_object(*identifier)
                        .ok()
                        .and_then(dictionary_of)
                        .map(|form| form.has(b"XFA"))
                        .unwrap_or(false),
                    _ => false,
                };
                if has_dynamic_form {
                    report.add(RemovalKind::DynamicForm, 1);
                }
            }
        }
    }
    report.add(RemovalKind::EmbeddedFile, carried);
}

/// Replace every action and active annotation that is its own object with null, and return their
/// identifiers so references to them can be dropped too.
fn null_dangerous_objects(
    document: &mut Document,
    report: &mut DisarmReport,
) -> BTreeSet<ObjectId> {
    let mut removed = BTreeSet::new();
    for (identifier, object) in &document.objects {
        let Some(dictionary) = dictionary_of(object) else {
            continue;
        };
        if let Some(kind) = action_removal(dictionary) {
            report.add(kind, 1);
            removed.insert(*identifier);
        } else if is_active_annotation(dictionary) {
            report.add(RemovalKind::ActiveContent, 1);
            removed.insert(*identifier);
        }
    }
    for identifier in &removed {
        if let Some(object) = document.objects.get_mut(identifier) {
            *object = Object::Null;
        }
    }
    removed
}

/// Whether a value names something that has to go: a reference to a removed object, or an inline
/// action or active annotation.
fn is_dangerous_value(value: &Object, removed: &BTreeSet<ObjectId>) -> Option<RemovalKind> {
    match value {
        Object::Reference(identifier) if removed.contains(identifier) => {
            Some(RemovalKind::ExternalAction)
        }
        Object::Dictionary(dictionary) => action_removal(dictionary)
            .or_else(|| is_active_annotation(dictionary).then_some(RemovalKind::ActiveContent)),
        _ => None,
    }
}

fn clean(
    object: &mut Object,
    removed: &BTreeSet<ObjectId>,
    report: &mut DisarmReport,
    depth: usize,
) -> Result<(), DisarmError> {
    if depth > MAX_DEPTH {
        return Err(DisarmError::Malformed);
    }
    match object {
        Object::Array(items) => {
            for item in items.iter() {
                // A dropped reference was counted when its object was nulled; an inline one is new.
                if let (Object::Dictionary(_), Some(kind)) =
                    (item, is_dangerous_value(item, removed))
                {
                    report.add(kind, 1);
                }
            }
            items.retain(|item| is_dangerous_value(item, removed).is_none());
            for item in items.iter_mut() {
                clean(item, removed, report, depth.saturating_add(1))?;
            }
        }
        Object::Dictionary(_) | Object::Stream(_) => {
            if let Some(dictionary) = dictionary_of_mut(object) {
                clean_dictionary(dictionary, removed, report, depth)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn clean_dictionary(
    dictionary: &mut Dictionary,
    removed: &BTreeSet<ObjectId>,
    report: &mut DisarmReport,
    depth: usize,
) -> Result<(), DisarmError> {
    // Additional actions fire on their own: opening a page, focusing a field, closing the file.
    // None of them is something a reader asked for, so every one goes.
    if dictionary.remove(b"AA").is_some() {
        report.add(RemovalKind::AutomaticAction, 1);
    }
    // The document-level script table, kept in the name dictionary.
    if dictionary.remove(b"JavaScript").is_some() {
        report.add(RemovalKind::Script, 1);
    }
    // An open action that only jumps to a page stays; one that does anything else goes.
    if let Ok(value) = dictionary.get(b"OpenAction") {
        if let Some(kind) = is_dangerous_value(value, removed) {
            if matches!(value, Object::Dictionary(_)) {
                report.add(kind, 1);
            }
            report.add(RemovalKind::AutomaticAction, 1);
            dictionary.remove(b"OpenAction");
        }
    }
    for key in [b"A".as_slice(), b"Next".as_slice()] {
        if let Ok(value) = dictionary.get(key) {
            if let Some(kind) = is_dangerous_value(value, removed) {
                if matches!(value, Object::Dictionary(_)) {
                    report.add(kind, 1);
                }
                dictionary.remove(key);
            }
        }
    }
    // A form that asks the viewer to rebuild it from its (now removed) dynamic form.
    dictionary.remove(b"NeedsRendering");
    for (_, value) in dictionary.iter_mut() {
        clean(value, removed, report, depth.saturating_add(1))?;
    }
    Ok(())
}

/// Reload the written copy and confirm nothing that should be gone is still there.
fn verify(output: &[u8]) -> Result<(), DisarmError> {
    let document = Document::load_mem(output).map_err(|_| DisarmError::VerificationFailed)?;
    let mut stack: Vec<(&Object, usize)> = document
        .objects
        .values()
        .map(|object| (object, 0))
        .collect();
    while let Some((object, depth)) = stack.pop() {
        if depth > MAX_DEPTH {
            return Err(DisarmError::VerificationFailed);
        }
        if let Object::Array(items) = object {
            stack.extend(items.iter().map(|item| (item, depth.saturating_add(1))));
            continue;
        }
        let Some(dictionary) = dictionary_of(object) else {
            continue;
        };
        let lingering = dictionary.has(b"AA")
            || dictionary.has(b"JavaScript")
            || dictionary.has(b"JS")
            || dictionary.has(b"EF")
            || dictionary.has(b"XFA")
            || dictionary.has_type(b"EmbeddedFile")
            || action_removal(dictionary).is_some()
            || is_active_annotation(dictionary);
        if lingering {
            return Err(DisarmError::VerificationFailed);
        }
        stack.extend(
            dictionary
                .iter()
                .map(|(_, value)| (value, depth.saturating_add(1))),
        );
    }
    Ok(())
}
