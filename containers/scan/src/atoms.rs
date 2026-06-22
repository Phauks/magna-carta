//! Pure parsers for the unpacked ClamAV signature database (`.hdb`/`.hsb`/`.ndb`/`.ldb`). They turn
//! raw signature text into the literal atoms and file-hash entries the prefilter compiles into its
//! Vectorscan database — no I/O here beyond the caller handing in file text; the build-time binary
//! reads the files and calls these.
//!
//! The single load-bearing correctness rule is **never invent a fixed byte that is not fixed.** Every
//! atom the prefilter trusts is a *necessary condition* for its signature: if the atom is absent the
//! signature cannot match, so a file the prefilter clears is provably clear of that signature. A
//! phantom atom — bytes pulled from inside a wildcard, an alternate, a byte-range, or any other
//! meta-construct — breaks that guarantee and produces a FALSE-CLEAN: a file the prefilter clears that
//! ClamAV would have flagged. The tokenizer therefore treats every ClamAV body-signature meta-construct
//! as a run BREAK and emits fixed runs only from genuinely fixed hex-pair positions.
//!
//! When a signature cannot be reduced to a sound atom (its longest fixed run is shorter than
//! `MIN_ATOM_LEN`, or it carries a construct that is not a pure anchorable literal), it is marked
//! UNPREFILTERABLE and carries its TargetType so the caller can force that target class to fall through
//! to the clamd deep scan — never silently uncovered.

use serde::{Deserialize, Serialize};

/// The shortest fixed run that may serve as a prefilter atom. At 8 bytes the odds a clean file contains
/// the run by chance are ~2^-64, so the spurious fall-through rate stays near zero while coverage stays
/// high. Anything shorter is not specific enough to clear a file on, so its signature falls through to
/// clamd instead.
pub const MIN_ATOM_LEN: usize = 8;

/// The maximum atom length kept. ClamAV fixed runs reach ~2 KB; the full run `\xNN`-escaped overflows
/// Hyperscan's per-pattern length limit. A bounded contiguous prefix is still a sound necessary
/// condition (an absent 32-byte substring means the full run is absent, so the signature cannot match)
/// and at 32 bytes (specificity ~2^-256) spurious matches stay astronomically unlikely.
pub const ATOM_CAP: usize = 32;

/// A ClamAV file-hash signature, keyed by the digest algorithm (chosen by the hex width in the source:
/// 32 ⇒ MD5, 40 ⇒ SHA1, 64 ⇒ SHA256). `size` is the exact file size the hash applies to, or `None`
/// when the source used `*` (any size). The prefilter computes all three digests over a buffer and
/// looks each up; a hit forces the file to fall through to clamd.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum HashEntry {
    Md5 {
        digest: [u8; 16],
        size: Option<u64>,
        name: String,
    },
    Sha1 {
        digest: [u8; 20],
        size: Option<u64>,
        name: String,
    },
    Sha256 {
        digest: [u8; 32],
        size: Option<u64>,
        name: String,
    },
}

/// A literal anchor extracted from a body signature: the fixed-byte run (capped to `ATOM_CAP`) plus the
/// ClamAV TargetType it belongs to and whether ClamAV matches it case-insensitively. `caseless` atoms
/// come from `.ldb` `::i` subsigs; the prefilter must compile them CASELESS (or treat the signature as
/// unprefilterable) or it would clear a file that differs only in letter case from a real hit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Atom {
    pub bytes: Vec<u8>,
    pub target_type: u32,
    pub caseless: bool,
}

/// The regex body of a PCRE subsig that belongs to a signature the literal-atom logic could not
/// reduce. Captured ADDITIONALLY — it never replaces the sound fall-through the literal logic already
/// emitted. The prefilter compiles it into its matcher (Hyperscan/Vectorscan factors out its own
/// literals), so a file matching none of the compiled regexes is provably clear of them and need not
/// fall through for that target. `pattern` is the raw regex text between the first and last `/` of the
/// subsig's `trigger/regex/flags` form; `target_type` is the signature's ClamAV TargetType so the
/// compiled regex is scanned only against the right target class.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResidualRegex {
    pub pattern: String,
    pub target_type: u32,
}

/// The result of parsing one body-signature file: the usable atoms, and the TargetTypes that must fall
/// through because at least one signature targeting them could not be reduced to a sound atom. A
/// `target_type` present in `fall_through_targets` means "the prefilter cannot prove a file of this
/// target clean — always run clamd for it."
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AtomSet {
    pub atoms: Vec<Atom>,
    /// TargetTypes with at least one unprefilterable signature — the caller must force these to fall
    /// through. A `BTreeSet`-like sorted, de-duplicated vector (kept as `Vec` for plain serde).
    pub fall_through_targets: Vec<u32>,
    /// PCRE regex bodies recovered from signatures the literal logic marked unprefilterable. The
    /// prefilter compiles these so the signature can be matched without forcing its whole target class
    /// to fall through (see [`ResidualRegex`]); each one a signature in `fall_through_targets` falls
    /// out of that set only if the prefilter actually compiles it.
    pub residual_regexes: Vec<ResidualRegex>,
    /// How many signatures could not be prefiltered (a metric the differential gate watches).
    pub unprefilterable: usize,
    /// Non-empty source lines too short to parse even a TargetType (the `< MIN_FIELDS` drop). These
    /// contribute neither an atom nor a fall-through, so a non-trivial count means the parser is
    /// silently uncovering input — the build-time binary fails (or warns) when the aggregate exceeds a
    /// near-zero threshold (fail-loud rather than silently open a hole).
    pub dropped_lines: usize,
}

impl AtomSet {
    fn mark_fall_through(&mut self, target_type: u32) {
        self.unprefilterable += 1;
        self.note_fall_through_target(target_type);
    }

    /// Records that `target_type` must fall through, WITHOUT counting another unprefilterable signature.
    /// Used by the residual path: a signature that yields a residual regex is counted unprefilterable
    /// once, but its target is forced through only if no residual was recovered (the prefilter may still
    /// lift it by compiling the regex), so the fall-through decision is separate from the count.
    fn note_fall_through_target(&mut self, target_type: u32) {
        if let Err(insert_at) = self.fall_through_targets.binary_search(&target_type) {
            self.fall_through_targets.insert(insert_at, target_type);
        }
    }
}

/// The serialized prefilter database the build-time binary writes and the runtime loads: every reusable
/// file-hash signature plus every sound literal atom, and the TargetTypes that must always fall through
/// because some signature targeting them is unprefilterable. `source_versions` records the CVD
/// main/daily versions the atoms were extracted from so a stale DB is detectable.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AtomDb {
    pub hashes: Vec<HashEntry>,
    pub atoms: Vec<Atom>,
    pub fall_through_targets: Vec<u32>,
    /// Every [`ResidualRegex`] folded in from each parsed file. The prefilter compiles these into its
    /// matcher so an unprefilterable PCRE signature need not force its whole target class to fall
    /// through (see [`ResidualRegex`]).
    pub residual_regexes: Vec<ResidualRegex>,
    pub unprefilterable_total: usize,
    /// Aggregate of every `AtomSet::dropped_lines` folded in — non-empty lines the parsers could not
    /// reduce to even a target. The build-time binary fails/warns when this exceeds a near-zero
    /// threshold so a malformed-input regression can never silently uncover signatures.
    pub dropped_lines_total: usize,
    pub source_versions: String,
}

