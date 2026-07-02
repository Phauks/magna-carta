//! The PDF cross-reference rebuild pillar: scan the raw bytes for the indirect
//! objects still physically present, synthesize a fresh classic xref + trailer,
//! reload through lopdf, and re-emit a clean PDF — recording every object that
//! could not be re-parsed as lost. Diagnose PDF xref corruption.

use std::collections::{BTreeMap, BTreeSet};

use lopdf::Document;

use crate::error::RepairError;
use crate::limits::MAX_ENTRY_COUNT;
use crate::model::{CorruptionKind, LossManifest, Recoverability, RecoveredItem, RepairResult};

/// One indirect-object header (`N G obj`) found by the raw scan, with the byte
/// offset of its first digit (the offset a cross-reference entry must point at).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScannedObject {
    pub number: u32,
    pub generation: u16,
    pub offset: usize,
}

/// Forward-scan `bytes` for every `N G obj` indirect-object header. A header is a
/// run of digits (the object number), PDF whitespace, a run of digits (the
/// generation), PDF whitespace, then the literal `obj`. Anything that does not
/// match is skipped (e.g. the `obj` inside `endobj`, or digits inside content).
/// Stops after `max_count` headers to bound work on pathological input.
pub fn scan_objects(bytes: &[u8], max_count: usize) -> Vec<ScannedObject> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        // A header only starts where a digit follows a delimiter/whitespace or the
        // file start — this avoids re-matching inside a longer digit run.
        let at_boundary =
            i == 0 || is_pdf_whitespace(bytes[i - 1]) || is_pdf_delimiter(bytes[i - 1]);
        if at_boundary && bytes[i].is_ascii_digit() {
            if let Some(parsed) = parse_header_at(bytes, i) {
                out.push(parsed);
                if out.len() >= max_count {
                    break;
                }
                // Continue scanning after the "obj" keyword.
                i = parsed.offset;
                // Advance past the digits we consumed; a simple +1 is enough since
                // the next boundary check re-anchors, but jump past the number to
                // avoid O(n^2) on huge digit runs.
                while i < bytes.len() && bytes[i].is_ascii_digit() {
                    i += 1;
                }
                continue;
            }
        }
        i += 1;
    }
    out
}

/// Try to parse `N G obj` starting at `start` (which must index a digit). Returns
/// the parsed header (with `offset == start`) or None if the shape does not hold.
fn parse_header_at(bytes: &[u8], start: usize) -> Option<ScannedObject> {
    let mut i = start;
    let (number, next) = parse_uint::<u32>(bytes, i)?;
    i = next;
    i = skip_whitespace(bytes, i)?;
    let (generation, next) = parse_uint::<u16>(bytes, i)?;
    i = next;
    i = skip_whitespace(bytes, i)?;
    if bytes.get(i..i + 3) != Some(b"obj") {
        return None;
    }
    // "obj" must end at a delimiter, whitespace, or EOF to be the keyword.
    match bytes.get(i + 3) {
        None => {}
        Some(&b) if is_pdf_whitespace(b) || is_pdf_delimiter(b) => {}
        Some(_) => return None,
    }
    Some(ScannedObject {
        number,
        generation,
        offset: start,
    })
}

/// Parse an unsigned integer, returning (value, index-after-digits). Fails on no
/// digits or on overflow of the target type.
fn parse_uint<T: TryFrom<u64>>(bytes: &[u8], start: usize) -> Option<(T, usize)> {
    let mut i = start;
    let mut value: u64 = 0;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        value = value
            .checked_mul(10)?
            .checked_add((bytes[i] - b'0') as u64)?;
        i += 1;
    }
    if i == start {
        return None;
    }
    T::try_from(value).ok().map(|v| (v, i))
}

/// Advance over at least one PDF whitespace byte; None if there is not one.
fn skip_whitespace(bytes: &[u8], start: usize) -> Option<usize> {
    let mut i = start;
    while i < bytes.len() && is_pdf_whitespace(bytes[i]) {
        i += 1;
    }
    if i == start {
        None
    } else {
        Some(i)
    }
}

/// PDF whitespace: null, tab, line feed, form feed, carriage return, space.
fn is_pdf_whitespace(b: u8) -> bool {
    matches!(b, 0x00 | 0x09 | 0x0A | 0x0C | 0x0D | 0x20)
}

/// PDF delimiter characters.
fn is_pdf_delimiter(b: u8) -> bool {
    matches!(
        b,
        b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%'
    )
}

