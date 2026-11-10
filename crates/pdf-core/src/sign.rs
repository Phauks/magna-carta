// PAdES seal preparation — the incremental-update signing primitive.
//
// A PAdES signature is a detached CMS/PKCS#7 blob over a `/ByteRange` of the file, held
// in the `/Contents` of a signature dictionary that an incremental update appends to the
// document. Two properties are load-bearing and drive every choice below:
//
//   1. The original document bytes MUST survive verbatim as a literal prefix of the
//      output. A signature attests to the exact bytes the signer saw; re-serializing the
//      file (renumbering objects, rewriting offsets) would break every earlier signature
//      and defeat the "the signer saw THIS file" claim. So this module never round-trips
//      through lopdf's writer (`Document::save_to`, which the Bates/searchable append
//      paths use) — it copies the input untouched and APPENDS a hand-built incremental
//      update. This is the primitive the additive-overlay writers deliberately do not
//      provide.
//
//   2. The signature covers everything except its own `/Contents` value. The file is laid
//      out as `<signed prefix> <Contents hex gap> <signed suffix>`; the `/ByteRange` names
//      the two signed spans, and the CMS is spliced into the gap afterward without
//      disturbing a single signed byte. Because the range excludes only the gap, embedding
//      the signature cannot invalidate the digest it signs.
//
// Scope of this primitive: the incremental-update writer, the signature-dictionary /
// AcroForm / widget structure, the exact `/ByteRange`, the reserved `/Contents`
// placeholder, and the splice. The cryptography (building the CMS, holding the platform
// certificate) is the caller's — host-side by design, so a private key never enters this
// engine. The appended update always carries a CLASSIC cross-reference table, whatever the
// base file uses: it chains through `/Prev` to the previous section, and a reader follows
// that link onto a classic table or a cross-reference STREAM alike. So a modern (PDF 1.5+,
// xref-stream) document signs without being rewritten. The one structural prerequisite is a
// trailing `startxref` to chain from — a file without one is refused as `SignError::Parse`
// rather than appended to at a guessed offset.

use lopdf::{Dictionary, Document, Object, ObjectId, StringFormat};

use crate::guard::{guard_input, GuardLimits};

/// What preparing or embedding a signature can fail at. No logging here — the caller owns
/// that, as with every other engine operation.
#[derive(Debug, PartialEq, Eq)]
pub enum SignError {
    /// The input is not a PDF lopdf can parse.
    Parse,
    /// The input was rejected by the decompression-bomb guard (oversize or a bomb).
    Rejected,
    /// The document has no pages to attach a signature widget to.
    NoPages,
    /// The trailer has no resolvable `/Root`, or it does not point at a catalog dictionary.
    MissingCatalog,
    /// The document is structurally not signable: a page, or a referenced form/annotation
    /// object the update must extend, does not resolve to the type it must be. Distinct from
    /// [`SignError::Parse`] (lopdf did parse the file) — the graph is internally inconsistent,
    /// so signing is refused rather than silently dropping the unresolved structure.
    Malformed,
    /// The CMS blob handed to [`embed_signature`] does not fit the reserved `/Contents`
    /// capacity. Re-prepare with a larger `contents_capacity`.
    CapacityExceeded,
    /// The `/ByteRange` or `/Contents` span handed to [`signed_bytes`] or [`embed_signature`]
    /// does not lie inside the document: it runs backwards or past the end.
    InvalidRange,
}

/// Options for the appended signature dictionary. Every text field is optional; the ones
/// that are set are written as PDF literal strings. Times are PDF date strings
/// (`D:YYYYMMDDHHmmSS`) — the caller supplies them so this stays free of a clock (the WASM
/// build has none, and determinism matters for the tests and the fixtures harness).
#[derive(Debug, Clone, Default)]
pub struct SignatureOptions {
    /// `/Name` — the seal/signer name shown by viewers.
    pub name: Option<String>,
    /// `/Reason` — why the document is signed.
    pub reason: Option<String>,
    /// `/Location` — where it was signed.
    pub location: Option<String>,
    /// `/ContactInfo`.
    pub contact_info: Option<String>,
    /// `/M` — the signing time, a PDF date string. The CMS carries its own signing time;
    /// this is the document-dictionary echo viewers display.
    pub signing_time: Option<String>,
    /// How many bytes the CMS signature may occupy. The reserved `/Contents` hex string is
    /// twice this many characters. A CMS for an RSA-2048 / ECDSA-P256 seal with a modest
    /// certificate chain fits comfortably in a few KiB; the default is generous.
    pub contents_capacity: usize,
}

impl SignatureOptions {
    /// A default reservation for the `/Contents` blob. 16 KiB of CMS clears a platform seal
    /// with a full chain and a timestamp token with room to spare; the cost is 32 KiB of
    /// zero hex in the file until the real signature overwrites it.
    pub const DEFAULT_CONTENTS_CAPACITY: usize = 16 * 1024;
}

/// A document made ready for signing: the full incremental-updated PDF (with a zero-filled
/// `/Contents`), the exact `/ByteRange` written into it, and where the gap sits.
#[derive(Debug, Clone)]
pub struct PreparedSignature {
    /// The complete output PDF. The input is its literal prefix; a signature dictionary,
    /// widget, and AcroForm have been appended as one incremental update. `/Contents` is a
    /// reserved run of `0` bytes awaiting [`embed_signature`].
    pub document: Vec<u8>,
    /// The four-element `/ByteRange` as written in the file: `[0, gap_start, gap_end,
    /// suffix_len]`. The signed bytes are `document[0..gap_start]` followed by
    /// `document[gap_end..]`.
    pub byte_range: [usize; 4],
    /// The byte offsets of the reserved hex digits — the half-open span strictly between the
    /// `<` and `>` of `/Contents`. This is exactly the region [`embed_signature`] overwrites.
    pub contents_span: (usize, usize),
}

