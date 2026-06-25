//! The SIMD literal+regex prefilter that fronts clamd: it answers one question per file — *can this
//! file be proved clear of every signature the prefilter models?* If yes it returns [`PrefilterOutcome::Clean`]
//! and the file skips libclamav's ~15 MiB/s matcher; if there is the slightest doubt it returns
//! [`PrefilterOutcome::FallThrough`] and clamd scans the file as authority. The only catastrophic error
//! is a FALSE-CLEAN — a file the prefilter clears that clamd would flag — so every ambiguous case fails
//! toward fall-through. clamd remains the verdict authority; the prefilter only ever saves work.
//!
//! It is built from an [`AtomDb`] ([`Prefilter::from_atom_db`]): every sound literal [`Atom`](crate::atoms::Atom)
//! and every recovered [`ResidualRegex`](crate::atoms::ResidualRegex) is compiled into one matcher, and the file-hash signatures into three
//! digest sets. A file falls through when it is a container format we do not yet decompose, when one of
//! its digests is a known hash signature, when its target class is forced to fall through, or when it
//! matches any compiled atom/regex. Otherwise it is clean.
//!
//! ## Matcher backends
//!
//! The literal+regex matching is behind two interchangeable backends that produce identical verdicts:
//!
//! - **portable** (default) — `aho-corasick` for the escaped literals + the `regex` engine for the
//!   residual PCREs. No C toolchain, so the crate and its full test suite build on any dev host.
//! - **`vectorscan`** (the production scan image) — Vectorscan/Hyperscan SIMD literal+regex scanning, the
//!   throughput path. Its `-sys` crate vendors C++ that builds only in the Linux image, so it is an
//!   opt-in cargo feature; the image's build stage turns it on.
//!
//! The soundness rule — escape every literal byte, fail toward fall-through — is enforced identically in
//! both, so a verdict proven on the portable backend holds on Vectorscan.

use crate::atoms::{AtomDb, HashEntry};
use std::collections::HashSet;
use std::sync::Arc;

use md5::Digest as _;

/// The prefilter's answer for one file. `Clean` means the file is provably clear of every modelled
/// signature and may skip clamd; `FallThrough` means clamd must scan it (a hit, a hash match, a
/// forced-fall-through target class, or an undecomposable container). Never a verdict on its own — only
/// a routing decision in front of clamd.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrefilterOutcome {
    Clean,
    FallThrough,
}

/// An error building the prefilter from an [`AtomDb`]. The only failure is the matcher backend refusing
/// to compile the whole pattern set even after every per-pattern fallback has been applied — at which
/// point there is no safe prefilter and the caller must route every file to clamd.
#[derive(Debug)]
pub enum BuildError {
    /// The matcher backend could not compile the assembled pattern database. Carries the backend's
    /// message. The caller treats this as "no prefilter" (every file falls through), never as "clean".
    MatcherCompile(String),
}

impl std::fmt::Display for BuildError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BuildError::MatcherCompile(message) => {
                write!(formatter, "prefilter matcher failed to compile: {message}")
            }
        }
    }
}

impl std::error::Error for BuildError {}

// ClamAV TargetType codes (libclamav `cli_file` / signature `Target:` field). The prefilter maps a
// sniffed content type to one of these to decide whether the file's class is forced to fall through.
// `0` (ANY) applies to every file, so a `0` in `fall_through_targets` forces ALL files through.
const TARGET_ANY: u32 = 0;
const TARGET_PE: u32 = 1;
const TARGET_OLE2: u32 = 2;
const TARGET_HTML: u32 = 3;
const TARGET_MAIL: u32 = 4;
const TARGET_GRAPHICS: u32 = 5;
const TARGET_ELF: u32 = 6;
const TARGET_ASCII: u32 = 7;
const TARGET_PDF: u32 = 10;
const TARGET_FLASH: u32 = 11;
const TARGET_JAVA: u32 = 12;
const TARGET_MACHO: u32 = 9;

/// The compiled prefilter: the literal+regex matcher, the three file-hash digest sets, and the sorted
/// list of TargetTypes that must always fall through. Cheap to share across request threads — the
/// matcher database is behind an `Arc`, and each `verdict` call makes its own short-lived scanner so
/// there is no shared mutable scanner state (Hyperscan requires one scratch per concurrent caller).
pub struct Prefilter {
    matcher: Arc<Matcher>,
    md5_set: HashSet<[u8; 16]>,
    sha1_set: HashSet<[u8; 20]>,
    sha256_set: HashSet<[u8; 32]>,
    // Hash signatures that apply only at an exact file size: `(digest, size)`. Kept separate from the
    // any-size sets so a digest that collides on content but differs in size is honored exactly — a
    // sized signature must NOT fire on a different-sized file, and an any-size one fires on any size.
    md5_sized: HashSet<([u8; 16], u64)>,
    sha1_sized: HashSet<([u8; 20], u64)>,
    sha256_sized: HashSet<([u8; 32], u64)>,
    fall_through_targets: Vec<u32>,
}