impl AtomDb {
    /// Folds one parsed body-signature file's [`AtomSet`] into the database: appends its atoms, unions
    /// its fall-through TargetTypes (kept sorted and de-duplicated), and accumulates the
    /// unprefilterable and dropped-line counts. The single aggregation point so the build-time binary
    /// cannot forget to carry one of these soundness metrics across files.
    pub fn absorb(&mut self, set: AtomSet) {
        self.atoms.extend(set.atoms);
        for target in set.fall_through_targets {
            if let Err(insert_at) = self.fall_through_targets.binary_search(&target) {
                self.fall_through_targets.insert(insert_at, target);
            }
        }
        self.residual_regexes.extend(set.residual_regexes);
        self.unprefilterable_total += set.unprefilterable;
        self.dropped_lines_total += set.dropped_lines;
    }
}

// ---------------------------------------------------------------------------------------------------
// Hash signatures (.hdb / .hsb)
// ---------------------------------------------------------------------------------------------------

/// Parse a `.hdb`/`.hsb` body. One `hash:size:name` per line; `size` is the exact file size or `*` for
/// any. The algorithm is chosen by the hex width — 32 ⇒ MD5, 40 ⇒ SHA1, 64 ⇒ SHA256 — so `.hdb` (MD5)
/// and `.hsb` (SHA) share one parser. A line whose hash is not one of those widths, or is not valid
/// hex, is skipped: it contributes no entry, so nothing is wrongly cleared, and an unparseable hash is
/// never silently treated as covered.
pub fn parse_hdb(text: &str) -> Vec<HashEntry> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.splitn(3, ':');
        let (Some(hex), Some(size_field), Some(name)) = (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let size = parse_hash_size(size_field);
        match hex.len() {
            32 => {
                if let Some(digest) = parse_hex_fixed::<16>(hex) {
                    out.push(HashEntry::Md5 {
                        digest,
                        size,
                        name: name.to_string(),
                    });
                }
            }
            40 => {
                if let Some(digest) = parse_hex_fixed::<20>(hex) {
                    out.push(HashEntry::Sha1 {
                        digest,
                        size,
                        name: name.to_string(),
                    });
                }
            }
            64 => {
                if let Some(digest) = parse_hex_fixed::<32>(hex) {
                    out.push(HashEntry::Sha256 {
                        digest,
                        size,
                        name: name.to_string(),
                    });
                }
            }
            _ => {}
        }
    }
    out
}

/// `.hsb` is the SHA-hash counterpart of `.hdb` and shares the exact same `hash:size:name` line format;
/// the algorithm is still chosen by hex width, so this is an alias for [`parse_hdb`]. Named separately
/// so callers dispatching by file extension read clearly.
pub fn parse_hsb(text: &str) -> Vec<HashEntry> {
    parse_hdb(text)
}

fn parse_hash_size(field: &str) -> Option<u64> {
    if field == "*" {
        None
    } else {
        field.parse::<u64>().ok()
    }
}

fn parse_hex_fixed<const N: usize>(hex: &str) -> Option<[u8; N]> {
    let bytes = hex.as_bytes();
    if bytes.len() != N * 2 {
        return None;
    }
    let mut out = [0u8; N];
    for (slot, chunk) in out.iter_mut().zip(bytes.chunks_exact(2)) {
        let high = hex_value(chunk[0])?;
        let low = hex_value(chunk[1])?;
        *slot = (high << 4) | low;
    }
    Some(out)
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

// ---------------------------------------------------------------------------------------------------
// The ClamAV body-signature hex tokenizer
// ---------------------------------------------------------------------------------------------------

/// Returns the maximal runs of genuinely-FIXED bytes in a ClamAV body-signature hex string, in order.
/// Every meta-construct breaks the current run — it never contributes bytes:
///
/// - `??` (any byte), `a?` / `?a` (nibble wildcards) — a position that is not a fully-known byte;
/// - `*` (any number of bytes) and `{n}` / `{-n}` / `{n-}` / `{n-m}` / `[n-m]` byte-range jumps;
/// - `(aa|bb|...)` alternates and `!(aa|bb|...)` negated alternates — the matched bytes vary;
/// - `(B)` / `(L)` / `(W)` boundary/anchor tokens — zero-width, not fixed bytes.
///
/// A run is the longest stretch of consecutive `[0-9A-Fa-f][0-9A-Fa-f]` hex pairs uninterrupted by any
/// of the above. Returning every run (not just the longest) lets `.ldb` callers and future multi-anchor
/// strategies choose; `.ndb` keeps the longest. Unrecognized stray characters also break the run, the
/// conservative direction — at worst an atom is shorter or dropped, never lengthened with phantom bytes.
pub fn tokenize_fixed_runs(hex: &str) -> Vec<Vec<u8>> {
    let bytes = hex.as_bytes();
    let mut runs = Vec::new();
    let mut current: Vec<u8> = Vec::new();
    let mut index = 0;

    // Flushes the in-progress run to the output if non-empty, starting a fresh run. Called at every
    // construct boundary so meta-tokens always split, never merge, adjacent fixed runs.
    macro_rules! break_run {
        () => {{
            if !current.is_empty() {
                runs.push(std::mem::take(&mut current));
            }
        }};
    }

    while index < bytes.len() {
        let byte = bytes[index];
        match byte {
            // Whitespace inside a hex body is not standard, but if present it is not a byte — break.
            b' ' | b'\t' | b'\r' | b'\n' => {
                break_run!();
                index += 1;
            }
            // `*` — match any number of bytes.
            b'*' => {
                break_run!();
                index += 1;
            }
            // `{...}` byte-range jump (`{n}`, `{-n}`, `{n-}`, `{n-m}`) — skip to the closing brace.
            b'{' => {
                break_run!();
                index = skip_to(bytes, index + 1, b'}');
            }
            // `[...]` single/multi-byte range jump — skip to the closing bracket.
            b'[' => {
                break_run!();
                index = skip_to(bytes, index + 1, b']');
            }
            // `(...)` constructs: an alternate `(aa|bb)` or a boundary token `(B)`/`(L)`/`(W)`. Either
            // way the bytes are not a single fixed run — skip the whole group.
            b'(' => {
                break_run!();
                index = skip_to(bytes, index + 1, b')');
            }
            // `!(...)` negated alternate — the `!` precedes a group; break and let `(` handling skip it.
            b'!' => {
                break_run!();
                index += 1;
            }
            _ => {
                // ClamAV hex is a stream of nibble-PAIRS: each two characters describe one byte. A pair
                // of full hex digits is a fixed byte; a pair where either nibble is `?` (`??`, `a?`,
                // `?a`) is a wildcard byte — not fixed. Both consume exactly two characters, so the
                // scan stays byte-aligned: skipping a wildcard one character at a time would land the
                // next read on an odd boundary and fabricate a phantom byte from two halves of
                // neighbouring bytes (e.g. `?a55` misread as `a5`).
                if index + 1 < bytes.len() {
                    match (hex_value(bytes[index]), hex_value(bytes[index + 1])) {
                        (Some(high), Some(low)) => {
                            current.push((high << 4) | low);
                            index += 2;
                            continue;
                        }
                        // A nibble-pair with at least one `?` is a wildcard byte: break the run and skip
                        // the whole pair, preserving alignment.
                        _ if bytes[index] == b'?' || bytes[index + 1] == b'?' => {
                            break_run!();
                            index += 2;
                            continue;
                        }
                        _ => {}
                    }
                }
                // An odd trailing nibble or a stray character — break and advance one. The next valid
                // pair starts a fresh run.
                break_run!();
                index += 1;
            }
        }
    }
    break_run!();
    runs
}

// Returns the index just past `close` starting from `from`, or end-of-input if it is never found
// (an unterminated construct conservatively swallows the rest — no phantom fixed bytes leak out).
fn skip_to(bytes: &[u8], from: usize, close: u8) -> usize {
    let mut index = from;
    while index < bytes.len() {
        if bytes[index] == close {
            return index + 1;
        }
        index += 1;
    }
    bytes.len()
}

/// The longest fixed run in a hex body, capped to `ATOM_CAP` bytes, or `None` if no run reaches
/// `MIN_ATOM_LEN`. The cap takes the leading prefix of the run — a sound necessary condition for the
/// whole run.
fn longest_capped_atom(hex: &str) -> Option<Vec<u8>> {
    let mut best = tokenize_fixed_runs(hex)
        .into_iter()
        .max_by_key(|run| run.len())?;
    if best.len() < MIN_ATOM_LEN {
        return None;
    }
    best.truncate(ATOM_CAP);
    Some(best)
}

// ---------------------------------------------------------------------------------------------------
// .ndb extended signatures
// ---------------------------------------------------------------------------------------------------

/// Parse a `.ndb` body. Each line is `Name:Target:Offset:Hex[:min_flevel[:max_flevel]]`. The hex body
/// is field index 3 ONLY — the optional trailing `min_flevel`/`max_flevel` fields must be ignored, not
/// folded into the hex (folding them in poisons the atom with engine-level digits). The longest fixed
/// run of the hex (capped to `ATOM_CAP`) is the atom; a signature whose longest run is shorter than
/// `MIN_ATOM_LEN` is unprefilterable and forces its TargetType to fall through, so it is never silently
/// uncovered. The TargetType is carried on each atom so it is matched only against the right target.
pub fn parse_ndb(text: &str) -> AtomSet {
    let mut set = AtomSet::default();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // Split into fields; the hex is field [3] exactly, ignoring any trailing flevel fields.
        let fields: Vec<&str> = line.split(':').collect();
        if fields.len() < 4 {
            // Malformed: no hex body. If the TargetType (field [1]) is still parseable, prefer a
            // fall-through for that class over a silent drop — a short line must never leave a target
            // silently uncovered. Otherwise count it so the build can fail loud.
            if let Some(target) = fields.get(1).and_then(|field| field.parse::<u32>().ok()) {
                set.mark_fall_through(target);
            } else {
                set.dropped_lines += 1;
            }
            continue;
        }
        let target_type = fields[1].parse::<u32>().unwrap_or(0);
        let hex = fields[3];
        match longest_capped_atom(hex) {
            Some(bytes) => set.atoms.push(Atom {
                bytes,
                target_type,
                caseless: false,
            }),
            None => set.mark_fall_through(target_type),
        }
    }
    set
}