/// The bytes a signer must digest and sign: everything the `/ByteRange` covers, i.e. the
/// file with its `/Contents` gap (and the enclosing angle brackets) cut out. Concatenated,
/// never the raw file.
///
/// The range arrives from the host as plain numbers, so it is checked against the document
/// before anything is sliced: a range that runs backwards or past the end is
/// [`SignError::InvalidRange`], never an out-of-bounds abort.
pub fn signed_bytes(prepared: &PreparedSignature) -> Result<Vec<u8>, SignError> {
    let [_, gap_start, gap_end, suffix_len] = prepared.byte_range;
    let suffix_end = gap_end
        .checked_add(suffix_len)
        .ok_or(SignError::InvalidRange)?;
    let prefix = prepared
        .document
        .get(..gap_start)
        .ok_or(SignError::InvalidRange)?;
    let suffix = prepared
        .document
        .get(gap_end..suffix_end)
        .ok_or(SignError::InvalidRange)?;
    if gap_end < gap_start {
        return Err(SignError::InvalidRange);
    }
    let mut out = Vec::with_capacity(prefix.len() + suffix.len());
    out.extend_from_slice(prefix);
    out.extend_from_slice(suffix);
    Ok(out)
}

/// Splice a detached CMS/PKCS#7 signature (DER) into the reserved `/Contents` gap, returning
/// the sealed PDF. The CMS is hex-encoded and right-padded with `0` to fill the reservation
/// exactly, so the `/ByteRange` — and therefore the digest the CMS signs — is untouched.
/// Fails if the CMS is larger than the reserved capacity.
pub fn embed_signature(prepared: &PreparedSignature, cms_der: &[u8]) -> Result<Vec<u8>, SignError> {
    let (start, end) = prepared.contents_span;
    // The span arrives from the host as plain numbers: refuse one that runs backwards or
    // past the end of the document before measuring or writing into it.
    if end < start || end > prepared.document.len() {
        return Err(SignError::InvalidRange);
    }
    let capacity_hex = end - start;
    let needed_hex = cms_der
        .len()
        .checked_mul(2)
        .ok_or(SignError::CapacityExceeded)?;
    if needed_hex > capacity_hex {
        return Err(SignError::CapacityExceeded);
    }
    let mut out = prepared.document.clone();
    let hex = hex_encode(cms_der);
    let region = out
        .get_mut(start..start + hex.len())
        .ok_or(SignError::InvalidRange)?;
    region.copy_from_slice(hex.as_bytes());
    // The remainder stays '0' padding (the placeholder was all zeros); nothing else to do.
    Ok(out)
}