impl Prefilter {
    /// Builds the prefilter from a parsed [`AtomDb`]. Compiles every literal [`Atom`](crate::atoms::Atom)
    /// (escaped to a byte-exact pattern, CASELESS when the atom is caseless) and every
    /// [`ResidualRegex`](crate::atoms::ResidualRegex) into one
    /// matcher; a residual regex the backend rejects falls back to its longest literal factor
    /// (`>= MIN_ATOM_LEN`), and if it has none its `target_type` is added to the fall-through set so its
    /// signature is never silently uncovered. Builds the three digest sets from `db.hashes`. Returns
    /// [`BuildError::MatcherCompile`] only if the whole assembled pattern set will not compile.
    pub fn from_atom_db(db: AtomDb) -> Result<Prefilter, BuildError> {
        let mut patterns: Vec<MatcherPattern> = Vec::with_capacity(db.atoms.len());
        // The fall-through set starts from the literal-path fall-throughs the parser already proved, and
        // grows by any residual regex that has neither a compilable form nor a literal factor.
        let mut fall_through_targets = db.fall_through_targets.clone();

        for atom in &db.atoms {
            patterns.push(MatcherPattern::literal(&atom.bytes, atom.caseless));
        }

        // Partition residual regexes into compilable-as-regex vs needing a literal-factor fallback vs
        // (last resort) forcing their target class to fall through.
        for residual in &db.residual_regexes {
            if Matcher::regex_compiles(&residual.pattern) {
                patterns.push(MatcherPattern::regex(residual.pattern.clone()));
            } else if let Some(factor) = longest_literal_factor(&residual.pattern) {
                // The regex would not compile, but a long literal substring is still a necessary
                // condition for it (the regex cannot match without that literal present) — anchor on it.
                patterns.push(MatcherPattern::literal(&factor, false));
            } else {
                // No compilable regex and no usable literal factor: the only safe move is to force this
                // signature's whole target class to fall through.
                insert_sorted(&mut fall_through_targets, residual.target_type);
            }
        }

        let matcher = Matcher::compile(patterns).map_err(BuildError::MatcherCompile)?;

        let mut md5_set = HashSet::new();
        let mut sha1_set = HashSet::new();
        let mut sha256_set = HashSet::new();
        let mut md5_sized = HashSet::new();
        let mut sha1_sized = HashSet::new();
        let mut sha256_sized = HashSet::new();
        for entry in &db.hashes {
            match entry {
                HashEntry::Md5 { digest, size, .. } => match size {
                    Some(size) => {
                        md5_sized.insert((*digest, *size));
                    }
                    None => {
                        md5_set.insert(*digest);
                    }
                },
                HashEntry::Sha1 { digest, size, .. } => match size {
                    Some(size) => {
                        sha1_sized.insert((*digest, *size));
                    }
                    None => {
                        sha1_set.insert(*digest);
                    }
                },
                HashEntry::Sha256 { digest, size, .. } => match size {
                    Some(size) => {
                        sha256_sized.insert((*digest, *size));
                    }
                    None => {
                        sha256_set.insert(*digest);
                    }
                },
            }
        }

        Ok(Prefilter {
            matcher: Arc::new(matcher),
            md5_set,
            sha1_set,
            sha256_set,
            md5_sized,
            sha1_sized,
            sha256_sized,
            fall_through_targets,
        })
    }