/// Locate the document catalog: the first scanned object that declares
/// `/Type /Catalog`. The object's byte span runs from its header offset to the
/// next object's offset (or end of file). Requiring `/Type` to be *followed by*
/// `/Catalog` (not two independent substring hits) avoids mistaking an object
/// that merely mentions `/Catalog` elsewhere — e.g. a `/Type /Page` carrying an
/// unrelated `/Catalog` reference — for the document catalog.
pub fn find_root(bytes: &[u8], scanned: &[ScannedObject]) -> Option<(u32, u16)> {
    for (index, object) in scanned.iter().enumerate() {
        let end = scanned
            .get(index + 1)
            .map(|next| next.offset)
            .unwrap_or(bytes.len());
        let body = &bytes[object.offset..end];
        if declares_catalog(body) {
            return Some((object.number, object.generation));
        }
    }
    None
}

/// True if `body` declares `/Type /Catalog` — a `/Type` key whose value is the
/// `/Catalog` name (PDF whitespace allowed between them, and `/Catalog` must end
/// at a name boundary so `/CatalogFoo` does not match).
fn declares_catalog(body: &[u8]) -> bool {
    let mut from = 0;
    while let Some(at) = find_from(body, b"/Type", from) {
        let mut i = at + 5;
        while i < body.len() && is_pdf_whitespace(body[i]) {
            i += 1;
        }
        if body.get(i..i + 8) == Some(b"/Catalog") {
            let boundary = match body.get(i + 8) {
                None => true,
                Some(&b) => is_pdf_whitespace(b) || is_pdf_delimiter(b),
            };
            if boundary {
                return true;
            }
        }
        from = at + 5;
    }
    false
}

/// Index of the first occurrence of `needle` in `haystack` at or after `start`.
fn find_from(haystack: &[u8], needle: &[u8], start: usize) -> Option<usize> {
    if needle.is_empty() || start >= haystack.len() || haystack.len() - start < needle.len() {
        return None;
    }
    haystack[start..]
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|position| start + position)
}

/// True if `haystack` contains `needle` (small, non-allocating substring search).
fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() || haystack.len() < needle.len() {
        return needle.is_empty();
    }
    haystack.windows(needle.len()).any(|w| w == needle)
}

/// Append a fresh classic cross-reference table + trailer + `startxref` to a copy
/// of `bytes`, indexing every scanned object at its original offset. The original
/// object bytes are untouched (so their offsets stay valid); lopdf reads the last
/// `startxref` (this one) and loads through it. Object 0 is the mandatory free
/// head; object number 0 is never a real object and is ignored if scanned. When an
/// object number appears more than once, the physically-latest offset wins.
pub fn rebuild_with_xref(bytes: &[u8], scanned: &[ScannedObject], root: (u32, u16)) -> Vec<u8> {
    // number -> (generation, offset); insertion order is file order, so a later
    // duplicate overwrites an earlier one (latest revision wins).
    let mut by_number: BTreeMap<u32, (u16, usize)> = BTreeMap::new();
    for object in scanned {
        if object.number == 0 {
            continue;
        }
        by_number.insert(object.number, (object.generation, object.offset));
    }

    let size = by_number.keys().copied().max().map(|n| n + 1).unwrap_or(1);

    let mut out = bytes.to_vec();
    // The xref keyword must begin its own line.
    if !out.is_empty() && *out.last().unwrap() != b'\n' {
        out.push(b'\n');
    }
    let xref_offset = out.len();

    out.extend_from_slice(b"xref\n");
    // Free-list head: object 0.
    out.extend_from_slice(b"0 1\n");
    out.extend_from_slice(b"0000000000 65535 f \n");

    // Group present object numbers into contiguous runs (xref subsections). Each
    // in-use entry is exactly 20 bytes: 10-digit offset, gen, type, 2-byte EOL.
    let numbers: Vec<u32> = by_number.keys().copied().collect();
    let mut i = 0;
    while i < numbers.len() {
        let mut j = i;
        while j + 1 < numbers.len() && numbers[j + 1] == numbers[j] + 1 {
            j += 1;
        }
        let start = numbers[i];
        let count = (j - i + 1) as u32;
        out.extend_from_slice(format!("{start} {count}\n").as_bytes());
        for number in &numbers[i..=j] {
            let (generation, offset) = by_number[number];
            out.extend_from_slice(format!("{offset:010} {generation:05} n \n").as_bytes());
        }
        i = j + 1;
    }

    out.extend_from_slice(b"trailer\n");
    out.extend_from_slice(format!("<< /Size {size} /Root {} {} R >>\n", root.0, root.1).as_bytes());
    out.extend_from_slice(b"startxref\n");
    out.extend_from_slice(format!("{xref_offset}\n").as_bytes());
    out.extend_from_slice(b"%%EOF\n");
    out
}