// ---------------------------------------------------------------------------------------------------
// .ldb logical signatures
// ---------------------------------------------------------------------------------------------------

/// Parse a `.ldb` body. Each line is `Name;TargetDescriptionBlock;LogicalExpression;Sub0;Sub1;...`.
///
/// A logical signature fires when its LogicalExpression (field index 2) evaluates true over its
/// subsignatures, so prefiltering it soundly means proving a necessary condition from the expression's
/// *structure*, not from any single subsig in isolation. The rule is ALL-OR-FALL-THROUGH:
///
///   Prefilter the signature ONLY when BOTH hold —
///     (a) the LogicalExpression is a PURE POSITIVE CONJUNCTION of subsig indices: it contains `&`
///         and decimal indices only, with NO `|` (OR), NO count/match operators `=`/`<`/`>` (which
///         include the `A=0` negation), and no other syntax; AND
///     (b) EVERY subsig the expression references reduces to a sound literal atom.
///   Then each referenced subsig's atom is a necessary condition for the whole signature (an AND means
///   every conjunct must match, so any one missing ⇒ the signature cannot fire), and emitting all of
///   them is sound.
///
/// Otherwise — an OR anywhere (a missing atom no longer proves non-match), any count/negation operator,
/// parentheses, or any expression form this parser does not recognize, or a referenced subsig that is
/// not a pure literal — emit NO atoms for the signature and force its TargetType to fall through.
/// Unrecognized expressions fail CLOSED: a form we cannot prove safe is treated as unprefilterable.
///
/// Per subsig the parser detects: an offset prefix (`>>n:` / `<<n:` / `EOF-n:` / `EP+n:` / `S<x>+n:` /
/// `SE<x>:` / `SL+n:` / `VI:` / a bare numeric `n:`), inline modifiers (`::i` case-insensitive ⇒ the
/// atom is marked CASELESS; `::w` wide and other modifiers ⇒ not a plain literal we can anchor), and
/// non-literal subsig types (PCRE `Trigger/regex/[flags]`, byte_compare `(x#a#b)`, macro
/// `${min-max}id$`, fuzzy image `fuzzy_img#...`).
pub fn parse_ldb(text: &str) -> AtomSet {
    let mut set = AtomSet::default();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.split(';').collect();
        if fields.len() < 4 {
            // Too few fields to hold a hex body. Field [1] (the TargetDescriptionBlock) may still
            // carry a parseable Target — prefer a fall-through for that target class over a silent
            // drop, so a malformed line never silently uncovers a target. If even the target is
            // missing, count the dropped line so the build can fail loud.
            if fields.len() >= 2 {
                set.mark_fall_through(parse_ldb_target(fields[1]));
            } else {
                set.dropped_lines += 1;
            }
            continue;
        }
        let target_type = parse_ldb_target(fields[1]);
        let subsigs = &fields[3..];

        // Field [2] is the LogicalExpression. The signature is prefilterable only if it is a pure
        // positive conjunction; otherwise fall through immediately (fail-closed).
        let Some(indices) = conjunction_indices(fields[2]) else {
            // Not a pure positive conjunction (OR / count / negation): NO single subsig is a necessary
            // condition of a match, so the signature cannot be soundly lifted by any subset of its
            // subsigs — force the whole target class through (fail-closed). Lifting an OR via one branch's
            // residual would clear files that match a DIFFERENT branch (a false-clean), so the residual
            // is recorded for metrics/visibility but never defers the fall-through here.
            set.mark_fall_through(target_type);
            collect_residual_regexes(subsigs, target_type, &mut set.residual_regexes);
            continue;
        };

        let mut sig_atoms = Vec::with_capacity(indices.len());
        let mut all_prefilterable = true;
        for index in &indices {
            // An index out of range of the present subsigs is malformed — fail closed.
            let Some(sub) = subsigs.get(*index) else {
                all_prefilterable = false;
                break;
            };
            match subsig_atom(sub, target_type) {
                Some(atom) => sig_atoms.push(atom),
                None => {
                    all_prefilterable = false;
                    break;
                }
            }
        }

        if all_prefilterable && !sig_atoms.is_empty() {
            set.atoms.extend(sig_atoms);
        } else {
            // Fail-closed: force the whole target class through. The residual regexes are recorded for
            // visibility, but C11 lifting (deferring this fall-through when a residual soundly covers the
            // signature) requires necessity analysis over the logical expression (conjunction-only, and
            // only from referenced subsigs) — a dedicated, separately-verified step, not done here.
            set.mark_fall_through(target_type);
            collect_residual_regexes(subsigs, target_type, &mut set.residual_regexes);
        }
    }
    set
}