    /// The prefilter decision for one file. In order, failing toward fall-through at every step:
    ///
    /// 1. a container/decomposable format clamd unpacks but we do not yet inflate (PDF, OOXML/zip,
    ///    OLE2, archives) ⇒ fall through — scanning the raw, still-compressed bytes could miss malware
    ///    inside, so clamd must open it;
    /// 2. an MD5/SHA1/SHA256 of the file is a known hash signature (respecting its exact-size
    ///    constraint) ⇒ fall through;
    /// 3. the file's target class — or TargetType 0 (ANY) — is in the fall-through set ⇒ fall through;
    /// 4. the file matches any compiled atom or residual regex ⇒ fall through;
    /// 5. otherwise it is provably clear of every modelled signature ⇒ clean.
    pub fn verdict(&self, bytes: &[u8], sniffed_content_type: Option<&str>) -> PrefilterOutcome {
        // (1) Undecomposable container: detected by content magic first (a sniffed type can be wrong or
        // absent), then by the sniffed type. We do not inflate these yet, so they must reach clamd.
        if is_container(bytes, sniffed_content_type) {
            return PrefilterOutcome::FallThrough;
        }

        // (2) File-hash signatures: compute all three digests once and look each up in both the any-size
        // and the exact-size sets.
        let size = bytes.len() as u64;
        let md5: [u8; 16] = md5::Md5::digest(bytes).into();
        if self.md5_set.contains(&md5) || self.md5_sized.contains(&(md5, size)) {
            return PrefilterOutcome::FallThrough;
        }
        let sha1: [u8; 20] = sha1::Sha1::digest(bytes).into();
        if self.sha1_set.contains(&sha1) || self.sha1_sized.contains(&(sha1, size)) {
            return PrefilterOutcome::FallThrough;
        }
        let sha256: [u8; 32] = sha2::Sha256::digest(bytes).into();
        if self.sha256_set.contains(&sha256) || self.sha256_sized.contains(&(sha256, size)) {
            return PrefilterOutcome::FallThrough;
        }

        // (3) Forced-fall-through target class. `map_target_type` returns `TARGET_ANY` only when the type
        // is absent or unrecognized — and then we cannot know which fall-through class the file belongs
        // to, so we must fall through (a clean-looking file could be a PE/OLE2/... whose class is in the
        // fall-through set). A KNOWN type clears unless it — or ANY (0), for ANY-class signatures not
        // liftable into the matcher) — is in the fall-through set.
        let target = map_target_type(sniffed_content_type);
        if target == TARGET_ANY
            || self.fall_through_targets.binary_search(&TARGET_ANY).is_ok()
            || self.fall_through_targets.binary_search(&target).is_ok()
        {
            return PrefilterOutcome::FallThrough;
        }

        // (4) Literal/regex scan. Any hit ⇒ fall through.
        if self.matcher.is_match(bytes) {
            return PrefilterOutcome::FallThrough;
        }

        // (5) Provably clear.
        PrefilterOutcome::Clean
    }
}

/// Maps a sniffed content type to the ClamAV TargetType the prefilter checks against the fall-through
/// set. Conservative: a type that is unknown, absent, or cannot be mapped confidently returns
/// `TARGET_ANY` (0) — and ANY is the universal class, so checking it against the fall-through set is the
/// fail-closed direction (it can only force MORE files through, never fewer). Container types (PDF, zip,
/// OLE2) are mapped too, but the verdict path catches them earlier via [`is_container`].
pub fn map_target_type(content_type: Option<&str>) -> u32 {
    let Some(raw) = content_type else {
        return TARGET_ANY;
    };
    // Normalize: lowercase, drop any `; charset=...` parameter and surrounding whitespace.
    let normalized = raw
        .split(';')
        .next()
        .unwrap_or(raw)
        .trim()
        .to_ascii_lowercase();
    match normalized.as_str() {
        // Executables.
        "application/vnd.microsoft.portable-executable"
        | "application/x-msdownload"
        | "application/x-dosexec"
        | "application/x-msdos-program" => TARGET_PE,
        "application/x-executable" | "application/x-elf" | "application/x-sharedlib" => TARGET_ELF,
        "application/x-mach-binary" => TARGET_MACHO,
        // Legacy Office (OLE2/CFB) and PDF — also containers, caught earlier by `is_container`.
        "application/vnd.ms-office"
        | "application/msword"
        | "application/vnd.ms-excel"
        | "application/vnd.ms-powerpoint"
        | "application/x-ole-storage"
        | "application/x-cfb" => TARGET_OLE2,
        "application/pdf" => TARGET_PDF,
        // Markup / mail / graphics / scripts.
        "text/html" | "application/xhtml+xml" => TARGET_HTML,
        "message/rfc822" | "application/mbox" => TARGET_MAIL,
        "image/jpeg" | "image/png" | "image/gif" | "image/bmp" | "image/tiff" | "image/webp"
        | "image/x-icon" => TARGET_GRAPHICS,
        "application/x-shockwave-flash" => TARGET_FLASH,
        "application/java-vm" | "application/x-java-applet" => TARGET_JAVA,
        "text/plain" => TARGET_ASCII,
        // Anything else: ANY (the universal, fail-closed class).
        _ => TARGET_ANY,
    }
}

/// Whether a file is an undecomposable container clamd would unpack and scan inside — PDF, OOXML/zip,
/// OLE2, or another archive — and which this prefilter does not yet inflate. Detected by content magic
/// first (a sniffed type can be absent or wrong) and then by the sniffed content type as a backstop, so
/// a renamed or mis-sniffed container still falls through rather than being scanned raw. Until real
/// inflation exists, every such file must reach clamd: scanning the still-compressed bytes could miss
/// malware inside a stream or zip entry (a false-clean). Erring toward "is a container" only costs an
/// extra clamd scan, never safety.
pub fn is_container(bytes: &[u8], sniffed_content_type: Option<&str>) -> bool {
    if has_container_magic(bytes) {
        return true;
    }
    let Some(raw) = sniffed_content_type else {
        return false;
    };
    let normalized = raw
        .split(';')
        .next()
        .unwrap_or(raw)
        .trim()
        .to_ascii_lowercase();
    // Any of the container families, by sniffed type. OOXML and modern ODF/iWork are zip-based.
    matches!(
        normalized.as_str(),
        "application/pdf"
            | "application/zip"
            | "application/x-zip-compressed"
            | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            | "application/vnd.oasis.opendocument.text"
            | "application/vnd.oasis.opendocument.spreadsheet"
            | "application/vnd.oasis.opendocument.presentation"
            | "application/epub+zip"
            | "application/java-archive"
            | "application/vnd.ms-office"
            | "application/msword"
            | "application/vnd.ms-excel"
            | "application/vnd.ms-powerpoint"
            | "application/x-ole-storage"
            | "application/x-cfb"
            | "application/x-7z-compressed"
            | "application/x-rar-compressed"
            | "application/vnd.rar"
            | "application/gzip"
            | "application/x-gzip"
            | "application/x-bzip2"
            | "application/x-xz"
            | "application/x-tar"
            | "application/x-cpio"
            | "application/x-iso9660-image"
            | "application/x-archive"
            | "application/x-debian-package"
    )
}