/// Repair a PDF whose cross-reference table is broken: scan the objects still in
/// the file, synthesize a fresh xref, reload through lopdf, and re-emit a clean
/// PDF — recording every object lopdf could not re-parse as lost, so a silent
/// drop never becomes a silent overclaim. Errors (rather than emitting a hollow
/// file) when no real objects or no catalog can be found, or the rebuild will not
/// load.
///
/// This assumes a *broken* cross-reference table: callers gate on [`diagnose_pdf`]
/// (which reports `Intact` for a file that already loads). Recovery is by object
/// NUMBER via re-parse and re-index — `recovered` means an object of that number
/// re-parsed and was re-emitted, not that its original bytes are byte-identical.
/// The rebuilt cross-reference table and trailer (and the heuristically-located
/// catalog) are disclosed in the loss manifest's `synthesized` list.
pub fn repair_pdf(bytes: &[u8]) -> Result<RepairResult, RepairError> {
    let scanned = scan_objects(bytes, MAX_ENTRY_COUNT);
    // Object number 0 is the reserved free-list head, never a real object. Require
    // at least one real object to recover — otherwise there is nothing to salvage
    // and re-emitting a header-only file would falsely read as a full recovery.
    if scanned.iter().all(|object| object.number == 0) {
        return Err(RepairError::Unrepairable);
    }
    let root = find_root(bytes, &scanned).ok_or(RepairError::Unrepairable)?;
    let patched = rebuild_with_xref(bytes, &scanned, root);
    let mut document = Document::load_mem(&patched).map_err(|_| RepairError::Unrepairable)?;

    let mut salvaged = Vec::new();
    document
        .save_to(&mut salvaged)
        .map_err(|_| RepairError::Unrepairable)?;

    // Honest loss: which scanned object numbers did lopdf actually load? A number
    // the raw scan found but the loaded document lacks was silently dropped by
    // lopdf's parser and must be reported.
    let loaded: BTreeSet<u32> = document.objects.keys().map(|(number, _)| *number).collect();
    let scanned_numbers: BTreeSet<u32> = scanned
        .iter()
        .map(|o| o.number)
        .filter(|n| *n != 0)
        .collect();

    let mut items: Vec<RecoveredItem> = scanned_numbers
        .iter()
        .map(|number| {
            let recovered = loaded.contains(number);
            RecoveredItem {
                name: format!("object {number}"),
                recovered,
                detail: if recovered {
                    String::new()
                } else {
                    "object could not be parsed and was dropped".to_string()
                },
            }
        })
        .collect();

    // Objects packed inside a compressed object stream are invisible to the raw
    // `N G obj` scan; when the original xref is unusable they cannot be recovered
    // by this rebuild. Disclose the possibility rather than imply a complete
    // accounting — a coverage gap, not a fabrication.
    if contains(bytes, b"/ObjStm") {
        items.push(RecoveredItem {
            name: "(compressed object streams)".to_string(),
            recovered: false,
            detail: "this file uses compressed object streams; objects packed inside them are not recovered by cross-reference rebuild".to_string(),
        });
    }

    // Disclose the reconstructed index: the cross-reference table and trailer are
    // rebuilt from the scanned offsets and the catalog is located heuristically,
    // so the re-emitted file's structure is recovered, not the original bytes. This
    // is surfaced to the owner, not implied away.
    let synthesized = vec![
        "cross-reference table and trailer (rebuilt from recovered object offsets; document catalog located heuristically)".to_string(),
    ];

    // An empty item list would make `all` vacuously true; the guard above ensures
    // at least one real object, but keep the check explicit against future edits.
    let fully_recovered = !items.is_empty() && items.iter().all(|i| i.recovered);
    Ok(RepairResult {
        salvaged,
        loss: LossManifest {
            items,
            fully_recovered,
            synthesized,
        },
    })
}

