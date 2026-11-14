//! RTF: embedded objects come out (the route most RTF exploits take, through an OLE object's data),
//! and so do DDE and include fields. What the reader saw stays: an object is replaced by the picture
//! it was showing (its `\result`), and a field by the text it last displayed (its `\fldrslt`).
//!
//! The scanner copies the input token by token and only ever drops or unwraps whole groups, so a
//! document it does not change comes out byte for byte the same.

use crate::limits::Limits;
use crate::report::{DisarmReport, RemovalKind};
use crate::{DisarmError, Disarmed, DocumentKind};

/// Groups dropped outright: an object's class and data on their own, and the data store some
/// exploits use to carry an OLE payload.
const DROPPED_GROUPS: [&[u8]; 5] = [
    b"objdata",
    b"objclass",
    b"datastore",
    b"objalias",
    b"objsect",
];

const DANGEROUS_FIELDS: [&str; 6] = [
    "DDE",
    "DDEAUTO",
    "INCLUDETEXT",
    "INCLUDEPICTURE",
    "LINK",
    "IMPORT",
];

pub(crate) fn is_rtf(bytes: &[u8]) -> bool {
    bytes.starts_with(b"{\\rtf")
}

pub(crate) fn disarm(bytes: &[u8], limits: &Limits) -> Result<Disarmed, DisarmError> {
    let end = group_end(bytes, 0, limits)?;
    let mut output = Vec::with_capacity(bytes.len());
    let mut report = DisarmReport::new();
    process_group(bytes, 0, end, &mut output, &mut report, limits, 0)?;
    // Anything after the document's closing brace is not part of the document.
    let mut check = DisarmReport::new();
    let mut discard = Vec::new();
    let output_end = group_end(&output, 0, limits).map_err(|_| DisarmError::VerificationFailed)?;
    process_group(&output, 0, output_end, &mut discard, &mut check, limits, 0)
        .map_err(|_| DisarmError::VerificationFailed)?;
    if !check.is_empty() {
        return Err(DisarmError::VerificationFailed);
    }
    Ok(Disarmed {
        bytes: output,
        kind: DocumentKind::Rtf,
        report,
        output_extension: None,
    })
}

/// The position just after the token starting at `position`. A control word's parameter and its
/// single delimiting space belong to it; `\bin N` also owns the N raw bytes after it.
fn token_end(bytes: &[u8], position: usize) -> Result<usize, DisarmError> {
    let Some(&first) = bytes.get(position) else {
        return Err(DisarmError::Malformed);
    };
    if first != b'\\' {
        return Ok(position.saturating_add(1));
    }
    let start = position.saturating_add(1);
    let Some(&next) = bytes.get(start) else {
        return Err(DisarmError::Malformed);
    };
    if !next.is_ascii_alphabetic() {
        // A control symbol; `\'hh` carries two hex digits.
        return Ok(if next == b'\'' {
            start.saturating_add(3).min(bytes.len())
        } else {
            start.saturating_add(1)
        });
    }
    let mut cursor = start;
    while bytes.get(cursor).is_some_and(u8::is_ascii_alphabetic) {
        cursor = cursor.saturating_add(1);
    }
    let name = bytes.get(start..cursor).unwrap_or_default();
    let parameter_start = cursor;
    if bytes.get(cursor) == Some(&b'-') {
        cursor = cursor.saturating_add(1);
    }
    while bytes.get(cursor).is_some_and(u8::is_ascii_digit) {
        cursor = cursor.saturating_add(1);
    }
    let parameter = std::str::from_utf8(bytes.get(parameter_start..cursor).unwrap_or_default())
        .ok()
        .and_then(|digits| digits.parse::<i64>().ok());
    if bytes.get(cursor) == Some(&b' ') {
        cursor = cursor.saturating_add(1);
    }
    if name == b"bin" {
        let length = usize::try_from(parameter.unwrap_or(0)).map_err(|_| DisarmError::Malformed)?;
        cursor = cursor.checked_add(length).ok_or(DisarmError::Malformed)?;
        if cursor > bytes.len() {
            return Err(DisarmError::Malformed);
        }
    }
    Ok(cursor)
}

/// The position just after the brace closing the group that opens at `start`.
fn group_end(bytes: &[u8], start: usize, limits: &Limits) -> Result<usize, DisarmError> {
    if bytes.get(start) != Some(&b'{') {
        return Err(DisarmError::Malformed);
    }
    let mut depth = 0_usize;
    let mut position = start;
    while position < bytes.len() {
        match bytes.get(position) {
            Some(b'{') => {
                depth = depth.saturating_add(1);
                if depth > limits.max_rtf_depth {
                    return Err(DisarmError::LimitExceeded);
                }
                position = position.saturating_add(1);
            }
            Some(b'}') => {
                depth = depth.saturating_sub(1);
                position = position.saturating_add(1);
                if depth == 0 {
                    return Ok(position);
                }
            }
            _ => position = token_end(bytes, position)?,
        }
    }
    Err(DisarmError::Malformed)
}