// True when the leading bytes are a container/archive magic clamd would unpack. Conservative — a magic
// that is also a plain file's start (e.g. a PDF that is just text after `%PDF`) still falls through,
// which is the safe direction.
fn has_container_magic(bytes: &[u8]) -> bool {
    const MAGICS: &[&[u8]] = &[
        b"%PDF",                                           // PDF
        b"PK\x03\x04", // zip local file header (OOXML, ODF, jar, epub)
        b"PK\x05\x06", // empty zip end-of-central-directory
        b"PK\x07\x08", // spanned zip
        &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], // OLE2/CFB (legacy Office)
        b"7z\xBC\xAF\x27\x1C", // 7-Zip
        b"Rar!\x1A\x07", // RAR
        &[0x1F, 0x8B], // gzip
        b"BZh",        // bzip2
        &[0xFD, b'7', b'z', b'X', b'Z', 0x00], // xz
        b"ustar",      // tar (offset 257, but a cheap prefix check below)
    ];
    for magic in MAGICS {
        if bytes.len() >= magic.len() && &bytes[..magic.len()] == *magic {
            return true;
        }
    }
    // tar's `ustar` magic sits at offset 257 — check it where it lives.
    if bytes.len() >= 262 && &bytes[257..262] == b"ustar" {
        return true;
    }
    // A polyglot/junk-prefixed zip hides its local-file-header magic behind a stub, but still ends with
    // the End-Of-Central-Directory record (`PK\x05\x06`, or zip64 `PK\x06\x06`) — which is how clamd
    // locates a zip. Probe the tail (EOCD sits within the last 22 bytes + up to a 64 KiB comment) so a
    // prepended stub cannot smuggle a zip past the container gate and get its still-compressed bytes
    // scanned raw.
    let tail = &bytes[bytes.len().saturating_sub(65_557)..];
    tail.windows(4)
        .any(|window| window == b"PK\x05\x06" || window == b"PK\x06\x06")
}

// Inserts `value` into a sorted, de-duplicated vector, keeping it sorted.
fn insert_sorted(sorted: &mut Vec<u32>, value: u32) {
    if let Err(insert_at) = sorted.binary_search(&value) {
        sorted.insert(insert_at, value);
    }
}

/// The shortest literal factor accepted as a fallback anchor for an uncompilable residual regex. Lower
/// than `MIN_ATOM_LEN` (8) because only the handful of regexes that fail to compile reach this path, so a
/// 4-byte necessary substring there adds negligible spurious fall-through while still rescuing a residual
/// (e.g. `pdfmark`, `_objdef`) that would otherwise force its whole target class through.
const MIN_FACTOR_LEN: usize = 4;

/// The longest run of literal bytes in a regex source that the regex requires VERBATIM in every match,
/// or `None`. Used as a fallback anchor when a residual regex will not compile in the matcher: such a
/// literal is a necessary condition (the regex cannot match unless it is present), so anchoring on it is
/// sound — it can only over-match (fall through more), never under-match.
///
/// Soundness guard: a literal run is necessary only if the regex has no alternation and the run is not
/// inside an optional/repeatable group. We therefore REJECT (return `None`) any pattern containing `|`
/// (a branch could match without this literal), or an optional/star group close (`)?`, `)*`, `){0`) — a
/// literal inside such a group is skippable. Fewer factors means more fall-through, the safe direction.
fn longest_literal_factor(pattern: &str) -> Option<Vec<u8>> {
    if pattern.contains('|')
        || pattern.contains(")?")
        || pattern.contains(")*")
        || pattern.contains("){0")
    {
        return None;
    }
    // Regex metacharacters and the escape introducer — each breaks the literal run.
    const META: &[u8] = b"\\^$.|?*+()[]{}/";
    let bytes = pattern.as_bytes();
    let mut best: &[u8] = &[];
    let mut start = 0usize;
    let mut index = 0usize;
    while index <= bytes.len() {
        let is_break = index == bytes.len() || META.contains(&bytes[index]);
        if is_break {
            let run = &bytes[start..index];
            if run.len() > best.len() {
                best = run;
            }
            start = index + 1;
        }
        index += 1;
    }
    if best.len() >= MIN_FACTOR_LEN {
        Some(best.to_vec())
    } else {
        None
    }
}