/// Classify a PDF's cross-reference health. Loads as-is → intact; original will
/// not load but a rebuilt xref loads every scanned object → repairable; the
/// rebuild loads but is missing some scanned objects → partial; no catalog or a
/// rebuild that still will not load → unrecoverable by this pillar.
///
/// The "loads as-is → intact" fast path deliberately does not second-guess a file
/// lopdf already accepts (an xref-stream file's own xref object would otherwise
/// skew an object-count check); the repair manifest remains the authoritative
/// per-object accounting. The repairable-vs-partial split uses a scanned ⊆ loaded
/// object-number SET check (not a length compare) so it agrees with the manifest.
pub fn diagnose_pdf(bytes: &[u8]) -> (Vec<CorruptionKind>, Recoverability) {
    let scanned = scan_objects(bytes, MAX_ENTRY_COUNT);
    if scanned.is_empty() {
        return (vec![CorruptionKind::Other], Recoverability::Unrecoverable);
    }

    // Loads as-is → nothing to repair.
    if Document::load_mem(bytes).is_ok() {
        return (Vec::new(), Recoverability::Intact);
    }

    let root = match find_root(bytes, &scanned) {
        Some(root) => root,
        None => {
            return (
                vec![CorruptionKind::MissingRequiredParts],
                Recoverability::Unrecoverable,
            )
        }
    };
    let patched = rebuild_with_xref(bytes, &scanned, root);
    match Document::load_mem(&patched) {
        Ok(document) => {
            let scanned_numbers: BTreeSet<u32> = scanned
                .iter()
                .map(|o| o.number)
                .filter(|n| *n != 0)
                .collect();
            let loaded: BTreeSet<u32> =
                document.objects.keys().map(|(number, _)| *number).collect();
            if scanned_numbers.iter().all(|number| loaded.contains(number)) {
                (
                    vec![CorruptionKind::BrokenCrossReference],
                    Recoverability::Repairable,
                )
            } else {
                (
                    vec![CorruptionKind::BrokenCrossReference],
                    Recoverability::Partial,
                )
            }
        }
        Err(_) => (
            vec![CorruptionKind::BrokenCrossReference],
            Recoverability::Unrecoverable,
        ),
    }
}

#[cfg(test)]
mod scan_tests {
    use super::*;

    #[test]
    fn finds_each_indirect_object_header() {
        let bytes = b"%PDF-1.5\n1 0 obj\n<< /Type /Catalog >>\nendobj\n12 3 obj\n(hi)\nendobj\n";
        let found = scan_objects(bytes, 1000);
        assert_eq!(found.len(), 2);
        assert_eq!((found[0].number, found[0].generation), (1, 0));
        assert_eq!((found[1].number, found[1].generation), (12, 3));
        // The recorded offset points at the header's first digit.
        assert_eq!(&bytes[found[0].offset..found[0].offset + 5], b"1 0 o");
    }

    #[test]
    fn ignores_the_word_obj_that_is_not_a_header() {
        // "endobj" contains "obj" but is not preceded by "<uint> <uint> ".
        let bytes = b"1 0 obj\n<< >>\nendobj\n";
        let found = scan_objects(bytes, 1000);
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn respects_the_count_cap() {
        let bytes = b"1 0 obj\nendobj\n2 0 obj\nendobj\n3 0 obj\nendobj\n";
        assert_eq!(scan_objects(bytes, 2).len(), 2);
    }
}

#[cfg(test)]
mod root_tests {
    use super::*;

    #[test]
    fn locates_the_catalog_object() {
        let bytes = b"1 0 obj\n<< /Type /Pages /Count 0 >>\nendobj\n2 0 obj\n<< /Type /Catalog /Pages 1 0 R >>\nendobj\n";
        let scanned = scan_objects(bytes, 1000);
        assert_eq!(find_root(bytes, &scanned), Some((2, 0)));
    }

    #[test]
    fn returns_none_when_no_catalog_is_present() {
        let bytes = b"1 0 obj\n<< /Type /Pages >>\nendobj\n";
        let scanned = scan_objects(bytes, 1000);
        assert_eq!(find_root(bytes, &scanned), None);
    }
}

#[cfg(test)]
mod xref_tests {
    use super::*;

    #[test]
    fn appended_xref_makes_a_headerless_body_loadable() {
        // A PDF body with objects but NO xref/trailer (as if truncated before them).
        let body = b"%PDF-1.5\n\
1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\
2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n\
3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n";
        let scanned = scan_objects(body, 1000);
        let root = find_root(body, &scanned).expect("catalog present");
        let patched = rebuild_with_xref(body, &scanned, root);
        let doc = Document::load_mem(&patched).expect("loads via the synthesized xref");
        // All three objects are present and the catalog is the trailer Root.
        assert!(doc.objects.contains_key(&(1, 0)));
        assert!(doc.objects.contains_key(&(2, 0)));
        assert!(doc.objects.contains_key(&(3, 0)));
    }
}

#[cfg(test)]
mod repair_tests {
    use super::*;