/// Append an incremental update carrying an invisible signature field over the first page,
/// with a reserved `/Contents` and an exact `/ByteRange`. The input is preserved byte for
/// byte as the prefix of [`PreparedSignature::document`].
pub fn prepare_signature(
    input: &[u8],
    opts: &SignatureOptions,
) -> Result<PreparedSignature, SignError> {
    guard_input(input, &GuardLimits::default()).map_err(|_| SignError::Rejected)?;
    let doc = Document::load_mem(input).map_err(|_| SignError::Parse)?;

    // The offset of the previous cross-reference section — read from the trailing `startxref`
    // in the bytes themselves rather than from `Document::xref_start` (lopdf tracks that only
    // during parsing and leaves the field at 0 on the loaded document). This chains our
    // update via `/Prev`. We append a CLASSIC cross-reference table regardless of the base
    // file's format: a classic-table incremental update reached through `/Prev` chains onto a
    // classic table OR a cross-reference stream alike (the standard incremental-signing
    // technique — a reader parses our trailer, then follows `/Prev` to the prior section in
    // whatever format it is). This is what lets modern (PDF 1.5+, xref-stream) documents be
    // signed without rewriting them.
    let prev_startxref = last_startxref_offset(input).ok_or(SignError::Parse)?;

    let root_id = doc
        .trailer
        .get(b"Root")
        .ok()
        .and_then(|obj| obj.as_reference().ok())
        .ok_or(SignError::MissingCatalog)?;
    let catalog = doc
        .get_object(root_id)
        .ok()
        .and_then(|obj| obj.as_dict().ok())
        .ok_or(SignError::MissingCatalog)?
        .clone();

    // The first page in reading order carries the (invisible) widget.
    let page_id = *doc.get_pages().values().next().ok_or(SignError::NoPages)?;
    let page = doc
        .get_object(page_id)
        .ok()
        .and_then(|obj| obj.as_dict().ok())
        .ok_or(SignError::Malformed)?
        .clone();

    let capacity = if opts.contents_capacity == 0 {
        SignatureOptions::DEFAULT_CONTENTS_CAPACITY
    } else {
        opts.contents_capacity
    };

    // ── Object id allocation ──────────────────────────────────────────────────────────
    // New objects take fresh numbers above the document's current maximum. The catalog and
    // the page keep their original numbers — an incremental update OVERRIDES an object by
    // re-emitting it under the same id at a new offset.
    let base_max = doc.max_id;
    let field_id: ObjectId = (base_max + 1, 0);
    let sig_id: ObjectId = (base_max + 2, 0);

    // The AcroForm: reuse the existing one (merging our field into it) if the document has
    // one, else mint a new object for it and point the catalog at it. A `/AcroForm` that is
    // present but does not resolve to a dictionary is a malformed graph, not an absent form —
    // refuse rather than silently starting a fresh form and dropping the existing one.
    let acroform_ref = catalog.get(b"AcroForm").ok().cloned();
    let (acroform_id, mut acroform): (ObjectId, Dictionary) = match &acroform_ref {
        Some(obj) => {
            let dict = match resolve_owned(&doc, obj)? {
                Object::Dictionary(dict) => dict,
                _ => return Err(SignError::Malformed),
            };
            // Reuse the object it already lives in when that is a reference; an inline
            // AcroForm needs a fresh object number so the catalog can reference ours.
            let id = obj
                .as_reference()
                .ok()
                .unwrap_or_else(|| next_id(base_max, 3));
            (id, dict)
        }
        None => (next_id(base_max, 3), Dictionary::new()),
    };

    let highest_id = acroform_id.0.max(sig_id.0);

    // ── Build the overriding / new dictionaries ───────────────────────────────────────
    // The signature field is a merged field+widget annotation: invisible (zero Rect, hidden
    // but printable), typed /Sig, and pointing at the signature dictionary via /V.
    let mut field = Dictionary::new();
    field.set("FT", Object::Name(b"Sig".to_vec()));
    field.set("Type", Object::Name(b"Annot".to_vec()));
    field.set("Subtype", Object::Name(b"Widget".to_vec()));
    field.set(
        "T",
        Object::String(b"Signature1".to_vec(), StringFormat::Literal),
    );
    // /F 132 = Print (4) | Locked (128): prints with the page, cannot be moved or resized.
    field.set("F", Object::Integer(132));
    field.set(
        "Rect",
        Object::Array(vec![0.into(), 0.into(), 0.into(), 0.into()]),
    );
    field.set("P", Object::Reference(page_id));
    field.set("V", Object::Reference(sig_id));

    // The AcroForm gains our field and the signature flags (/SigFlags 3 =
    // SignaturesExist | AppendOnly), the standard marker that the form holds a signature.
    let mut fields = match acroform.get(b"Fields").ok().cloned() {
        Some(obj) => match resolve_owned(&doc, &obj)? {
            Object::Array(items) => items,
            _ => return Err(SignError::Malformed),
        },
        None => Vec::new(),
    };
    fields.push(Object::Reference(field_id));
    acroform.set("Fields", Object::Array(fields));
    acroform.set("SigFlags", Object::Integer(3));

    // The catalog override points at the AcroForm.
    let mut catalog_override = catalog.clone();
    catalog_override.set("AcroForm", Object::Reference(acroform_id));

    // The page override carries the widget in /Annots (resolved to an inline array so we
    // never have to re-emit a separate annots-array object).
    let mut page_override = page.clone();
    let mut annots = match page.get(b"Annots").ok().cloned() {
        Some(obj) => match resolve_owned(&doc, &obj)? {
            Object::Array(items) => items,
            _ => return Err(SignError::Malformed),
        },
        None => Vec::new(),
    };
    annots.push(Object::Reference(field_id));
    page_override.set("Annots", Object::Array(annots));

    // ── Emit the appended section ─────────────────────────────────────────────────────
    // Start from the input verbatim; everything after is the incremental update. A newline
    // separates our first object from the existing %%EOF cleanly.
    let mut out = input.to_vec();
    if !out.ends_with(b"\n") {
        out.push(b'\n');
    }

    // Each entry carries the object's generation, not a hardcoded 0: an incremental override
    // reuses the original object's number AND generation, and the `N G obj` header, the
    // `/Root G R` reference, and this xref entry must all agree on it.
    let mut xref_entries: Vec<(u32, u16, usize)> = Vec::new();

    // Objects whose body is a plain dictionary go through the generic emitter. The AcroForm is
    // always emitted (new object, or an override of the existing one).
    for (id, dict) in [
        (field_id, &field),
        (page_id, &page_override),
        (root_id, &catalog_override),
        (acroform_id, &acroform),
    ] {
        xref_entries.push((id.0, id.1, out.len()));
        emit_dict_object(&mut out, id, dict);
    }

    // The signature dictionary is emitted by hand so we can capture the exact offsets of the
    // `/ByteRange` placeholder fields and the `/Contents` `<`.
    let sig_offset = out.len();
    xref_entries.push((sig_id.0, sig_id.1, sig_offset));
    let markers = emit_signature_dict(&mut out, sig_id, opts, capacity);

    // ── The cross-reference table + trailer ───────────────────────────────────────────
    // /Size is one past the highest object number used anywhere in the file, so it must not
    // regress below the prior revision's /Size (a file with historical high-numbered objects
    // can have a /Size above lopdf's observed max_id).
    let prior_size = doc
        .trailer
        .get(b"Size")
        .ok()
        .and_then(|o| o.as_i64().ok())
        .unwrap_or(0);
    let size = ((highest_id as i64 + 1).max(prior_size)) as u32;
    let xref_offset = out.len();
    emit_xref_and_trailer(
        &mut out,
        &mut xref_entries,
        size,
        root_id,
        prev_startxref,
        doc.trailer.get(b"ID").ok(),
        xref_offset,
    );

    // ── Resolve the /ByteRange now the whole file exists ──────────────────────────────
    let total = out.len();
    let gap_start = markers.contents_lt; // offset of '<'
    let gap_end = markers.contents_gt + 1; // offset just past '>'
    let suffix_len = total - gap_end;
    patch_offset(&mut out, markers.range_field_1, gap_start);
    patch_offset(&mut out, markers.range_field_2, gap_end);
    patch_offset(&mut out, markers.range_field_3, suffix_len);

    Ok(PreparedSignature {
        document: out,
        byte_range: [0, gap_start, gap_end, suffix_len],
        // The hex digits sit strictly between the brackets.
        contents_span: (markers.contents_lt + 1, markers.contents_gt),
    })
}