// Escapes a literal byte run to a regex/Hyperscan source that matches exactly those bytes: every byte
// becomes `\xNN`. Escaping ALL bytes (not just metacharacters) keeps NUL and high bytes safe through a
// `CString`/regex compile and removes any chance a metacharacter or `/` delimiter in the atom changes
// the pattern's meaning — without exact escaping a metacharacter inside an atom would broaden or break
// the pattern, clearing files the real atom would catch. Only the Vectorscan backend escapes (the
// portable backend feeds raw bytes to Aho-Corasick); the test suite exercises it directly.
#[cfg(any(feature = "vectorscan", test))]
fn escape_literal_to_regex(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len() * 4);
    for &byte in bytes {
        out.extend_from_slice(format!("\\x{byte:02x}").as_bytes());
    }
    out
}

// A pattern handed to the matcher backend: either a literal byte run (with a caseless flag) or a raw
// regex source. The backend decides how to compile each.
enum MatcherPattern {
    Literal { bytes: Vec<u8>, caseless: bool },
    Regex(String),
}

impl MatcherPattern {
    fn literal(bytes: &[u8], caseless: bool) -> MatcherPattern {
        MatcherPattern::Literal {
            bytes: bytes.to_vec(),
            caseless,
        }
    }

    fn regex(source: String) -> MatcherPattern {
        MatcherPattern::Regex(source)
    }
}

// ---------------------------------------------------------------------------------------------------
// Matcher backend — portable (default)
// ---------------------------------------------------------------------------------------------------

// The portable matcher: caseless literals and case-sensitive literals each in their own Aho-Corasick
// automaton (Aho-Corasick's case-insensitivity is a per-automaton flag), and the residual regexes in a
// `regex::bytes::RegexSet`. A file matches if any of the three reports a hit. Sound and dependency-light;
// the `vectorscan` feature swaps it for the SIMD engine without changing the verdict.
#[cfg(not(feature = "vectorscan"))]
struct Matcher {
    case_sensitive: Option<aho_corasick::AhoCorasick>,
    caseless: Option<aho_corasick::AhoCorasick>,
    regexes: Option<regex::bytes::RegexSet>,
}

#[cfg(not(feature = "vectorscan"))]
impl Matcher {
    // Whether the `regex` engine can compile this residual regex source as a byte pattern.
    fn regex_compiles(source: &str) -> bool {
        regex::bytes::RegexBuilder::new(source)
            .unicode(false)
            .build()
            .is_ok()
    }

    fn compile(patterns: Vec<MatcherPattern>) -> Result<Matcher, String> {
        let mut case_sensitive_literals: Vec<Vec<u8>> = Vec::new();
        let mut caseless_literals: Vec<Vec<u8>> = Vec::new();
        let mut regex_sources: Vec<String> = Vec::new();
        for pattern in patterns {
            match pattern {
                MatcherPattern::Literal { bytes, caseless } => {
                    if caseless {
                        caseless_literals.push(bytes);
                    } else {
                        case_sensitive_literals.push(bytes);
                    }
                }
                MatcherPattern::Regex(source) => regex_sources.push(source),
            }
        }

        let case_sensitive = if case_sensitive_literals.is_empty() {
            None
        } else {
            Some(
                aho_corasick::AhoCorasick::new(&case_sensitive_literals)
                    .map_err(|error| error.to_string())?,
            )
        };
        let caseless = if caseless_literals.is_empty() {
            None
        } else {
            Some(
                aho_corasick::AhoCorasickBuilder::new()
                    .ascii_case_insensitive(true)
                    .build(&caseless_literals)
                    .map_err(|error| error.to_string())?,
            )
        };
        let regexes = if regex_sources.is_empty() {
            None
        } else {
            // Build each as a non-Unicode byte regex (the residuals already compiled individually via
            // `regex_compiles`); the set scans them together.
            let set = regex::bytes::RegexSetBuilder::new(&regex_sources)
                .unicode(false)
                .build()
                .map_err(|error| error.to_string())?;
            Some(set)
        };

        Ok(Matcher {
            case_sensitive,
            caseless,
            regexes,
        })
    }

    fn is_match(&self, bytes: &[u8]) -> bool {
        if let Some(automaton) = &self.case_sensitive {
            if automaton.is_match(bytes) {
                return true;
            }
        }
        if let Some(automaton) = &self.caseless {
            if automaton.is_match(bytes) {
                return true;
            }
        }
        if let Some(set) = &self.regexes {
            if set.is_match(bytes) {
                return true;
            }
        }
        false
    }
}

// ---------------------------------------------------------------------------------------------------
// Matcher backend — Vectorscan (the production scan image)
// ---------------------------------------------------------------------------------------------------