/// Appends the regex body of every PCRE subsig in `subsigs` to `out`, tagged with `target_type`. A
/// PCRE subsig is `trigger/regex/[flags]`: the trigger is a numeric subsig-index expression, the regex
/// body is the text between the FIRST and LAST `/`, and the trailing token after the last `/` is the
/// flags. Capturing the body (not the trigger or flags) hands the prefilter exactly the pattern ClamAV
/// would run; an offset prefix (`>>n:` etc.) before the trigger is stripped first so it is not mistaken
/// for regex text. A subsig with no `/` (a literal, byte_compare, macro, or fuzzy hash) yields nothing.
fn collect_residual_regexes(subsigs: &[&str], target_type: u32, out: &mut Vec<ResidualRegex>) {
    for subsig in subsigs {
        if let Some(pattern) = pcre_regex_body(subsig) {
            if !pattern.is_empty() {
                out.push(ResidualRegex {
                    pattern: pattern.to_string(),
                    target_type,
                });
            }
        }
    }
}

/// Returns the regex body of a PCRE subsig (`trigger/regex/flags`), or `None` if the subsig is not a
/// PCRE. The body is delimited by the FIRST `/` (closing the trigger) and the LAST `/` (opening the
/// flags), so a `/` inside the regex (an escaped `\/` or a character class) stays in the body. byte_compare
/// `(...)`, macro `${...}$`, and fuzzy `fuzzy_img#...` subsigs are not PCREs even if they contain a `/`.
fn pcre_regex_body(subsig: &str) -> Option<&str> {
    // A leading offset prefix would otherwise put `>>4:` (with its `:`) ahead of the trigger; strip it
    // so the trigger/regex/flags split is clean. The offset stripper is a no-op when no prefix is present.
    let body = strip_offset_prefix(subsig);
    if body.starts_with('(') || body.starts_with("${") || body.starts_with("fuzzy_img#") {
        return None;
    }
    let first = body.find('/')?;
    let last = body.rfind('/')?;
    if last <= first {
        return None;
    }
    Some(&body[first + 1..last])
}

/// Parses a LogicalExpression and returns the de-duplicated subsig indices it references IF it is a
/// pure positive conjunction (`&`-joined decimal indices, e.g. `0`, `0&1`, `2&0&1`), else `None`.
///
/// `None` covers every non-conjunction form — fail-closed:
/// - `|` (OR) anywhere — a missing atom no longer proves non-match;
/// - `=`, `<`, `>` count/match operators (which include the `A=0` negation);
/// - parentheses (grouping can hide an OR or a count operator);
/// - empty operands (`0&`, `&1`, `0&&1`) or any non-digit character — malformed/unrecognized.
fn conjunction_indices(expression: &str) -> Option<Vec<usize>> {
    let expression = expression.trim();
    if expression.is_empty() {
        return None;
    }
    // Any operator or grouping other than `&` disqualifies the expression.
    if expression
        .bytes()
        .any(|byte| matches!(byte, b'|' | b'=' | b'<' | b'>' | b'(' | b')'))
    {
        return None;
    }
    let mut indices = Vec::new();
    for operand in expression.split('&') {
        if operand.is_empty() || !operand.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        let index = operand.parse::<usize>().ok()?;
        if !indices.contains(&index) {
            indices.push(index);
        }
    }
    Some(indices)
}

/// Reads `Target:N` out of a TargetDescriptionBlock (`Engine:X-Y,Target:0,FileSize:...`). Absent or
/// unparseable ⇒ TargetType 0 (ANY), the most conservative assumption (a TargetType-0 signature applies
/// to every file, so erring toward 0 never narrows a fall-through).
fn parse_ldb_target(block: &str) -> u32 {
    for pair in block.split(',') {
        if let Some(value) = pair.strip_prefix("Target:") {
            return value.trim().parse::<u32>().unwrap_or(0);
        }
    }
    0
}

/// Extracts a sound atom from a single `.ldb` subsignature, or `None` if the subsig is not a pure
/// anchorable literal. Strips a leading offset prefix, rejects non-literal subsig types, and honors the
/// `::i` (caseless) / `::w` (wide) inline modifiers.
fn subsig_atom(subsig: &str, target_type: u32) -> Option<Atom> {
    // Byte_compare `(...)`, macro `${...}$`, and fuzzy image hashes are not literal byte patterns.
    if subsig.starts_with('(') || subsig.starts_with("${") || subsig.starts_with("fuzzy_img#") {
        return None;
    }

    // Split off inline modifiers (after `::`) FIRST, before any offset-prefix handling — the `::` colons
    // would otherwise be mistaken for an offset-prefix `:` boundary (an all-digit literal like
    // `1122334455667788::i` looks like a numeric offset up to the first colon). `::i` ⇒ caseless
    // literal; `::w` (wide), `::f`, `::a`, combinations ⇒ not a raw-byte literal we can anchor soundly.
    let (without_modifiers, caseless) = match subsig.split_once("::") {
        Some((literal, modifiers)) => {
            if !modifiers.is_empty() && modifiers.chars().all(|modifier| modifier == 'i') {
                (literal, true)
            } else {
                return None;
            }
        }
        None => (subsig, false),
    };

    // Strip a leading offset prefix: `>>n:`, `<<n:`, `EOF-n:`, or a bare numeric `n:`. The prefix ends
    // at the first `:` PROVIDED everything before it is a recognized offset token — a `:` inside the
    // body proper does not occur (subsig fields are `;`-delimited), so the first `:` is the offset
    // boundary when a prefix is present.
    let body = strip_offset_prefix(without_modifiers);

    // Re-apply non-literal detection to the offset-stripped body. An offset prefix (e.g. `>>4:`) can hide
    // a byte_compare `(...#...#...)`, a macro `${min-max}id$`, or a fuzzy hash `fuzzy_img#...` from the
    // raw-subsig check above, leaving the stripped body to fabricate a phantom fixed run. `#` (byte_compare
    // and fuzzy field separators) and `$` (macro terminator) never appear in an on-disk hex literal, so any
    // residual marker means these bytes are not a soundly-anchorable literal — fail closed.
    if body.contains('#') || body.contains('$') {
        return None;
    }

    // A PCRE subsig is `Trigger/regex/[flags]` — its body contains a `/` delimiting the regex. Detect
    // the regex delimiter and reject: a regex is not a fixed literal.
    if is_pcre(body) {
        return None;
    }

    let bytes = longest_capped_atom(body)?;
    Some(Atom {
        bytes,
        target_type,
        caseless,
    })
}

// A PCRE subsig body carries a `/regex/flags` delimiter. The leading token before the first `/` is the
// numeric trigger expression (subsig indices + logical ops, e.g. `0&1`); the `/` opens the regex. Any
// unescaped `/` marks a regex subsig — which is never a pure literal.
fn is_pcre(body: &str) -> bool {
    body.contains('/')
}

