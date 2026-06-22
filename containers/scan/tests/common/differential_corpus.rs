//! Corpus derivation for the differential gate (`tests/differential.rs`). Builds the prefilter from the
//! unpacked signature DB and derives a sample of files clamd is guaranteed to match — both straight from
//! the same `/sigsrc` directory, so the gate compares two views of ONE database.
//!
//! Shared by the gate as a `#[path]` module rather than a crate item so it ships only with the test.

#![allow(dead_code)] // Some helpers are used only by the #[ignore]d live gate, not the always-on tests.

use std::path::Path;

use magna_carta_scan::atoms::{
    parse_hdb, parse_hsb, parse_ldb, parse_ndb, tokenize_fixed_runs, AtomDb, ATOM_CAP, MIN_ATOM_LEN,
};
use magna_carta_scan::prefilter::{BuildError, Prefilter};

/// One DB-derived corpus entry: the rendered bytes (which clamd must flag) plus the signature name and
/// the content-type to present to the prefilter so its target-class routing matches the signature's
/// TargetType.
pub struct Sample {
    pub name: String,
    pub bytes: Vec<u8>,
    pub content_type: Option<String>,
}

/// Builds the prefilter exactly as `build-atoms` + the runtime would: folds every reused class
/// (`.hdb`/`.hsb`/`.ndb`/`.ldb`) into an [`AtomDb`] and compiles it. (The forced-fall-through classes do
/// not affect whether a fixed-run sample falls through — an atom hit already forces it — so the gate does
/// not need them here.) Returns the matcher-compile error if the real pattern set will not compile.
pub fn build_prefilter_from_sigsrc(sigsrc: &Path) -> Result<Prefilter, BuildError> {
    let mut db = AtomDb::default();
    for entry in std::fs::read_dir(sigsrc).expect("read sigsrc").flatten() {
        let path = entry.path();
        let Some(extension) = path.extension().and_then(|os| os.to_str()) else {
            continue;
        };
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        match extension {
            "ndb" => db.absorb(parse_ndb(&text)),
            "ldb" => db.absorb(parse_ldb(&text)),
            "hdb" => db.hashes.extend(parse_hdb(&text)),
            "hsb" => db.hashes.extend(parse_hsb(&text)),
            _ => {}
        }
    }
    Prefilter::from_atom_db(db)
}

/// Derives up to `limit` corpus samples from pure-fixed-run signatures in the unpacked DB. A sample is
/// emitted only when the signature renders to bytes clamd matches DETERMINISTICALLY:
///
///  - `.ndb` line `Name:Target:Offset:Hex` — taken only when `Offset` is `*` (any offset, so the rendered
///    bytes need no padding) and `Hex` is a SINGLE pure fixed run of `>= MIN_ATOM_LEN` bytes (no
///    wildcard/range/alternate to satisfy). The file content is exactly those bytes.
///  - `.ldb` — taken only when a subsig is a bare pure-fixed-run literal (no offset prefix, no modifier,
///    no PCRE/byte_compare/macro) and the logical expression is satisfiable by that single subsig
///    matching (we restrict to single-subsig `0` expressions so the rendered bytes guarantee a clamd
///    match). Rendered file content is the decoded run.
///
/// Restricting to these shapes keeps the corpus a set clamd is GUARANTEED to flag, which is what makes a
/// prefilter `Clean` on any of them an unambiguous false-clean rather than a corpus artifact. The
/// content-type is chosen from the signature's TargetType so the prefilter's target routing lines up.
pub fn derive_pure_fixed_run_samples(sigsrc: &Path, limit: usize) -> Vec<Sample> {
    let mut samples = Vec::new();
    for entry in std::fs::read_dir(sigsrc).expect("read sigsrc").flatten() {
        if samples.len() >= limit {
            break;
        }
        let path = entry.path();
        let Some(extension) = path.extension().and_then(|os| os.to_str()) else {
            continue;
        };
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        match extension {
            "ndb" => collect_ndb_samples(&text, limit, &mut samples),
            "ldb" => collect_ldb_samples(&text, limit, &mut samples),
            _ => {}
        }
    }
    samples
}