// The Vectorscan/Hyperscan matcher: every literal (escaped to `\xNN`) and every residual regex is one
// `Pattern` in a single `BlockDatabase`. Each `is_match` call builds its own `BlockScanner` so there is
// no shared scratch across concurrent callers (Hyperscan requires one scratch per caller). The database
// is `Send + Sync`, so the `Prefilter` shares it behind an `Arc`.
#[cfg(feature = "vectorscan")]
struct Matcher {
    database: vectorscan_rs::BlockDatabase,
}

#[cfg(feature = "vectorscan")]
impl Matcher {
    // Whether Vectorscan can compile this residual regex on its own. Compiling it singly partitions the
    // compilable residuals from the ones needing a literal-factor fallback before the whole DB is built.
    fn regex_compiles(source: &str) -> bool {
        let pattern = vectorscan_rs::Pattern::new(
            source.as_bytes().to_vec(),
            vectorscan_rs::Flag::default(),
            None,
        );
        vectorscan_rs::BlockDatabase::new(vec![pattern]).is_ok()
    }

    fn compile(patterns: Vec<MatcherPattern>) -> Result<Matcher, String> {
        let mut compiled: Vec<vectorscan_rs::Pattern> = Vec::with_capacity(patterns.len());
        for (id, pattern) in patterns.into_iter().enumerate() {
            let id = id as u32;
            let compiled_pattern = match pattern {
                MatcherPattern::Literal { bytes, caseless } => {
                    let flags = if caseless {
                        vectorscan_rs::Flag::CASELESS
                    } else {
                        vectorscan_rs::Flag::default()
                    };
                    vectorscan_rs::Pattern::new(escape_literal_to_regex(&bytes), flags, Some(id))
                }
                MatcherPattern::Regex(source) => vectorscan_rs::Pattern::new(
                    source.into_bytes(),
                    vectorscan_rs::Flag::default(),
                    Some(id),
                ),
            };
            compiled.push(compiled_pattern);
        }
        let database =
            vectorscan_rs::BlockDatabase::new(compiled).map_err(|error| error.to_string())?;
        Ok(Matcher { database })
    }