// ---------------------------------------------------------------------------
// Emission helpers
// ---------------------------------------------------------------------------

fn next_id(base_max: u32, offset: u32) -> ObjectId {
    (base_max + offset, 0)
}

/// Absolute offsets, in the output buffer, of the mutable pieces of the signature dict.
struct SigMarkers {
    range_field_1: usize,
    range_field_2: usize,
    range_field_3: usize,
    contents_lt: usize,
    contents_gt: usize,
}

/// Emit `id 0 obj << … >> endobj` for a plain dictionary body via the generic serializer.
fn emit_dict_object(out: &mut Vec<u8>, id: ObjectId, dict: &Dictionary) {
    out.extend_from_slice(format!("{} {} obj\n", id.0, id.1).as_bytes());
    serialize_dictionary(dict, out);
    out.extend_from_slice(b"\nendobj\n");
}

/// Emit the signature dictionary by hand, returning the offsets of the `/ByteRange`
/// placeholders and the `/Contents` angle brackets. The `/ByteRange` is written with
/// fixed-width zero placeholders (patched once the file length is known) and precedes
/// `/Contents` so patching it never shifts the gap.
fn emit_signature_dict(
    out: &mut Vec<u8>,
    id: ObjectId,
    opts: &SignatureOptions,
    capacity: usize,
) -> SigMarkers {
    out.extend_from_slice(format!("{} {} obj\n", id.0, id.1).as_bytes());
    out.extend_from_slice(b"<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached");

    let push_str_field = |out: &mut Vec<u8>, key: &str, value: &Option<String>| {
        if let Some(v) = value {
            out.extend_from_slice(format!(" /{key} ").as_bytes());
            serialize_object(
                &Object::String(pdf_text_string(v), StringFormat::Literal),
                out,
            );
        }
    };
    push_str_field(out, "Name", &opts.name);
    push_str_field(out, "Reason", &opts.reason);
    push_str_field(out, "Location", &opts.location);
    push_str_field(out, "ContactInfo", &opts.contact_info);
    push_str_field(out, "M", &opts.signing_time);

    // /ByteRange [0 __________ __________ __________] — three fixed 10-column patch targets,
    // filled once the file length is known ([`patch_offset`], right-justified space padding so
    // each stays a plain integer). Ten columns addresses ~9.9 GB, past anything the input guard
    // admits, so the layout never has to re-flow when the real values are written.
    out.extend_from_slice(b" /ByteRange [0 ");
    let range_field_1 = out.len();
    out.extend_from_slice(b"0000000000 ");
    let range_field_2 = out.len();
    out.extend_from_slice(b"0000000000 ");
    let range_field_3 = out.len();
    out.extend_from_slice(b"0000000000]");

    // /Contents <0…0> — the reserved gap, twice `capacity` hex zeros between the brackets.
    out.extend_from_slice(b" /Contents ");
    let contents_lt = out.len();
    out.push(b'<');
    out.resize(out.len() + capacity * 2, b'0');
    let contents_gt = out.len();
    out.push(b'>');

    out.extend_from_slice(b" >>\nendobj\n");

    SigMarkers {
        range_field_1,
        range_field_2,
        range_field_3,
        contents_lt,
        contents_gt,
    }
}

/// Emit a classic cross-reference table for exactly the overridden/new objects, plus the
/// trailer (with `/Prev` chaining to the document's previous section) and `startxref`.
fn emit_xref_and_trailer(
    out: &mut Vec<u8>,
    entries: &mut [(u32, u16, usize)],
    size: u32,
    root_id: ObjectId,
    prev_startxref: usize,
    id_array: Option<&Object>,
    xref_offset: usize,
) {
    entries.sort_by_key(|(id, _, _)| *id);

    out.extend_from_slice(b"xref\n");
    // Group into contiguous runs — an xref subsection covers a contiguous id range.
    let mut i = 0;
    while i < entries.len() {
        let run_start = entries[i].0;
        let mut j = i;
        while j + 1 < entries.len() && entries[j + 1].0 == entries[j].0 + 1 {
            j += 1;
        }
        let count = (j - i + 1) as u32;
        out.extend_from_slice(format!("{run_start} {count}\n").as_bytes());
        for (_, generation, offset) in &entries[i..=j] {
            // 20-byte entry: "nnnnnnnnnn ggggg n\r\n".
            out.extend_from_slice(format!("{offset:010} {generation:05} n\r\n").as_bytes());
        }
        i = j + 1;
    }

    out.extend_from_slice(b"trailer\n<< /Size ");
    out.extend_from_slice(size.to_string().as_bytes());
    out.extend_from_slice(format!(" /Root {} {} R", root_id.0, root_id.1).as_bytes());
    out.extend_from_slice(format!(" /Prev {prev_startxref}").as_bytes());
    if let Some(id) = id_array {
        out.extend_from_slice(b" /ID ");
        serialize_object(id, out);
    }
    out.extend_from_slice(b" >>\nstartxref\n");
    out.extend_from_slice(xref_offset.to_string().as_bytes());
    out.extend_from_slice(b"\n%%EOF\n");
}