/// The control word a group opens with, skipping the `\*` marker of an ignorable destination.
fn leading_word(bytes: &[u8], start: usize, end: usize) -> &[u8] {
    let mut position = start.saturating_add(1);
    loop {
        while bytes
            .get(position)
            .is_some_and(|byte| matches!(byte, b' ' | b'\r' | b'\n'))
        {
            position = position.saturating_add(1);
        }
        if bytes.get(position..position.saturating_add(2)) == Some(b"\\*".as_slice()) {
            position = position.saturating_add(2);
            continue;
        }
        break;
    }
    if bytes.get(position) != Some(&b'\\') {
        return &[];
    }
    let name_start = position.saturating_add(1);
    let mut cursor = name_start;
    while cursor < end && bytes.get(cursor).is_some_and(u8::is_ascii_alphabetic) {
        cursor = cursor.saturating_add(1);
    }
    bytes.get(name_start..cursor).unwrap_or_default()
}

/// The direct child groups of the group spanning `start..end`, as spans.
fn child_groups(
    bytes: &[u8],
    start: usize,
    end: usize,
    limits: &Limits,
) -> Result<Vec<(usize, usize)>, DisarmError> {
    let mut children = Vec::new();
    let mut position = start.saturating_add(1);
    let inner_end = end.saturating_sub(1);
    while position < inner_end {
        match bytes.get(position) {
            Some(b'{') => {
                let child_end = group_end(bytes, position, limits)?;
                children.push((position, child_end));
                position = child_end;
            }
            _ => position = token_end(bytes, position)?,
        }
    }
    Ok(children)
}

/// The visible text of a group: everything that is not a control word or a brace.
fn plain_text(bytes: &[u8], start: usize, end: usize) -> Result<String, DisarmError> {
    let mut text = String::new();
    let mut position = start;
    while position < end {
        let next = token_end(bytes, position)?;
        if let Some(&byte) = bytes.get(position) {
            if byte != b'\\' && byte != b'{' && byte != b'}' && byte != b'\r' && byte != b'\n' {
                text.push(char::from(byte));
            }
        }
        position = next;
    }
    Ok(text)
}

fn is_dangerous_instruction(instruction: &str) -> bool {
    let keyword = instruction
        .split(|character: char| character.is_whitespace() || character == '"')
        .find(|word| !word.is_empty())
        .unwrap_or("")
        .to_ascii_uppercase();
    DANGEROUS_FIELDS.contains(&keyword.as_str())
}

#[allow(clippy::too_many_arguments)]
fn process_group(
    bytes: &[u8],
    start: usize,
    end: usize,
    output: &mut Vec<u8>,
    report: &mut DisarmReport,
    limits: &Limits,
    depth: usize,
) -> Result<(), DisarmError> {
    if depth > limits.max_rtf_depth {
        return Err(DisarmError::LimitExceeded);
    }
    let word = leading_word(bytes, start, end);

    if word == b"object" {
        report.add(RemovalKind::EmbeddedObject, 1);
        for (child_start, child_end) in child_groups(bytes, start, end, limits)? {
            if leading_word(bytes, child_start, child_end) == b"result" {
                process_group(
                    bytes,
                    child_start,
                    child_end,
                    output,
                    report,
                    limits,
                    depth.saturating_add(1),
                )?;
            }
        }
        return Ok(());
    }
    if DROPPED_GROUPS.contains(&word) {
        report.add(RemovalKind::EmbeddedObject, 1);
        return Ok(());
    }
    if word == b"field" {
        let children = child_groups(bytes, start, end, limits)?;
        let instruction = children.iter().find(|(child_start, child_end)| {
            leading_word(bytes, *child_start, *child_end) == b"fldinst"
        });
        if let Some((instruction_start, instruction_end)) = instruction {
            let text = plain_text(bytes, *instruction_start, *instruction_end)?;
            if is_dangerous_instruction(&text) {
                report.add(RemovalKind::DynamicField, 1);
                for (child_start, child_end) in children {
                    if leading_word(bytes, child_start, child_end) == b"fldrslt" {
                        process_group(
                            bytes,
                            child_start,
                            child_end,
                            output,
                            report,
                            limits,
                            depth.saturating_add(1),
                        )?;
                    }
                }
                return Ok(());
            }
        }
    }

    // An ordinary group: copy it, descending into its child groups.
    output.push(b'{');
    let mut position = start.saturating_add(1);
    let inner_end = end.saturating_sub(1);
    while position < inner_end {
        match bytes.get(position) {
            Some(b'{') => {
                let child_end = group_end(bytes, position, limits)?;
                process_group(
                    bytes,
                    position,
                    child_end,
                    output,
                    report,
                    limits,
                    depth.saturating_add(1),
                )?;
                position = child_end;
            }
            _ => {
                let next = token_end(bytes, position)?;
                output.extend_from_slice(bytes.get(position..next).ok_or(DisarmError::Malformed)?);
                position = next;
            }
        }
    }
    output.push(b'}');
    Ok(())
}