    fn is_match(&self, bytes: &[u8]) -> bool {
        let mut scanner = match vectorscan_rs::BlockScanner::new(&self.database) {
            Ok(scanner) => scanner,
            // A scratch-allocation failure is not a clean proof — fail toward fall-through.
            Err(_) => return true,
        };
        let mut hit = false;
        let outcome = scanner.scan(bytes, |_id, _from, _to, _flags| {
            hit = true;
            vectorscan_rs::Scan::Terminate
        });
        // A scan error is not a clean proof either — fall through.
        outcome.is_err() || hit
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::atoms::{Atom, AtomDb, HashEntry, ResidualRegex};

    // A small prefilter from explicit atoms/regexes/hashes — never the full 256k DB (a unit test must
    // stay fast). Each test builds exactly the patterns it exercises.
    fn build(
        atoms: Vec<Atom>,
        residual_regexes: Vec<ResidualRegex>,
        hashes: Vec<HashEntry>,
        fall_through_targets: Vec<u32>,
    ) -> Prefilter {
        let db = AtomDb {
            hashes,
            atoms,
            fall_through_targets,
            residual_regexes,
            unprefilterable_total: 0,
            dropped_lines_total: 0,
            source_versions: "test".to_string(),
        };
        Prefilter::from_atom_db(db).expect("prefilter should build")
    }

    fn atom(bytes: &[u8], target_type: u32, caseless: bool) -> Atom {
        Atom {
            bytes: bytes.to_vec(),
            target_type,
            caseless,
        }
    }

    // A non-container buffer (plain text — no PDF/zip/OLE magic) so the container guard does not fire and
    // the test exercises the atom/regex/hash legs. `text/plain` maps to a non-zero target.
    const TEXT: Option<&str> = Some("text/plain");

    #[test]
    fn a_clean_non_container_buffer_is_clean() {
        let pf = build(vec![atom(b"MALWAREXYZ", 1, false)], vec![], vec![], vec![]);
        assert_eq!(
            pf.verdict(b"a perfectly ordinary clean legal document body", TEXT),
            PrefilterOutcome::Clean
        );
    }

    #[test]
    fn a_buffer_containing_a_literal_atom_falls_through() {
        let pf = build(vec![atom(b"MALWAREXYZ", 1, false)], vec![], vec![], vec![]);
        assert_eq!(
            pf.verdict(b"prefix...MALWAREXYZ...suffix", TEXT),
            PrefilterOutcome::FallThrough
        );
    }

    #[test]
    fn a_caseless_atom_matches_case_insensitively() {
        let pf = build(vec![atom(b"EvilString", 1, true)], vec![], vec![], vec![]);
        // The buffer differs only in letter case from the atom — a caseless atom must still catch it.
        assert_eq!(
            pf.verdict(b"...EVILSTRING...", TEXT),
            PrefilterOutcome::FallThrough
        );
    }

    #[test]
    fn a_case_sensitive_atom_does_not_match_a_different_case() {
        let pf = build(vec![atom(b"EvilString", 1, false)], vec![], vec![], vec![]);
        assert_eq!(
            pf.verdict(b"...EVILSTRING...", TEXT),
            PrefilterOutcome::Clean
        );
    }

    #[test]
    fn an_atom_with_nul_and_metacharacters_round_trips() {
        // The escape-every-byte rule: an atom containing NUL and regex metacharacters must still match
        // its exact bytes, never be mangled by the compiler.
        let raw = b"\x00abc.*()\xff\x01end";
        let pf = build(vec![atom(raw, 1, false)], vec![], vec![], vec![]);
        let mut buffer = b"junk".to_vec();
        buffer.extend_from_slice(raw);
        buffer.extend_from_slice(b"junk");
        assert_eq!(pf.verdict(&buffer, TEXT), PrefilterOutcome::FallThrough);
        // A buffer with the literal metacharacters but NOT the exact bytes must stay clean.
        assert_eq!(
            pf.verdict(b"abc then anything here end", TEXT),
            PrefilterOutcome::Clean
        );
    }

    #[test]
    fn a_buffer_matching_a_residual_regex_falls_through() {
        let pf = build(
            vec![],
            vec![ResidualRegex {
                pattern: "ev[il]+_payload[0-9]{3}".to_string(),
                target_type: 1,
            }],
            vec![],
            vec![],
        );
        assert_eq!(
            pf.verdict(b"...evill_payload042...", TEXT),
            PrefilterOutcome::FallThrough
        );
        assert_eq!(
            pf.verdict(b"...nothing matching here...", TEXT),
            PrefilterOutcome::Clean
        );
    }

    #[test]
    fn an_uncompilable_residual_regex_falls_back_to_a_literal_factor() {
        // A back-reference (`\1`) is unsupported by the matcher; the regex carries a long literal factor
        // (`pdfmarkblock`) usable as a sound anchor. A buffer containing that factor falls through.
        let pf = build(
            vec![],
            vec![ResidualRegex {
                pattern: "(pdfmarkblock).*\\1".to_string(),
                target_type: 10,
            }],
            vec![],
            vec![],
        );
        assert_eq!(
            pf.verdict(b"...here is pdfmarkblock in the file...", TEXT),
            PrefilterOutcome::FallThrough
        );
        assert_eq!(
            pf.verdict(b"...nothing of interest...", TEXT),
            PrefilterOutcome::Clean
        );
    }

    #[test]
    fn an_uncompilable_residual_regex_with_no_literal_factor_forces_target_fall_through() {
        // A back-reference regex whose only literals are too short (< MIN_ATOM_LEN) has no usable factor:
        // its whole target class must fall through. Here the only literal is `ab` (2 bytes).
        let pf = build(
            vec![],
            vec![ResidualRegex {
                pattern: "(ab).*\\1".to_string(),
                target_type: 7,
            }],
            vec![],
            vec![],
        );
        // A `text/plain` file maps to TargetType 7 (ASCII) — now forced through by the target-7 entry.
        assert_eq!(
            pf.verdict(b"a totally clean ascii file", Some("text/plain")),
            PrefilterOutcome::FallThrough
        );
        // A file of a DIFFERENT class (HTML, TargetType 3) is NOT forced by the target-7 entry, and has
        // no atom/hash to hit — but it IS a markup type, so to be sure it stays clean we sniff it as a
        // graphics image (TargetType 5), which is neither a container nor target 7: it stays clean.
        assert_eq!(
            pf.verdict(b"a totally clean blob", Some("image/png")),
            PrefilterOutcome::Clean
        );
    }

    #[test]
    fn an_md5_hash_hit_falls_through() {
        let body = b"the exact bytes of a known-bad file";
        let digest: [u8; 16] = md5::Md5::digest(body).into();
        let pf = build(
            vec![],
            vec![],
            vec![HashEntry::Md5 {
                digest,
                size: None,
                name: "bad".to_string(),
            }],
            vec![],
        );
        assert_eq!(pf.verdict(body, TEXT), PrefilterOutcome::FallThrough);
        assert_eq!(
            pf.verdict(b"some other unrelated bytes", TEXT),
            PrefilterOutcome::Clean
        );
    }

    #[test]
    fn a_sized_md5_hash_only_fires_at_the_exact_size() {
        let body = b"sized known-bad content";
        let digest: [u8; 16] = md5::Md5::digest(body).into();
        let pf = build(
            vec![],
            vec![],
            vec![HashEntry::Md5 {
                digest,
                size: Some(body.len() as u64),
                name: "bad".to_string(),
            }],
            vec![],
        );
        assert_eq!(pf.verdict(body, TEXT), PrefilterOutcome::FallThrough);
    }

    #[test]
    fn a_sha1_hash_hit_falls_through() {
        let body = b"sha1-known-bad bytes here";
        let digest: [u8; 20] = sha1::Sha1::digest(body).into();
        let pf = build(
            vec![],
            vec![],
            vec![HashEntry::Sha1 {
                digest,
                size: None,
                name: "bad1".to_string(),
            }],
            vec![],
        );
        assert_eq!(pf.verdict(body, TEXT), PrefilterOutcome::FallThrough);
    }

    #[test]
    fn a_sha256_hash_hit_falls_through() {
        let body = b"sha256-known-bad bytes here";
        let digest: [u8; 32] = sha2::Sha256::digest(body).into();
        let pf = build(
            vec![],
            vec![],
            vec![HashEntry::Sha256 {
                digest,
                size: None,
                name: "bad256".to_string(),
            }],
            vec![],
        );
        assert_eq!(pf.verdict(body, TEXT), PrefilterOutcome::FallThrough);
    }

    #[test]
    fn a_pdf_content_type_falls_through() {
        let pf = build(vec![], vec![], vec![], vec![]);
        assert_eq!(
            pf.verdict(b"not really a pdf body", Some("application/pdf")),
            PrefilterOutcome::FallThrough
        );
    }

    #[test]
    fn a_zip_content_type_falls_through() {
        let pf = build(vec![], vec![], vec![], vec![]);
        assert_eq!(
            pf.verdict(b"not really a zip", Some("application/zip")),
            PrefilterOutcome::FallThrough
        );
    }

    #[test]
    fn a_pdf_by_magic_falls_through_even_when_sniffed_type_is_wrong() {
        let pf = build(vec![], vec![], vec![], vec![]);
        let mut body = b"%PDF-1.7".to_vec();
        body.extend_from_slice(b" trailing clean text");
        assert_eq!(
            pf.verdict(&body, Some("text/plain")),
            PrefilterOutcome::FallThrough
        );
    }

    #[test]
    fn a_zip_by_magic_falls_through() {
        let pf = build(vec![], vec![], vec![], vec![]);
        let body = b"PK\x03\x04rest of a zip";
        assert_eq!(pf.verdict(body, None), PrefilterOutcome::FallThrough);
    }

    #[test]
    fn an_ole2_by_magic_falls_through() {
        let pf = build(vec![], vec![], vec![], vec![]);
        let body = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0x00, 0x00];
        assert_eq!(pf.verdict(&body, None), PrefilterOutcome::FallThrough);
    }