/// Overwrite a fixed 10-column placeholder at `pos` with `value`, right-justified and
/// space-padded (`       123`). Extra leading spaces are token separators, so the array stays
/// a sequence of plain integers — the canonical `/ByteRange` shape signing verifiers expect,
/// rather than non-canonical leading-zero integers. `value` is a byte offset or length that
/// always fits 10 columns for any document the input guard admits (≤ 256 MiB).
fn patch_offset(out: &mut [u8], pos: usize, value: usize) {
    let digits = format!("{value:>10}");
    out[pos..pos + 10].copy_from_slice(digits.as_bytes());
}

/// Follow one level of indirection: if `obj` is a reference, return the referent (owned);
/// otherwise return a clone. A reference that does not resolve is a malformed graph, not an
/// empty value — surfaced as an error so a caller never silently drops the structure it named.
/// One level is enough for the /AcroForm, /Fields, and /Annots shapes this module reads.
fn resolve_owned(doc: &Document, obj: &Object) -> Result<Object, SignError> {
    match obj {
        Object::Reference(id) => doc
            .get_object(*id)
            .cloned()
            .map_err(|_| SignError::Malformed),
        other => Ok(other.clone()),
    }
}

/// Read the offset from the file's last `startxref` — the start of the most recent
/// cross-reference section. Scans from the end for the keyword, then parses the following
/// integer (PDF puts the number on the next line). `None` if there is no parsable trailer.
fn last_startxref_offset(input: &[u8]) -> Option<usize> {
    let keyword = b"startxref";
    let pos = input.windows(keyword.len()).rposition(|w| w == keyword)?;
    let rest = &input[pos + keyword.len()..];
    let digits: Vec<u8> = rest
        .iter()
        .skip_while(|b| b.is_ascii_whitespace())
        .take_while(|b| b.is_ascii_digit())
        .copied()
        .collect();
    if digits.is_empty() {
        return None;
    }
    std::str::from_utf8(&digits).ok()?.parse().ok()
}

// ---------------------------------------------------------------------------
// Minimal PDF object serializer
// ---------------------------------------------------------------------------
//
// Enough of the PDF object syntax to re-emit the catalog and page dictionaries verbatim
// (plus the field / AcroForm dicts we build). References are preserved as-is — this never
// resolves or inlines the object graph. Streams are supported for completeness but do not
// occur in the dictionaries this module re-emits.

fn serialize_object(obj: &Object, out: &mut Vec<u8>) {
    match obj {
        Object::Null => out.extend_from_slice(b"null"),
        Object::Boolean(b) => out.extend_from_slice(if *b { b"true" } else { b"false" }),
        Object::Integer(i) => out.extend_from_slice(i.to_string().as_bytes()),
        Object::Real(f) => out.extend_from_slice(format_real(*f).as_bytes()),
        Object::Name(name) => serialize_name(name, out),
        Object::String(bytes, StringFormat::Literal) => serialize_literal_string(bytes, out),
        Object::String(bytes, StringFormat::Hexadecimal) => {
            out.push(b'<');
            out.extend_from_slice(hex_encode(bytes).as_bytes());
            out.push(b'>');
        }
        Object::Reference(id) => out.extend_from_slice(format!("{} {} R", id.0, id.1).as_bytes()),
        Object::Array(items) => {
            out.push(b'[');
            for (idx, item) in items.iter().enumerate() {
                if idx > 0 {
                    out.push(b' ');
                }
                serialize_object(item, out);
            }
            out.push(b']');
        }
        Object::Dictionary(dict) => serialize_dictionary(dict, out),
        Object::Stream(stream) => {
            serialize_dictionary(&stream.dict, out);
            out.extend_from_slice(b"\nstream\n");
            out.extend_from_slice(&stream.content);
            out.extend_from_slice(b"\nendstream");
        }
    }
}

fn serialize_dictionary(dict: &Dictionary, out: &mut Vec<u8>) {
    out.extend_from_slice(b"<<");
    for (key, value) in dict.iter() {
        out.push(b' ');
        serialize_name(key, out);
        out.push(b' ');
        serialize_object(value, out);
    }
    out.extend_from_slice(b" >>");
}

/// A PDF name: `/` then the bytes, with anything outside the printable non-delimiter range
/// escaped as `#XX`. Matches the reader's un-escaping so a round-tripped name is identical.
fn serialize_name(name: &[u8], out: &mut Vec<u8>) {
    out.push(b'/');
    for &b in name {
        let is_regular = b.is_ascii_graphic()
            && !matches!(
                b,
                b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%' | b'#'
            );
        if is_regular {
            out.push(b);
        } else {
            out.extend_from_slice(format!("#{b:02X}").as_bytes());
        }
    }
}