    /// A PDF body (objects present) with NO trailing xref/trailer.
    fn headerless_pdf() -> Vec<u8> {
        b"%PDF-1.5\n\
1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\
2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n\
3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n"
            .to_vec()
    }

    #[test]
    fn repairs_a_broken_xref_and_reopens() {
        let result = repair_pdf(&headerless_pdf()).expect("repairable");
        // The re-emitted file is a valid PDF that lopdf reloads cleanly.
        let reopened = Document::load_mem(&result.salvaged).expect("valid pdf");
        assert!(reopened.objects.contains_key(&(1, 0)));
        assert!(result.loss.fully_recovered);
        assert_eq!(result.loss.items.iter().filter(|i| i.recovered).count(), 3);
        // The rebuilt cross-reference structure is disclosed, not implied away —
        // "fully recovered" here means every object was re-indexed, and the index
        // itself is reconstructed.
        assert!(
            result
                .loss
                .synthesized
                .iter()
                .any(|note| note.contains("cross-reference")),
            "the rebuilt xref/trailer must be disclosed in synthesized"
        );
    }

    #[test]
    fn a_file_whose_only_object_is_number_zero_is_unrepairable() {
        // Object 0 is the reserved free-list head, never a real object. A file that
        // scans to only object 0 must error, not emit a header-only file that reads
        // as a full recovery.
        let bytes = b"%PDF-1.5\n0 0 obj\n<< /Type /Catalog >>\nendobj\n";
        assert!(repair_pdf(bytes).is_err());
    }

    #[test]
    fn an_object_mentioning_catalog_without_being_one_is_not_chosen_as_root() {
        // The first object is /Type /Page but also carries a stray "/Catalog" token;
        // the real catalog is object 2. find_root must pick object 2, not object 1.
        let bytes = b"1 0 obj\n<< /Type /Page /Note (/Catalog) >>\nendobj\n\
2 0 obj\n<< /Type /Catalog /Pages 3 0 R >>\nendobj\n";
        let scanned = scan_objects(bytes, 1000);
        assert_eq!(find_root(bytes, &scanned), Some((2, 0)));
    }

    #[test]
    fn a_corrupt_object_is_reported_lost_not_dropped_silently() {
        // Object 4 has a malformed body lopdf cannot parse; it must be reported
        // lost, and the file must not claim full recovery.
        let mut bytes = headerless_pdf();
        bytes.extend_from_slice(b"4 0 obj\n<< /Broken << << /a >> endobj\n");
        let result = repair_pdf(&bytes).expect("repairable");
        let four = result
            .loss
            .items
            .iter()
            .find(|i| i.name.contains('4'))
            .expect("object 4 accounted for");
        assert!(!four.recovered);
        assert!(!result.loss.fully_recovered);
    }

    #[test]
    fn input_without_objects_is_unrepairable() {
        assert!(repair_pdf(b"%PDF-1.5\nno objects here\n").is_err());
    }
}

#[cfg(test)]
mod diagnose_tests {
    use super::*;
    use crate::model::Recoverability;
    use lopdf::Document;

    /// A well-formed PDF (valid xref) built by lopdf.
    fn valid_pdf() -> Vec<u8> {
        // Reuse the repair-test body then repair it once to get a clean file with
        // a real xref, so "loads as-is" is exercised.
        let body = b"%PDF-1.5\n\
1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\
2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n\
3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n";
        let scanned = scan_objects(body, 1000);
        let root = find_root(body, &scanned).unwrap();
        let patched = rebuild_with_xref(body, &scanned, root);
        let mut doc = Document::load_mem(&patched).unwrap();
        let mut clean = Vec::new();
        doc.save_to(&mut clean).unwrap();
        clean
    }

    #[test]
    fn a_valid_pdf_is_intact() {
        let (corruption, recoverability) = diagnose_pdf(&valid_pdf());
        assert_eq!(recoverability, Recoverability::Intact);
        assert!(corruption.is_empty());
    }

    #[test]
    fn a_broken_xref_with_objects_is_repairable() {
        let body = b"%PDF-1.5\n\
1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\
2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n\
3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n";
        let (corruption, recoverability) = diagnose_pdf(body);
        assert_eq!(recoverability, Recoverability::Repairable);
        assert_eq!(corruption, vec![CorruptionKind::BrokenCrossReference]);
    }

    #[test]
    fn input_without_objects_is_unrecoverable() {
        let (_c, recoverability) = diagnose_pdf(b"%PDF-1.5\nnothing here\n");
        assert_eq!(recoverability, Recoverability::Unrecoverable);
    }
}