    #[test]
    fn a_file_whose_target_type_is_in_fall_through_targets_falls_through() {
        // No atoms, no hashes — but TargetType 1 (PE) is forced through. A PE-sniffed file must fall
        // through even though nothing else flags it.
        let pf = build(vec![], vec![], vec![], vec![1]);
        assert_eq!(
            pf.verdict(
                b"a clean blob sniffed as an executable",
                Some("application/x-dosexec")
            ),
            PrefilterOutcome::FallThrough
        );
        // A text file (TargetType 7) is NOT forced by a PE-only fall-through entry, and has no atom/hash
        // to hit, so it stays clean.
        assert_eq!(
            pf.verdict(b"a clean text file", TEXT),
            PrefilterOutcome::Clean
        );
    }

    #[test]
    fn target_type_zero_any_forces_universal_fall_through() {
        // A `0` (ANY) in the fall-through set must force EVERY file through, regardless of its sniffed
        // type — the fail-safe for an irreducible ANY-type signature that nothing else can model.
        let pf = build(vec![], vec![], vec![], vec![0]);
        assert_eq!(
            pf.verdict(b"a clean text file", TEXT),
            PrefilterOutcome::FallThrough
        );
        assert_eq!(
            pf.verdict(b"a clean blob", Some("image/png")),
            PrefilterOutcome::FallThrough
        );
    }

    #[test]
    fn an_unknown_content_type_maps_to_any() {
        assert_eq!(map_target_type(Some("application/x-made-up")), TARGET_ANY);
        assert_eq!(map_target_type(None), TARGET_ANY);
    }

    #[test]
    fn map_target_type_handles_a_charset_parameter() {
        assert_eq!(
            map_target_type(Some("text/html; charset=utf-8")),
            TARGET_HTML
        );
    }

    #[test]
    fn longest_literal_factor_extracts_the_longest_literal_run() {
        // The longest run between metacharacters wins, and must reach MIN_ATOM_LEN.
        assert_eq!(
            longest_literal_factor("ab(longliteralhere)+cd").unwrap(),
            b"longliteralhere".to_vec()
        );
        // No run reaches MIN_ATOM_LEN (8).
        assert!(longest_literal_factor("a+b+c+def").is_none());
    }

    #[test]
    fn escape_literal_escapes_every_byte() {
        assert_eq!(
            escape_literal_to_regex(&[0x00, 0xff, b'A']),
            b"\\x00\\xff\\x41".to_vec()
        );
    }
}