/// A PDF literal string `( … )`: escape the delimiters and backslash, keep printable ASCII,
/// and octal-escape everything else. Balanced-parenthesis shortcuts are not used — every
/// paren is escaped, which is always valid.
/// `text` as a PDF text string. ASCII is written as it stands. Anything else is UTF-16
/// big-endian behind a byte-order mark, the one form every reader takes: raw UTF-8 bytes
/// are read as PDFDocEncoding, which turns "José" into "JosÃ©" in the signature panel.
fn pdf_text_string(text: &str) -> Vec<u8> {
    if text.is_ascii() {
        return text.as_bytes().to_vec();
    }
    let mut bytes = vec![0xFE, 0xFF];
    for unit in text.encode_utf16() {
        bytes.extend_from_slice(&unit.to_be_bytes());
    }
    bytes
}

fn serialize_literal_string(bytes: &[u8], out: &mut Vec<u8>) {
    out.push(b'(');
    for &b in bytes {
        match b {
            b'(' => out.extend_from_slice(b"\\("),
            b')' => out.extend_from_slice(b"\\)"),
            b'\\' => out.extend_from_slice(b"\\\\"),
            b'\n' => out.extend_from_slice(b"\\n"),
            b'\r' => out.extend_from_slice(b"\\r"),
            b'\t' => out.extend_from_slice(b"\\t"),
            0x20..=0x7e => out.push(b),
            _ => out.extend_from_slice(format!("\\{b:03o}").as_bytes()),
        }
    }
    out.push(b')');
}