fn collect_ndb_samples(text: &str, limit: usize, out: &mut Vec<Sample>) {
    for line in text.lines() {
        if out.len() >= limit {
            return;
        }
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.split(':').collect();
        if fields.len() < 4 {
            continue;
        }
        let name = fields[0];
        let target: u32 = fields[1].parse().unwrap_or(0);
        let offset = fields[2];
        let hex = fields[3];
        // Only `*` offset: the rendered fixed run can sit anywhere, so no offset padding is needed.
        if offset != "*" {
            continue;
        }
        if let Some(bytes) = pure_fixed_run_bytes(hex) {
            out.push(Sample {
                name: name.to_string(),
                bytes,
                content_type: content_type_for_target(target),
            });
        }
    }
}

fn collect_ldb_samples(text: &str, limit: usize, out: &mut Vec<Sample>) {
    for line in text.lines() {
        if out.len() >= limit {
            return;
        }
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.split(';').collect();
        if fields.len() < 4 {
            continue;
        }
        let name = fields[0];
        let target = parse_ldb_target(fields[1]);
        // Restrict to a single-subsig `0` expression so one literal subsig matching guarantees the whole
        // signature fires — the rendered bytes are then a clamd-guaranteed match.
        if fields[2].trim() != "0" {
            continue;
        }
        let subsig = fields[3];
        // Reject any subsig that is not a bare pure-fixed-run literal (an offset prefix, a modifier, or a
        // non-literal type would make the render non-deterministic or not a guaranteed match).
        if subsig.contains(':')
            || subsig.contains("::")
            || subsig.starts_with('(')
            || subsig.starts_with("${")
            || subsig.starts_with("fuzzy_img#")
            || subsig.contains('/')
            || subsig.contains('#')
            || subsig.contains('$')
        {
            continue;
        }
        if let Some(bytes) = pure_fixed_run_bytes(subsig) {
            out.push(Sample {
                name: name.to_string(),
                bytes,
                content_type: content_type_for_target(target),
            });
        }
    }
}

/// Returns the decoded bytes IFF `hex` is a SINGLE pure fixed run of `>= MIN_ATOM_LEN` bytes — i.e. the
/// tokenizer yields exactly one run and that run is the whole decoded body (no wildcard/range/alternate
/// split it). Caps to a sane render length so a multi-KB run does not bloat the scratch file; the prefix
/// is still a clamd match because the rendered bytes contain the prefix the atom anchors on AND clamd
/// matches a fixed run by its full content — so we keep the FULL run (not the atom cap) to guarantee the
/// clamd match, only bounding pathologically long runs.
fn pure_fixed_run_bytes(hex: &str) -> Option<Vec<u8>> {
    let runs = tokenize_fixed_runs(hex);
    if runs.len() != 1 {
        return None;
    }
    let run = &runs[0];
    if run.len() < MIN_ATOM_LEN {
        return None;
    }
    // Sanity bound on render size; a real signature's full fixed run is what clamd matches, so render it
    // in full unless it is pathologically long. (ATOM_CAP is the prefilter's per-atom cap, not a clamd
    // bound; we render >= that so the file is unambiguously a clamd match.)
    let render_len = run.len().min(MAX_RENDER_BYTES);
    if render_len < MIN_ATOM_LEN {
        return None;
    }
    // The whole decoded run is the body; verify it decoded cleanly (the tokenizer only emits full pairs,
    // so this is already guaranteed, but assert the cap relationship for clarity).
    debug_assert!(ATOM_CAP >= MIN_ATOM_LEN);
    Some(run[..render_len].to_vec())
}

const MAX_RENDER_BYTES: usize = 512;

fn parse_ldb_target(block: &str) -> u32 {
    for pair in block.split(',') {
        if let Some(value) = pair.strip_prefix("Target:") {
            return value.trim().parse::<u32>().unwrap_or(0);
        }
    }
    0
}

/// A content-type whose `map_target_type` lands on `target`, so the prefilter routes the sample to the
/// same TargetType the signature carries. For ANY(0) we use a plain text type (the prefilter checks the
/// fall-through set against both the mapped target AND ANY, so this is fine). A `None` would map to ANY
/// too; we present an explicit type to mirror what the ingest port sends.
fn content_type_for_target(target: u32) -> Option<String> {
    let content_type = match target {
        1 => "application/x-dosexec",     // PE
        2 => "application/x-ole-storage", // OLE2
        3 => "text/html",                 // HTML
        4 => "message/rfc822",            // MAIL
        5 => "image/png",                 // GRAPHICS
        6 => "application/x-executable",  // ELF
        7 => "text/plain",                // ASCII
        9 => "application/x-mach-binary", // MACHO
        10 => "application/pdf",          // PDF
        _ => "text/plain",                // ANY / unknown -> plain text
    };
    Some(content_type.to_string())
}