// Strips a leading ClamAV subsig offset prefix and returns the pattern body. Recognized prefixes are
// the section/anchor-relative forms (`>>n`, `<<n`, `EOF-n`, `EP+n`/`EP-n`, `S<x>+n`/`S<x>` section,
// `SE<x>`, `SL+n`/`SL-n`, `VI`) and a bare numeric `n` (also `n,m:` floating offsets), each followed by
// `:`. If the leading token up to the first `:` is one of those forms, the body is what follows;
// otherwise the whole subsig is the body (no prefix). Recognizing every anchor form matters: an
// unrecognized prefix would leave the offset digits in the body, where the tokenizer could fabricate a
// phantom fixed run from them.
fn strip_offset_prefix(subsig: &str) -> &str {
    let Some(colon) = subsig.find(':') else {
        return subsig;
    };
    let (prefix, rest) = subsig.split_at(colon);
    let rest = &rest[1..]; // drop the ':'
    if is_offset_token(prefix) {
        rest
    } else {
        subsig
    }
}

// True when `token` is a ClamAV subsig offset specifier. The recognized anchored forms (per the
// ClamAV logical-signature offset grammar) are:
//   `>>n` / `<<n`   floating between two patterns,
//   `EOF-n`         relative to end of file,
//   `EP+n` / `EP-n` relative to the PE entry point,
//   `S<x>+n` / `S<x>`   relative to the start of section <x> (e.g. `S2`, `S2+78`),
//   `SE<x>`         relative to the end of section <x>,
//   `SL+n` / `SL-n` relative to the last section,
//   `VI`            version-information metadata anchor,
// plus a bare absolute offset `n` (optionally a floating `n,maxshift`).
//
// A hex pattern body is an even-length run of hex digits and meta-constructs and never begins with
// `>>`/`<<`/`E`/`S`/`V` followed by an offset shape, so these tokens are unambiguously offsets. Every
// form must be recognized: an offset whose digits leak into the body could be tokenized into a phantom
// fixed run, the exact false-clean this guards against.
fn is_offset_token(token: &str) -> bool {
    if token.is_empty() {
        return false;
    }
    // Floating, EOF-relative, entry-point-relative, and version-info anchors.
    if token.starts_with(">>")
        || token.starts_with("<<")
        || token.starts_with("EOF")
        || token.starts_with("EP")
        || token == "VI"
    {
        return true;
    }
    // Section anchors: `S<x>[+/-n]`, `SE<x>`, `SL[+/-n]`. The leading `S` (not part of any hex pattern
    // body, which is all hex pairs) followed by a section/last/end shape marks an offset.
    if let Some(rest) = token.strip_prefix('S') {
        if rest.starts_with('E')
            || rest.starts_with('L')
            || rest.starts_with(|c: char| c.is_ascii_digit())
        {
            return true;
        }
    }
    // A bare absolute or floating offset: digits, with an optional single `,maxshift`.
    let core = token.split_once(',').map(|(head, _)| head).unwrap_or(token);
    !core.is_empty() && core.bytes().all(|byte| byte.is_ascii_digit())
}