/// Format a real the way a PDF expects: no exponent, no trailing-zero noise, integers with
/// no decimal point.
fn format_real(f: f32) -> String {
    if !f.is_finite() {
        return "0".to_string();
    }
    if f.fract() == 0.0 && f.abs() < 1e15 {
        return format!("{}", f as i64);
    }
    let mut s = format!("{f:.6}");
    while s.ends_with('0') {
        s.pop();
    }
    if s.ends_with('.') {
        s.pop();
    }
    s
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_signer_name_with_an_accent_is_written_as_utf16() {
        assert_eq!(pdf_text_string("Jose"), b"Jose");
        assert_eq!(
            pdf_text_string("José"),
            [0xFE, 0xFF, 0, b'J', 0, b'o', 0, b's', 0, 0xE9]
        );
    }
    use lopdf::{dictionary, Stream};

    /// A minimal, valid single-page PDF with a classic xref, built to round-trip through the
    /// lopdf writer (so `prepare_signature`'s input is a realistic file, not a synthetic one).
    fn base_pdf() -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Pages".to_vec()),
            "Kids" => Object::Array(vec![]),
            "Count" => Object::Integer(0),
        });
        let catalog_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Catalog".to_vec()),
            "Pages" => Object::Reference(pages_id),
        });
        doc.trailer.set("Root", Object::Reference(catalog_id));
        let content_id = doc.add_object(Object::Stream(Stream::new(
            dictionary! {},
            b"BT ET".to_vec(),
        )));
        let page_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Page".to_vec()),
            "Parent" => Object::Reference(pages_id),
            "MediaBox" => Object::Array(vec![0.into(), 0.into(), 612.into(), 792.into()]),
            "Contents" => Object::Reference(content_id),
            "Resources" => Object::Dictionary(dictionary! { "Font" => Object::Dictionary(dictionary! {}) }),
        });
        if let Ok(Object::Dictionary(pages_dict)) = doc.get_object_mut(pages_id) {
            pages_dict.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
            pages_dict.set("Count", Object::Integer(1));
        }
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).expect("serialize base pdf");
        bytes
    }

    /// The same document forced to a classic cross-reference TABLE, so both base formats are
    /// exercised. Modern PDFs (and lopdf's own default output) use xref streams; older tools
    /// emit classic tables. The signing append must chain onto either.
    fn base_pdf_classic_xref() -> Vec<u8> {
        let mut bytes = base_pdf();
        // Rebuild through lopdf with the classic table type selected.
        let mut doc = Document::load_mem(&bytes).expect("reload");
        doc.reference_table.cross_reference_type = lopdf::xref::XrefType::CrossReferenceTable;
        bytes.clear();
        doc.save_to(&mut bytes).expect("serialize classic");
        bytes
    }

    fn opts() -> SignatureOptions {
        SignatureOptions {
            name: Some("Magna Carta Seal".to_string()),
            reason: Some("Engagement letter".to_string()),
            location: Some("Reno, NV".to_string()),
            contact_info: None,
            signing_time: Some("D:20260717120000Z".to_string()),
            contents_capacity: 4096,
        }
    }

    #[test]
    fn the_input_is_preserved_as_a_literal_prefix() {
        let input = base_pdf();
        let prepared = prepare_signature(&input, &opts()).expect("prepare");
        assert!(
            prepared.document.len() > input.len(),
            "an incremental update was appended"
        );
        assert_eq!(
            &prepared.document[..input.len()],
            &input[..],
            "the original bytes must survive verbatim as the prefix"
        );
    }

    #[test]
    fn the_output_reparses_and_gains_the_signature_wiring() {
        let input = base_pdf();
        let prepared = prepare_signature(&input, &opts()).expect("prepare");
        let doc = Document::load_mem(&prepared.document).expect("reparse");
        // The catalog now points at an AcroForm with SigFlags set.
        let acroform = doc
            .catalog()
            .expect("catalog")
            .get(b"AcroForm")
            .and_then(|o| doc.dereference(o).map(|(_, v)| v))
            .expect("acroform")
            .as_dict()
            .expect("acroform dict")
            .clone();
        assert_eq!(
            acroform.get(b"SigFlags").and_then(|o| o.as_i64()).ok(),
            Some(3)
        );
        let fields = acroform
            .get(b"Fields")
            .and_then(|o| o.as_array())
            .expect("fields");
        assert_eq!(fields.len(), 1, "exactly one signature field");
    }

    #[test]
    fn the_byte_range_covers_everything_but_the_contents_gap() {
        let input = base_pdf();
        let prepared = prepare_signature(&input, &opts()).expect("prepare");
        let [r0, gap_start, gap_end, suffix_len] = prepared.byte_range;
        assert_eq!(r0, 0);
        assert_eq!(
            gap_end + suffix_len,
            prepared.document.len(),
            "range reaches EOF"
        );

        // The excluded gap is exactly the /Contents value including its angle brackets.
        assert_eq!(prepared.document[gap_start], b'<');
        assert_eq!(prepared.document[gap_end - 1], b'>');
        // The reserved hex span sits strictly inside the brackets.
        let (cs, ce) = prepared.contents_span;
        assert_eq!(cs, gap_start + 1);
        assert_eq!(ce, gap_end - 1);
        // Everything inside is currently zero padding.
        assert!(prepared.document[cs..ce].iter().all(|&b| b == b'0'));
    }

    #[test]
    fn the_written_byte_range_string_matches_the_reported_range() {
        // The /ByteRange the verifier will read out of the file must equal what we report.
        let input = base_pdf();
        let prepared = prepare_signature(&input, &opts()).expect("prepare");
        let doc = Document::load_mem(&prepared.document).expect("reparse");
        // Walk to the signature dict via the field's /V.
        let acroform = doc.catalog().unwrap().get(b"AcroForm").unwrap();
        let acroform = doc
            .dereference(acroform)
            .unwrap()
            .1
            .as_dict()
            .unwrap()
            .clone();
        let field_ref = acroform.get(b"Fields").unwrap().as_array().unwrap()[0].clone();
        let field = doc
            .dereference(&field_ref)
            .unwrap()
            .1
            .as_dict()
            .unwrap()
            .clone();
        let sig = doc
            .dereference(field.get(b"V").unwrap())
            .unwrap()
            .1
            .as_dict()
            .unwrap()
            .clone();
        let range = sig.get(b"ByteRange").unwrap().as_array().unwrap();
        let got: Vec<i64> = range.iter().map(|o| o.as_i64().unwrap()).collect();
        assert_eq!(
            got,
            vec![
                prepared.byte_range[0] as i64,
                prepared.byte_range[1] as i64,
                prepared.byte_range[2] as i64,
                prepared.byte_range[3] as i64,
            ]
        );
        // And it is a PAdES CAdES-detached signature.
        assert_eq!(
            sig.get(b"SubFilter").unwrap().as_name().unwrap(),
            b"ETSI.CAdES.detached"
        );
    }

    #[test]
    fn signed_bytes_are_the_two_ranges_concatenated() {
        let input = base_pdf();
        let prepared = prepare_signature(&input, &opts()).expect("prepare");
        let signed = signed_bytes(&prepared).expect("signed bytes");
        let [_, gap_start, gap_end, suffix_len] = prepared.byte_range;
        assert_eq!(signed.len(), gap_start + suffix_len);
        assert_eq!(&signed[..gap_start], &prepared.document[..gap_start]);
        assert_eq!(
            &signed[gap_start..],
            &prepared.document[gap_end..gap_end + suffix_len]
        );
        // The gap bytes appear nowhere in the signed content.
        assert!(
            !signed.contains(&b'<')
                || signed.iter().filter(|&&b| b == b'<').count()
                    < prepared.document.iter().filter(|&&b| b == b'<').count()
        );
    }

    #[test]
    fn a_byte_range_outside_the_document_is_refused_not_a_panic() {
        let input = base_pdf();
        let prepared = prepare_signature(&input, &opts()).expect("prepare");
        let length = prepared.document.len();
        for byte_range in [
            [0, length + 1, length + 2, 0],
            [0, 10, 5, 0],
            [0, 10, 20, length],
            [0, 10, usize::MAX, 2],
        ] {
            let bad = PreparedSignature {
                byte_range,
                ..prepared.clone()
            };
            assert_eq!(signed_bytes(&bad), Err(SignError::InvalidRange));
        }
    }

    #[test]
    fn a_contents_span_outside_the_document_is_refused_not_a_panic() {
        let input = base_pdf();
        let prepared = prepare_signature(&input, &opts()).expect("prepare");
        let length = prepared.document.len();
        for contents_span in [(20, 10), (length, length + 64), (0, usize::MAX)] {
            let bad = PreparedSignature {
                contents_span,
                ..prepared.clone()
            };
            assert_eq!(
                embed_signature(&bad, &[0xAB; 4]),
                Err(SignError::InvalidRange)
            );
        }
    }

    #[test]
    fn embedding_a_signature_leaves_the_signed_bytes_untouched() {
        let input = base_pdf();
        let prepared = prepare_signature(&input, &opts()).expect("prepare");
        let signed_before = signed_bytes(&prepared).expect("signed bytes");

        let cms = vec![0xDEu8, 0xAD, 0xBE, 0xEF, 0x01, 0x02, 0x03, 0x04];
        let sealed = embed_signature(&prepared, &cms).expect("embed");

        // Same length, same prefix, same /ByteRange — only the gap changed.
        assert_eq!(sealed.len(), prepared.document.len());
        let sealed_prepared = PreparedSignature {
            document: sealed.clone(),
            ..prepared.clone()
        };
        let signed_after = signed_bytes(&sealed_prepared).expect("signed bytes");
        assert_eq!(
            signed_before, signed_after,
            "the digested bytes must not move"
        );

        // The CMS hex is at the head of the gap, zero padding after it.
        let (cs, ce) = prepared.contents_span;
        assert_eq!(&sealed[cs..cs + cms.len() * 2], hex_encode(&cms).as_bytes());
        assert!(sealed[cs + cms.len() * 2..ce].iter().all(|&b| b == b'0'));

        // And it still parses.
        Document::load_mem(&sealed).expect("sealed reparse");
    }

    #[test]
    fn a_cms_larger_than_the_reservation_is_refused() {
        let input = base_pdf();
        let mut o = opts();
        o.contents_capacity = 8; // 8 bytes → 16 hex chars
        let prepared = prepare_signature(&input, &o).expect("prepare");
        let too_big = vec![0u8; 9];
        assert_eq!(
            embed_signature(&prepared, &too_big),
            Err(SignError::CapacityExceeded)
        );
        // Exactly-fitting is accepted.
        let exact = vec![0u8; 8];
        assert!(embed_signature(&prepared, &exact).is_ok());
    }

    #[test]
    fn a_second_signature_chains_onto_the_first() {
        // Preparing over an already-prepared (and sealed) document must again preserve the
        // whole prior file as the prefix — the incremental-update invariant that makes
        // multi-signature documents possible.
        let input = base_pdf();
        let first = prepare_signature(&input, &opts()).expect("first prepare");
        let sealed = embed_signature(&first, &[0xAB; 16]).expect("embed first");

        let second = prepare_signature(&sealed, &opts()).expect("second prepare");
        assert_eq!(
            &second.document[..sealed.len()],
            &sealed[..],
            "the first signed revision survives verbatim under the second signature"
        );
        Document::load_mem(&second.document).expect("twice-signed reparse");
    }

    #[test]
    fn a_classic_xref_base_is_signed_and_reparses() {
        // The xref-stream default is covered by every other test; this proves the classic
        // cross-reference-table base signs and re-reads too.
        let input = base_pdf_classic_xref();
        let prepared = prepare_signature(&input, &opts()).expect("prepare classic");
        assert_eq!(
            &prepared.document[..input.len()],
            &input[..],
            "classic-xref input preserved as prefix"
        );
        let doc = Document::load_mem(&prepared.document).expect("reparse classic");
        assert!(doc.catalog().unwrap().get(b"AcroForm").is_ok());
    }

    #[test]
    fn the_sealed_document_still_parses_through_the_render_engine() {
        // Independent of lopdf: the incremental update must also be readable by hayro (the
        // engine's own render parser), so a signed document still previews and rasterizes.
        let input = base_pdf();
        let prepared = prepare_signature(&input, &opts()).expect("prepare");
        let sealed = embed_signature(&prepared, &[0x30; 32]).expect("embed");
        let doc = crate::Document::load(sealed).expect("render engine loads the sealed pdf");
        assert_eq!(
            doc.page_count(),
            1,
            "the page survives the incremental update"
        );
    }

    #[test]
    fn a_dangling_annots_reference_is_refused_not_silently_dropped() {
        // A page whose /Annots points at a missing object is a malformed graph. The earlier
        // behavior would treat the unresolved reference as empty and quietly discard it; now it
        // is refused, so a signature never lands on a document we could not fully read.
        let mut doc = Document::load_mem(&base_pdf()).expect("load");
        let page_id = *doc.get_pages().values().next().unwrap();
        if let Ok(Object::Dictionary(page)) = doc.get_object_mut(page_id) {
            page.set("Annots", Object::Reference((9999, 0)));
        }
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).expect("serialize");
        assert!(matches!(
            prepare_signature(&bytes, &opts()),
            Err(SignError::Malformed)
        ));
    }

    #[test]
    fn the_byte_range_values_parse_as_plain_integers() {
        // The space-padded /ByteRange must still read back as exactly the four reported ints.
        let input = base_pdf();
        let prepared = prepare_signature(&input, &opts()).expect("prepare");
        let doc = Document::load_mem(&prepared.document).expect("reparse");
        let acroform = doc
            .dereference(doc.catalog().unwrap().get(b"AcroForm").unwrap())
            .unwrap()
            .1
            .as_dict()
            .unwrap()
            .clone();
        let field = doc
            .dereference(&acroform.get(b"Fields").unwrap().as_array().unwrap()[0])
            .unwrap()
            .1
            .as_dict()
            .unwrap()
            .clone();
        let sig = doc
            .dereference(field.get(b"V").unwrap())
            .unwrap()
            .1
            .as_dict()
            .unwrap()
            .clone();
        let range: Vec<i64> = sig
            .get(b"ByteRange")
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .map(|o| o.as_i64().unwrap())
            .collect();
        assert_eq!(
            range,
            prepared
                .byte_range
                .iter()
                .map(|&v| v as i64)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn a_non_pdf_is_a_parse_error() {
        assert!(matches!(
            prepare_signature(b"not a pdf at all", &opts()),
            Err(SignError::Parse)
        ));
    }
}