// ---------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // --- tokenizer: every meta-construct breaks the run, never contributes bytes ------------------

    #[test]
    fn fixed_only_hex_is_one_run() {
        assert_eq!(
            tokenize_fixed_runs("deadbeef"),
            vec![vec![0xde, 0xad, 0xbe, 0xef]]
        );
    }

    #[test]
    fn single_byte_wildcard_breaks_the_run() {
        // `??` between two runs splits them; the wildcard byte is never absorbed.
        assert_eq!(
            tokenize_fixed_runs("deadbeef??cafebabe"),
            vec![vec![0xde, 0xad, 0xbe, 0xef], vec![0xca, 0xfe, 0xba, 0xbe],]
        );
    }

    #[test]
    fn nibble_wildcards_break_the_run_and_drop_the_half_byte() {
        // `a?` (high nibble known) and `?a` (low nibble known) are NOT fixed bytes — neither nibble
        // leaks into a run. Only the surrounding full pairs survive.
        assert_eq!(
            tokenize_fixed_runs("11223344a?55667788"),
            vec![vec![0x11, 0x22, 0x33, 0x44], vec![0x55, 0x66, 0x77, 0x88],]
        );
        assert_eq!(
            tokenize_fixed_runs("11223344?a55667788"),
            vec![vec![0x11, 0x22, 0x33, 0x44], vec![0x55, 0x66, 0x77, 0x88],]
        );
    }

    #[test]
    fn star_breaks_the_run() {
        assert_eq!(
            tokenize_fixed_runs("aabbccdd*eeff0011"),
            vec![vec![0xaa, 0xbb, 0xcc, 0xdd], vec![0xee, 0xff, 0x00, 0x11],]
        );
    }

    #[test]
    fn byte_ranges_break_the_run() {
        for range in ["{4}", "{-4}", "{4-}", "{2-8}"] {
            let hex = format!("aabbccdd{range}eeff0011");
            assert_eq!(
                tokenize_fixed_runs(&hex),
                vec![vec![0xaa, 0xbb, 0xcc, 0xdd], vec![0xee, 0xff, 0x00, 0x11],],
                "range {range} should break the run"
            );
        }
    }

    #[test]
    fn bracket_range_breaks_the_run() {
        assert_eq!(
            tokenize_fixed_runs("aabbccdd[2-8]eeff0011"),
            vec![vec![0xaa, 0xbb, 0xcc, 0xdd], vec![0xee, 0xff, 0x00, 0x11],]
        );
    }

    #[test]
    fn alternate_breaks_the_run_and_yields_no_phantom_atom() {
        // The crux phantom-atom regression: `(64|65)deadbeef` must NOT yield a run that contains the
        // alternate's bytes (0x64/0x65). Only the trailing fixed run survives.
        let runs = tokenize_fixed_runs("(64|65)deadbeef");
        assert_eq!(runs, vec![vec![0xde, 0xad, 0xbe, 0xef]]);
        assert!(
            !runs
                .iter()
                .any(|run| run.contains(&0x64) || run.contains(&0x65)),
            "alternate bytes must never appear in a fixed run"
        );
    }

    #[test]
    fn negated_alternate_breaks_the_run() {
        let runs = tokenize_fixed_runs("deadbeef!(aa|bb)cafebabe");
        assert_eq!(
            runs,
            vec![vec![0xde, 0xad, 0xbe, 0xef], vec![0xca, 0xfe, 0xba, 0xbe],]
        );
        // Neither the `!`, the alternate bytes, nor the boundary leak into a run.
        assert!(!runs
            .iter()
            .any(|run| run.contains(&0xaa) || run.contains(&0xbb)));
    }

    #[test]
    fn boundary_tokens_break_the_run() {
        for token in ["(B)", "(L)", "(W)"] {
            let hex = format!("deadbeef{token}cafebabe");
            assert_eq!(
                tokenize_fixed_runs(&hex),
                vec![vec![0xde, 0xad, 0xbe, 0xef], vec![0xca, 0xfe, 0xba, 0xbe],],
                "boundary token {token} should break the run, not contribute bytes"
            );
        }
    }

    #[test]
    fn longest_capped_atom_takes_the_longest_run() {
        // Two runs split by a wildcard; the longer one wins.
        let atom = longest_capped_atom("deadbeef??1122334455667788").unwrap();
        assert_eq!(atom, vec![0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);
    }

    #[test]
    fn a_run_shorter_than_min_atom_len_is_rejected() {
        // 7 bytes < MIN_ATOM_LEN (8) ⇒ no atom.
        assert!(longest_capped_atom("11223344556677").is_none());
    }

    #[test]
    fn an_atom_is_capped_to_atom_cap_bytes() {
        // 40 fixed bytes ⇒ capped to the leading 32.
        let hex: String = std::iter::repeat_n("ab", 40).collect();
        let atom = longest_capped_atom(&hex).unwrap();
        assert_eq!(atom.len(), ATOM_CAP);
        assert!(atom.iter().all(|&byte| byte == 0xab));
    }

    // --- .ndb -------------------------------------------------------------------------------------

    #[test]
    fn ndb_extracts_atom_and_carries_target_type() {
        let set = parse_ndb("Sig:1:*:1122334455667788\n");
        assert_eq!(set.atoms.len(), 1);
        assert_eq!(
            set.atoms[0].bytes,
            vec![0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]
        );
        assert_eq!(set.atoms[0].target_type, 1);
        assert!(!set.atoms[0].caseless);
        assert!(set.fall_through_targets.is_empty());
    }

    #[test]
    fn ndb_ignores_trailing_flevel_fields() {
        // Hex is field [3]; the trailing `:60:255` flevel fields must NOT be folded into the hex (that
        // would append `:60:255` digits and poison the atom or merge fields).
        let with_flevel = parse_ndb("Sig:0:*:1122334455667788:60:255\n");
        let without = parse_ndb("Sig:0:*:1122334455667788\n");
        assert_eq!(with_flevel.atoms, without.atoms);
        assert_eq!(
            with_flevel.atoms[0].bytes,
            vec![0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]
        );
    }

    #[test]
    fn ndb_short_run_is_unprefilterable_and_forces_target_fall_through() {
        // No run reaches 8 bytes ⇒ unprefilterable; its TargetType (1) must fall through.
        let set = parse_ndb("Sig:1:*:aa??bb??cc??dd\n");
        assert!(set.atoms.is_empty());
        assert_eq!(set.unprefilterable, 1);
        assert_eq!(set.fall_through_targets, vec![1]);
    }

    #[test]
    fn ndb_no_phantom_atom_from_an_alternate() {
        // `(64|65)` short alternate then a too-short tail ⇒ no sound atom, falls through. Critically the
        // atom set must NOT contain the alternate bytes.
        let set = parse_ndb("Sig:0:*:(64|65)1122\n");
        assert!(
            set.atoms.is_empty(),
            "an alternate must not become a phantom atom"
        );
        assert_eq!(set.fall_through_targets, vec![0]);
    }

    #[test]
    fn ndb_short_line_with_a_target_falls_through_not_dropped() {
        // `Sig:1:*` has only 3 fields (no hex), but its TargetType (1) is parseable — prefer a
        // fall-through for that class over a silent drop.
        let set = parse_ndb("Sig:1:*\n");
        assert!(set.atoms.is_empty());
        assert_eq!(set.fall_through_targets, vec![1]);
        assert_eq!(set.dropped_lines, 0);
    }

    #[test]
    fn ndb_unparseable_short_line_is_counted_as_dropped() {
        // A single-field non-empty line carries no parseable TargetType — it is surfaced as a dropped
        // line so the build can fail loud, never silently uncovering input.
        let set = parse_ndb("garbage\n");
        assert!(set.atoms.is_empty());
        assert!(set.fall_through_targets.is_empty());
        assert_eq!(set.dropped_lines, 1);
    }

    // --- .ldb -------------------------------------------------------------------------------------

    #[test]
    fn ldb_extracts_atoms_from_literal_subsigs_with_target() {
        let set = parse_ldb("Name;Engine:81-255,Target:6;0&1;1122334455667788;99aabbccddeeff00\n");
        assert_eq!(set.atoms.len(), 2);
        assert!(set.atoms.iter().all(|atom| atom.target_type == 6));
        assert!(set.fall_through_targets.is_empty());
    }

    #[test]
    fn ldb_pcre_subsig_is_not_a_literal() {
        // A PCRE subsig (`Trigger/regex/flags`) yields no atom; with no other anchor the sig falls
        // through.
        let set = parse_ldb("Name;Target:0;0;0/deadbeefcafebabe/g\n");
        assert!(set.atoms.is_empty());
        assert_eq!(set.fall_through_targets, vec![0]);
    }

    #[test]
    fn ldb_byte_compare_subsig_is_not_a_literal() {
        let set = parse_ldb("Name;Target:0;0;0(>>4#hl4#>100)\n");
        assert!(set.atoms.is_empty());
        assert_eq!(set.fall_through_targets, vec![0]);
    }

    #[test]
    fn ldb_macro_subsig_is_not_a_literal() {
        let set = parse_ldb("Name;Target:0;0;${6-7}12$\n");
        assert!(set.atoms.is_empty());
        assert_eq!(set.fall_through_targets, vec![0]);
    }

    #[test]
    fn ldb_fuzzy_image_subsig_is_not_a_literal() {
        let set = parse_ldb("Name;Target:0;0;fuzzy_img#af2ad01ed42993c7#0\n");
        assert!(set.atoms.is_empty());
        assert_eq!(set.fall_through_targets, vec![0]);
    }

    #[test]
    fn ldb_offset_prefixed_macro_does_not_leak_a_phantom_atom() {
        // An offset prefix can hide a non-literal type from the raw-subsig guard; after stripping the
        // `>>4:`, the macro body `${6-7}1122334455667788$` must still be rejected (its trailing hex is a
        // macro-relative offset range, NOT on-disk bytes). Failing to reject = a phantom atom = false-clean.
        let set = parse_ldb("Name;Target:0;0;>>4:${6-7}1122334455667788$\n");
        assert!(
            set.atoms.is_empty(),
            "an offset-prefixed macro must not yield an atom"
        );
        assert_eq!(set.fall_through_targets, vec![0]);
    }

    #[test]
    fn ldb_offset_prefixed_byte_compare_does_not_leak_a_phantom_atom() {
        let set = parse_ldb("Name;Target:0;0;>>4:(0#=#100)1122334455667788\n");
        assert!(
            set.atoms.is_empty(),
            "an offset-prefixed byte_compare must not yield an atom"
        );
        assert_eq!(set.fall_through_targets, vec![0]);
    }

    #[test]
    fn ldb_offset_prefixed_fuzzy_hash_does_not_leak_a_phantom_atom() {
        let set = parse_ldb("Name;Target:0;0;EP+4:fuzzy_img#af2ad01ed42993c7#0\n");
        assert!(
            set.atoms.is_empty(),
            "an offset-prefixed fuzzy hash must not yield an atom"
        );
        assert_eq!(set.fall_through_targets, vec![0]);
    }

    #[test]
    fn ldb_or_expression_falls_through_even_with_a_literal_subsig() {
        // THE false-clean hole this rewrite closes. Expression `0|1` is an OR: the signature fires if
        // subsig 0 (a literal) OR subsig 1 (a PCRE) matches. A file lacking the literal can still match
        // via the PCRE, so the literal is NOT a necessary condition — emitting it would clear files the
        // PCRE branch would catch. The whole signature must fall through.
        let set = parse_ldb("Name;Target:0;0|1;1122334455667788;0/deadbeef/g\n");
        assert!(
            set.atoms.is_empty(),
            "an OR expression must yield no atoms — the literal is not necessary"
        );
        assert_eq!(set.fall_through_targets, vec![0]);
    }

    #[test]
    fn ldb_count_operator_falls_through() {
        // `0<2` is a count/match operator (fewer than 2 hits), not a plain conjunction — fail closed
        // even though subsig 0 is a literal.
        let set = parse_ldb("Name;Target:0;0<2;1122334455667788\n");
        assert!(set.atoms.is_empty());
        assert_eq!(set.fall_through_targets, vec![0]);
    }

    #[test]
    fn ldb_negation_operator_falls_through() {
        // `0=0` is the negation form (subsig 0 must NOT match). A literal whose ABSENCE is required is
        // the opposite of a necessary condition — fail closed.
        let set = parse_ldb("Name;Target:0;0=0;1122334455667788\n");
        assert!(set.atoms.is_empty());
        assert_eq!(set.fall_through_targets, vec![0]);
    }

    #[test]
    fn ldb_parenthesized_count_expression_falls_through() {
        // `(0=0)&1` mixes a count/negation operator and grouping with a conjunction. Parentheses can
        // hide an OR or count, so any `(`/`)` (and any `=`) makes the whole expression unrecognized —
        // fall through even though subsig 1 is a sound literal.
        let set = parse_ldb("Name;Target:0;(0=0)&1;1122334455667788;99aabbccddeeff00\n");
        assert!(set.atoms.is_empty());
        assert_eq!(set.fall_through_targets, vec![0]);
    }

    #[test]
    fn ldb_conjunction_with_all_literal_subsigs_yields_both_atoms() {
        // A pure `0&1` conjunction with two literal subsigs: each is a necessary condition (AND), so
        // both atoms are emitted and nothing falls through.
        let set = parse_ldb("Name;Target:0;0&1;1122334455667788;99aabbccddeeff00\n");
        assert_eq!(set.atoms.len(), 2);
        assert!(set
            .atoms
            .iter()
            .any(|atom| atom.bytes == vec![0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]));
        assert!(set
            .atoms
            .iter()
            .any(|atom| atom.bytes == vec![0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00]));
        assert!(set.fall_through_targets.is_empty());
    }

    #[test]
    fn ldb_with_one_unprefilterable_subsig_falls_through_whole_sig() {
        // A pure conjunction `0&1`, but subsig 1 has no >=8-byte run. The logical AND means the whole
        // signature is unprefilterable: a file matching subsig 0 but not subsig 1 does not fire, yet
        // emitting subsig 0's atom would wrongly treat its presence as proof of a match. No atoms;
        // the TargetType falls through.
        let set = parse_ldb("Name;Target:0;0&1;1122334455667788;aa??bb\n");
        assert!(set.atoms.is_empty());
        assert_eq!(set.unprefilterable, 1);
        assert_eq!(set.fall_through_targets, vec![0]);
    }

    #[test]
    fn ldb_short_line_with_a_target_falls_through_not_dropped() {
        // `Name;Target:6` has only 2 fields (no expression/subsigs), but the TargetDescriptionBlock
        // parses a Target (6) — prefer a fall-through for that class over a silent drop.
        let set = parse_ldb("Name;Engine:81-255,Target:6\n");
        assert!(set.atoms.is_empty());
        assert_eq!(set.fall_through_targets, vec![6]);
        assert_eq!(set.dropped_lines, 0);
    }

    #[test]
    fn ldb_single_field_line_is_counted_as_dropped() {
        // One field, no `;` — no target to fall through on. Surfaced as a dropped line (fail-loud).
        let set = parse_ldb("OnlyAName\n");
        assert!(set.atoms.is_empty());
        assert!(set.fall_through_targets.is_empty());
        assert_eq!(set.dropped_lines, 1);
    }

    #[test]
    fn ldb_conjunction_only_references_named_subsigs() {
        // The expression `0&2` references subsigs 0 and 2 only; subsig 1 (a PCRE) is NOT referenced, so
        // its unprefilterability is irrelevant. Both referenced subsigs are literals ⇒ two atoms.
        let set = parse_ldb("Name;Target:0;0&2;1122334455667788;0/deadbeef/g;99aabbccddeeff00\n");
        assert_eq!(set.atoms.len(), 2);
        assert!(set.fall_through_targets.is_empty());
    }

    #[test]
    fn ldb_case_insensitive_literal_is_marked_caseless() {
        let set = parse_ldb("Name;Target:0;0;1122334455667788::i\n");
        assert_eq!(set.atoms.len(), 1);
        assert!(set.atoms[0].caseless);
    }

    #[test]
    fn ldb_wide_modifier_is_not_an_anchorable_literal() {
        // `::w` (wide) interleaves NUL bytes — the raw run is not the on-disk bytes, so it cannot be
        // soundly anchored as a literal here ⇒ no atom, falls through.
        let set = parse_ldb("Name;Target:0;0;1122334455667788::w\n");
        assert!(set.atoms.is_empty());
        assert_eq!(set.fall_through_targets, vec![0]);
    }

    #[test]
    fn ldb_offset_prefix_is_stripped_before_extraction() {
        // `>>32:` is an offset prefix, not part of the pattern; the atom is the hex after it.
        let set = parse_ldb("Name;Target:0;0;>>32:1122334455667788\n");
        assert_eq!(set.atoms.len(), 1);
        assert_eq!(
            set.atoms[0].bytes,
            vec![0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]
        );
    }

    #[test]
    fn ldb_numeric_offset_prefix_is_stripped() {
        let set = parse_ldb("Name;Target:0;0;512:1122334455667788\n");
        assert_eq!(set.atoms.len(), 1);
        assert_eq!(
            set.atoms[0].bytes,
            vec![0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]
        );
    }

    #[test]
    fn ldb_real_section_and_anchor_offsets_are_stripped() {
        // Every ClamAV subsig anchor form must be recognized as an offset so its digits never enter the
        // tokenizer as a phantom run. Each subsig is `<anchor>:<8-byte literal>`; the atom must equal
        // exactly the post-colon literal.
        let expected = vec![0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88];
        for anchor in [
            "EP+123", "S2+78", "SL+550", "VI", "S0", "SE1", "EOF-16", "EP-8",
        ] {
            let line = format!("Name;Target:0;0;{anchor}:1122334455667788\n");
            let set = parse_ldb(&line);
            assert_eq!(set.atoms.len(), 1, "anchor {anchor} should yield one atom");
            assert_eq!(
                set.atoms[0].bytes, expected,
                "anchor {anchor} must be stripped, leaving exactly the literal — no offset contamination"
            );
        }
    }

    #[test]
    fn offset_token_recognizes_every_anchor_form() {
        for token in [
            ">>32", "<<8", "EOF-16", "EP+123", "EP-8", "S2", "S2+78", "SE1", "SL+550", "SL-4",
            "VI", "512", "512,16",
        ] {
            assert!(is_offset_token(token), "{token} should be an offset token");
        }
        // A hex pattern body containing non-digit hex letters must NOT be mistaken for an offset. (An
        // all-digit token like `1122` is a legitimate bare numeric offset by design — only stripped
        // when followed by `:`, so a colon-less all-numeric pattern body still survives intact.)
        assert!(!is_offset_token("deadbeef"));
        assert!(!is_offset_token("aabbccdd"));
        assert!(!is_offset_token("99aabbccddeeff00"));
    }

    // --- hash signatures --------------------------------------------------------------------------

    #[test]
    fn hdb_parses_md5_by_width() {
        let sigs = parse_hdb("44d88612fea8a8f36de82e1278abb02f:68:Eicar-Test-Signature\n");
        assert_eq!(sigs.len(), 1);
        assert_eq!(
            sigs[0],
            HashEntry::Md5 {
                digest: [
                    0x44, 0xd8, 0x86, 0x12, 0xfe, 0xa8, 0xa8, 0xf3, 0x6d, 0xe8, 0x2e, 0x12, 0x78,
                    0xab, 0xb0, 0x2f
                ],
                size: Some(68),
                name: "Eicar-Test-Signature".to_string(),
            }
        );
    }

    #[test]
    fn hsb_parses_sha1_and_sha256_by_width() {
        // 40 hex ⇒ SHA1, 64 hex ⇒ SHA256.
        let sha1 = "da39a3ee5e6b4b0d3255bfef95601890afd80709";
        let sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        let sigs = parse_hsb(&format!("{sha1}:*:S1\n{sha256}:1024:S256\n"));
        assert_eq!(sigs.len(), 2);
        assert!(matches!(sigs[0], HashEntry::Sha1 { size: None, .. }));
        assert!(matches!(
            sigs[1],
            HashEntry::Sha256 {
                size: Some(1024),
                ..
            }
        ));
    }

    #[test]
    fn hash_wildcard_size_is_none_and_blank_lines_skip() {
        let sigs = parse_hdb("\n5d41402abc4b2a76b9719d911017c592:*:X\n");
        assert_eq!(sigs.len(), 1);
        assert!(matches!(sigs[0], HashEntry::Md5 { size: None, .. }));
    }

    #[test]
    fn hash_with_an_unknown_width_is_skipped() {
        // A 30-hex string matches no known algorithm ⇒ no entry (never silently treated as covered).
        let sigs = parse_hdb("0123456789abcdef0123456789abcd:10:X\n");
        assert!(sigs.is_empty());
    }

    // --- AtomDb round-trip ------------------------------------------------------------------------

    #[test]
    fn atom_db_round_trips_through_serde() {
        let db = AtomDb {
            hashes: vec![
                HashEntry::Md5 {
                    digest: [0x11; 16],
                    size: Some(42),
                    name: "m".to_string(),
                },
                HashEntry::Sha256 {
                    digest: [0x22; 32],
                    size: None,
                    name: "s".to_string(),
                },
            ],
            atoms: vec![Atom {
                bytes: vec![0xde, 0xad, 0xbe, 0xef, 0x00, 0x01, 0x02, 0x03],
                target_type: 1,
                caseless: true,
            }],
            fall_through_targets: vec![0, 6],
            residual_regexes: vec![ResidualRegex {
                pattern: "deadbeef[0-9]{4}".to_string(),
                target_type: 0,
            }],
            unprefilterable_total: 3,
            dropped_lines_total: 2,
            source_versions: "main-62 daily-27000".to_string(),
        };
        let json = serde_json::to_string(&db).unwrap();
        let back: AtomDb = serde_json::from_str(&json).unwrap();
        assert_eq!(db, back);
    }

    #[test]
    fn atom_db_absorb_unions_targets_and_sums_metrics() {
        // Two parsed sets fold into one DB: atoms append, fall-through targets union (sorted/deduped),
        // unprefilterable and dropped-line counts accumulate.
        let mut db = AtomDb::default();
        db.absorb(AtomSet {
            atoms: vec![Atom {
                bytes: vec![0u8; 8],
                target_type: 1,
                caseless: false,
            }],
            fall_through_targets: vec![0, 6],
            residual_regexes: vec![ResidualRegex {
                pattern: "aaaa".to_string(),
                target_type: 0,
            }],
            unprefilterable: 2,
            dropped_lines: 1,
        });
        db.absorb(AtomSet {
            atoms: vec![Atom {
                bytes: vec![1u8; 8],
                target_type: 0,
                caseless: false,
            }],
            fall_through_targets: vec![1, 6],
            residual_regexes: vec![ResidualRegex {
                pattern: "bbbb".to_string(),
                target_type: 1,
            }],
            unprefilterable: 3,
            dropped_lines: 4,
        });
        assert_eq!(db.atoms.len(), 2);
        assert_eq!(db.fall_through_targets, vec![0, 1, 6]);
        assert_eq!(db.residual_regexes.len(), 2);
        assert_eq!(db.unprefilterable_total, 5);
        assert_eq!(db.dropped_lines_total, 5);
    }

    // --- .ldb residual regexes --------------------------------------------------------------------

    #[test]
    fn ldb_pcre_subsig_emits_a_residual_regex_tagged_with_target() {
        // The PCRE sig falls through on the literal path (no atom), AND its regex body is captured so
        // the prefilter can compile it. The body is exactly the text between the first and last `/`.
        let set = parse_ldb("Name;Target:6;0;0/deadbeef[0-9]{4}cafe/g\n");
        assert!(set.atoms.is_empty());
        assert_eq!(set.fall_through_targets, vec![6]);
        assert_eq!(set.residual_regexes.len(), 1);
        assert_eq!(set.residual_regexes[0].pattern, "deadbeef[0-9]{4}cafe");
        assert_eq!(set.residual_regexes[0].target_type, 6);
    }

    #[test]
    fn ldb_residual_regex_body_keeps_an_inner_slash() {
        // A `/` inside the regex (here a literal escaped `\/`) must stay in the body — the body is
        // delimited by the FIRST and LAST `/`, not any interior one. Capturing too little would compile
        // a different (over-permissive or invalid) pattern.
        let set = parse_ldb("Name;Target:0;0;0/ab\\/cd[0-9]+/i\n");
        assert_eq!(set.residual_regexes.len(), 1);
        assert_eq!(set.residual_regexes[0].pattern, "ab\\/cd[0-9]+");
    }

    #[test]
    fn ldb_offset_prefixed_pcre_emits_a_residual_regex() {
        // An offset prefix before the trigger must be stripped, not treated as regex text.
        let set = parse_ldb("Name;Target:0;0;>>4:0/abcd[0-9]+/g\n");
        assert_eq!(set.residual_regexes.len(), 1);
        assert_eq!(set.residual_regexes[0].pattern, "abcd[0-9]+");
    }

    #[test]
    fn ldb_or_expression_with_a_pcre_still_emits_the_residual_regex() {
        // An OR forces the whole sig to fall through on the literal path; the PCRE branch's regex is
        // still recovered so the prefilter can carry it.
        let set = parse_ldb("Name;Target:0;0|1;1122334455667788;0/evil[a-f]{2}/g\n");
        assert!(set.atoms.is_empty());
        assert_eq!(set.fall_through_targets, vec![0]);
        assert_eq!(set.residual_regexes.len(), 1);
        assert_eq!(set.residual_regexes[0].pattern, "evil[a-f]{2}");
    }

    #[test]
    fn ldb_prefilterable_conjunction_emits_no_residual_regex() {
        // A fully prefilterable sig (no fall-through) has no residual regex — the literal atoms cover it.
        let set = parse_ldb("Name;Target:0;0&1;1122334455667788;99aabbccddeeff00\n");
        assert_eq!(set.atoms.len(), 2);
        assert!(set.residual_regexes.is_empty());
    }

    #[test]
    fn ldb_byte_compare_fall_through_emits_no_residual_regex() {
        // A byte_compare subsig contains no `/` regex — it falls through with no residual to compile.
        let set = parse_ldb("Name;Target:0;0;0(>>4#hl4#>100)\n");
        assert!(set.atoms.is_empty());
        assert_eq!(set.fall_through_targets, vec![0]);
        assert!(set.residual_regexes.is_empty());
    }
}
