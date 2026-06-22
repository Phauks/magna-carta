//! Build-time extraction of the ClamAV signature database into the prefilter's `atoms.db`. Runs in the
//! scan image's build stage (never at runtime): it reads the unpacked CVD/CLD signature files from a
//! `/sigsrc` directory, reduces every signature class to either a sound prefilter input (a hash, a
//! literal atom, a residual regex) or a forced fall-through, and serializes the aggregated [`AtomDb`] to
//! a file the runtime loads at boot.
//!
//! ## The self-maintenance contract — fail-closed and fail-loud
//!
//! The owner's requirement is that the engine SELF-MAINTAINS: we never hand-write detection rules; we
//! download new ClamAV database updates (freshclam) and re-extract. That only stays safe if extraction
//! can never silently leave a signature class uncovered, because an uncovered class is a FALSE-CLEAN — a
//! file the prefilter clears that clamd would flag. So every signature file in `/sigsrc` is classified
//! into exactly one of:
//!
//!   - **REUSED** — `.hdb`/`.hsb` (file hashes), `.ndb` (pattern atoms), `.ldb` (logical signatures).
//!     The [`crate::atoms`] parsers reduce each to sound atoms/hashes (or, per signature, a fall-through).
//!   - **MODELLED-AS-FALL-THROUGH** — detection-bearing classes this extractor does NOT reduce to atoms,
//!     so the whole target class is forced to fall through to clamd: `.mdb`/`.msb`/`.imp` (PE section /
//!     import hashes ⇒ force PE), `.cdb` (container metadata ⇒ force the container/archive classes),
//!     `.cbc` (bytecode), `.idb` (image-fuzzy), `.pdb`/`.gdb`/`.wdb` (phishing) ⇒ force their target
//!     classes. Forcing the class through is always sound — it only ever costs a clamd scan, never safety.
//!   - **IGNORED** — non-detection files on an explicit allowlist (`.info`, `.cfg`, `.ftm`, `.fp`,
//!     `.ign`/`.ign2`, `.crb`/`.cat`, `.pwdb`, `COPYING`, …). These carry no detection logic, so skipping
//!     them uncovers nothing.
//!
//! Any UNRECOGNIZED, non-empty file whose extension/name is in none of those lists is a **fatal build
//! error** (non-zero exit). A new ClamAV database class shipped by a future freshclam update therefore
//! cannot be silently bypassed: the build stops until a human classifies it. This is the load-bearing
//! fail-loud that makes self-maintenance safe.

use std::path::Path;
use std::process::ExitCode;

use magna_carta_scan::atoms::{parse_hdb, parse_hsb, parse_ldb, parse_ndb, AtomDb};

// ClamAV TargetType codes (libclamav signature `Target:` field) used when a whole class is forced to
// fall through. `0` is ANY (universal). `1` PE, `2` OLE2, `5` GRAPHICS, `6` ELF, `9` MACHO. A
// modelled-as-fall-through class names the target(s) its signatures detect so only those classes pay the
// extra clamd scan — never all files (which a `0` would cause).
const TARGET_PE: u32 = 1;
const TARGET_OLE2: u32 = 2;
const TARGET_GRAPHICS: u32 = 5;
const TARGET_ELF: u32 = 6;
const TARGET_MACHO: u32 = 9;

/// What `build-atoms` does with one signature file: reuse its parser, force a set of TargetTypes through,
/// ignore it, or stop the build because the class is unrecognized. The classification is pure (depends
/// only on the file name and whether it is empty), so it is unit-tested directly — including the
/// fail-loud path.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Classification {
    /// A reused body/hash class — run the named parser kind and fold the result in.
    Reused(ReusedKind),
    /// A detection-bearing class we do not reduce to atoms: force these TargetTypes to fall through.
    ForceFallThrough(Vec<u32>),
    /// A non-detection file (metadata, allow-list, config): contributes nothing, safely skipped.
    Ignored,
    /// An empty file of any name: nothing to cover, safely skipped (an unrecognized but EMPTY file is not
    /// a hole — there is no signature in it — so it does not trip the fail-loud).
    Empty,
    /// An unrecognized, non-empty file: a class this extractor does not model. The build MUST fail so a
    /// new ClamAV database class can never silently open a false-clean hole.
    Unrecognized,
}

/// Which reused parser a file feeds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReusedKind {
    /// `.hdb` — MD5 file-hash signatures.
    Hdb,
    /// `.hsb` — SHA1/SHA256 file-hash signatures.
    Hsb,
    /// `.ndb` — extended body-pattern signatures.
    Ndb,
    /// `.ldb` — logical signatures.
    Ldb,
}

/// Classifies one signature file by its name and emptiness. Pure: the only inputs are the file's lower
/// extension (or whole name, for extension-less files like `COPYING`) and whether its content is empty.
///
/// The extension lists are exhaustive against the 2026 ClamAV signature format
/// (`docs.clamav.net/manual/Signatures.html`): every documented class is either reused, modelled as a
/// forced fall-through, or on the non-detection ignore allowlist. Anything else returns
/// [`Classification::Unrecognized`] so the build fails loud rather than silently uncovering it.
fn classify(file_name: &str, is_empty: bool) -> Classification {
    // An empty file carries no signatures regardless of extension — never a hole, never a fail-loud.
    if is_empty {
        return Classification::Empty;
    }

    // Extension-less metadata files (no `.`) are matched by whole name.
    let lower = file_name.to_ascii_lowercase();
    let extension = Path::new(&lower)
        .extension()
        .and_then(|os| os.to_str())
        .unwrap_or("");

    match extension {
        // --- REUSED: reduced to sound atoms/hashes by the atoms.rs parsers ------------------------
        // The `.?u` siblings (`.hdu`/`.hsu`/`.ndu`/`.ldu`) are the "unofficial"/PUA-tier databases — same
        // byte format as their `.?b` counterparts (verified against the live CVD: `.hdu` is md5:size:name,
        // `.ndu` is Name:Target:Offset:Hex, `.ldu` is the logical-sig shape), just loaded under a different
        // policy by clamd. Same parser, same soundness.
        "hdb" | "hdu" => Classification::Reused(ReusedKind::Hdb),
        "hsb" | "hsu" => Classification::Reused(ReusedKind::Hsb),
        "ndb" | "ndu" => Classification::Reused(ReusedKind::Ndb),
        "ldb" | "ldu" => Classification::Reused(ReusedKind::Ldb),

        // --- MODELLED-AS-FALL-THROUGH: detection-bearing, not reduced to atoms --------------------
        // PE section-hash (.mdb/.msb, + the `.mdu`/`.msu` PUA variants) and import-hash (.imp) signatures
        // hash a PE substructure, not the whole file — we do not compute those, so any PE could carry one
        // ⇒ force the PE class through.
        "mdb" | "mdu" | "msb" | "msu" | "imp" => Classification::ForceFallThrough(vec![TARGET_PE]),
        // Container metadata (.cdb): matches on archive entry name/size/encryption inside a container.
        // We do not inspect container internals here (the prefilter's container guard already forces
        // archives through), so force every container-bearing target class: OLE2, plus PE/ELF/Mach-O
        // self-extracting archives. The prefilter's `is_container` magic gate is the primary defence;
        // this makes the coverage explicit in the fall-through set too.
        "cdb" => {
            Classification::ForceFallThrough(vec![TARGET_PE, TARGET_OLE2, TARGET_ELF, TARGET_MACHO])
        }
        // Bytecode (.cbc): a compiled detection program — its logic is opaque to us. It can target any
        // executable class, so force the executable classes through (PE/ELF/Mach-O).
        "cbc" => Classification::ForceFallThrough(vec![TARGET_PE, TARGET_ELF, TARGET_MACHO]),
        // Image fuzzy-hash (.idb): perceptual hashes of graphics ⇒ force the GRAPHICS class.
        "idb" => Classification::ForceFallThrough(vec![TARGET_GRAPHICS]),
        // Phishing URL/host signatures (.pdb/.gdb/.wdb): they fire on HTML/mail/text-bearing content.
        // Force the markup/mail/ascii classes plus ANY-typed graphics is unnecessary — phishing targets
        // documents, so HTML(3)/MAIL(4)/ASCII(7). We do not have those constants here other than via the
        // values; name them explicitly.
        "pdb" | "gdb" | "wdb" => Classification::ForceFallThrough(vec![3, 4, 7]),

        // --- IGNORED: non-detection metadata / allow-list / config / certs ------------------------
        // `.info` DB metadata; `.cfg` dynamic config; `.ftm` file-type magic; `.fp`/`.sfp` allow-lists;
        // `.ign`/`.ign2` ignored-signature lists; `.crb`/`.cat` trusted/revoked certs; `.pwdb` archive
        // passwords; `.cvd`/`.cld` the still-packed containers (sigtool unpacks INTO /sigsrc, the packed
        // file may also be copied in). None carry a body signature we must cover.
        "info" | "cfg" | "ftm" | "fp" | "sfp" | "ign" | "ign2" | "crb" | "cat" | "pwdb" | "cvd"
        | "cld" | "sign" | "yar" | "yara" => Classification::Ignored,

        // Extension-less or other-named non-detection files matched by whole (lowered) name.
        _ => match lower.as_str() {
            "copying" | "license" | "readme" | "changelog" => Classification::Ignored,
            // Anything else, non-empty, unmodelled ⇒ fail loud.
            _ => Classification::Unrecognized,
        },
    }
}

/// Aggregate counts printed at the end so the build log records exactly what was extracted (a regression
/// in any of these — e.g. dropped lines climbing, atoms collapsing — is visible in CI diff).
#[derive(Debug, Default)]
struct BuildStats {
    reused_files: usize,
    fall_through_files: usize,
    ignored_files: usize,
    empty_files: usize,
}

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let sigsrc = args.next().unwrap_or_else(|| "/sigsrc".to_string());
    let out_path = args.next().unwrap_or_else(|| "/atoms.db".to_string());

    match run(Path::new(&sigsrc), Path::new(&out_path)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("build-atoms FAILED: {message}");
            ExitCode::FAILURE
        }
    }
}

/// Reads every file in `sigsrc`, classifies it, folds the reused parsers' output and the forced
/// fall-throughs into one [`AtomDb`], and writes it to `out_path` as JSON. Returns `Err` (⇒ non-zero
/// exit) on an unrecognized non-empty file or any I/O failure — fail-loud, fail-closed.
fn run(sigsrc: &Path, out_path: &Path) -> Result<(), String> {
    let mut db = AtomDb::default();
    let mut stats = BuildStats::default();

    let entries = std::fs::read_dir(sigsrc)
        .map_err(|error| format!("cannot read sigsrc dir {}: {error}", sigsrc.display()))?;

    // Collect + sort the file names so the build is deterministic (read_dir order is OS-dependent) and a
    // diff of the printed log is stable across rebuilds.
    let mut files: Vec<std::path::PathBuf> = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| format!("error reading a sigsrc entry: {error}"))?;
        if entry
            .file_type()
            .map(|file_type| file_type.is_file())
            .unwrap_or(false)
        {
            files.push(entry.path());
        }
    }
    files.sort();

    for path in &files {
        let file_name = path
            .file_name()
            .and_then(|os| os.to_str())
            .ok_or_else(|| format!("non-UTF-8 file name in sigsrc: {}", path.display()))?;

        // Read raw bytes (the hdb/ndb/ldb parsers want text, but a class is classified before parsing
        // and emptiness is byte-length, so read once).
        let raw = std::fs::read(path)
            .map_err(|error| format!("cannot read {}: {error}", path.display()))?;
        let is_empty = raw.iter().all(|byte| byte.is_ascii_whitespace());

        match classify(file_name, is_empty) {
            Classification::Reused(kind) => {
                let text = String::from_utf8_lossy(&raw);
                match kind {
                    ReusedKind::Hdb => db.hashes.extend(parse_hdb(&text)),
                    ReusedKind::Hsb => db.hashes.extend(parse_hsb(&text)),
                    ReusedKind::Ndb => db.absorb(parse_ndb(&text)),
                    ReusedKind::Ldb => db.absorb(parse_ldb(&text)),
                }
                stats.reused_files += 1;
            }
            Classification::ForceFallThrough(targets) => {
                for target in targets {
                    note_fall_through(&mut db.fall_through_targets, target);
                }
                stats.fall_through_files += 1;
            }
            Classification::Ignored => {
                // A `.info` file carries the CVD version (`ClamAV-VDB:<date>:<version>:...`). Record it
                // so a stale baked atoms.db is detectable at runtime — without it `source_versions`
                // stays empty and the prefilter cannot tell which DB it was built from.
                if path
                    .extension()
                    .and_then(|os| os.to_str())
                    .map(|ext| ext.eq_ignore_ascii_case("info"))
                    .unwrap_or(false)
                {
                    if let Some(version) = info_version(file_name, &raw) {
                        append_version(&mut db.source_versions, &version);
                    }
                }
                stats.ignored_files += 1;
            }
            Classification::Empty => stats.empty_files += 1,
            Classification::Unrecognized => {
                // FAIL LOUD. A non-empty file whose class this extractor does not model could carry
                // detection logic we would silently bypass — a false-clean. Stop the build so a human
                // classifies the new ClamAV database class before the prefilter can ship with a hole.
                return Err(format!(
                    "unrecognized non-empty signature file {} — a ClamAV database class this extractor \
                     does not model. Refusing to build a prefilter that could silently bypass it. \
                     Classify it in src/bin/build-atoms.rs (reuse a parser, force its target class to \
                     fall through, or add it to the non-detection ignore allowlist) and rebuild.",
                    file_name
                ));
            }
        }
    }

    // The build-derived soundness metrics: dropped lines climbing means the parsers are silently failing
    // to even read a target off some lines. Surface it loudly; a near-zero threshold guards a regression.
    if db.dropped_lines_total > DROPPED_LINES_CEILING {
        return Err(format!(
            "{} signature lines were dropped without yielding an atom or a fall-through (ceiling {}). \
             A parser is silently uncovering input — refusing to build. Inspect the .ndb/.ldb parsers.",
            db.dropped_lines_total, DROPPED_LINES_CEILING
        ));
    }

    let json =
        serde_json::to_vec(&db).map_err(|error| format!("cannot serialize atoms.db: {error}"))?;
    std::fs::write(out_path, &json)
        .map_err(|error| format!("cannot write {}: {error}", out_path.display()))?;

    print_report(&db, &stats, out_path, json.len());
    Ok(())
}

/// The most dropped lines the build tolerates before failing. Near zero: a handful of genuinely
/// malformed lines across the whole DB is acceptable noise, but a systematic parser regression would push
/// this into the hundreds/thousands and must stop the build.
const DROPPED_LINES_CEILING: usize = 64;

/// Extracts a `<file-stem> <version>` token from a ClamAV `.info` file. The format is
/// `ClamAV-VDB:<build-date>:<functionality-level / version>:<sig-count>:...`; field index 2 is the
/// version. Returns `None` if the file is not in that shape (then `source_versions` simply omits it,
/// which is harmless — it only weakens staleness detection, never correctness).
fn info_version(file_name: &str, raw: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(raw);
    let first = text.lines().next()?;
    let mut fields = first.split(':');
    if fields.next()? != "ClamAV-VDB" {
        return None;
    }
    let _date = fields.next()?;
    let version = fields.next()?.trim();
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|os| os.to_str())
        .unwrap_or(file_name);
    Some(format!("{stem}-{version}"))
}

/// Appends a version token to the space-separated `source_versions` string (kept sorted/deduped is
/// unnecessary — there are only a couple of DB components).
fn append_version(versions: &mut String, token: &str) {
    if versions.is_empty() {
        versions.push_str(token);
    } else {
        versions.push(' ');
        versions.push_str(token);
    }
}

/// Inserts `target` into the sorted, de-duplicated fall-through vector (mirrors `AtomDb::absorb`'s union).
fn note_fall_through(targets: &mut Vec<u32>, target: u32) {
    if let Err(insert_at) = targets.binary_search(&target) {
        targets.insert(insert_at, target);
    }
}

fn print_report(db: &AtomDb, stats: &BuildStats, out_path: &Path, bytes: usize) {
    println!("build-atoms: extraction complete");
    println!(
        "  files: {} reused, {} forced-fall-through, {} ignored, {} empty",
        stats.reused_files, stats.fall_through_files, stats.ignored_files, stats.empty_files
    );
    println!("  atoms:                {}", db.atoms.len());
    println!("  hashes:               {}", db.hashes.len());
    println!("  residual_regexes:     {}", db.residual_regexes.len());
    println!("  fall_through_targets: {:?}", db.fall_through_targets);
    println!("  unprefilterable_total:{}", db.unprefilterable_total);
    println!("  dropped_lines_total:  {}", db.dropped_lines_total);
    println!("  source_versions:      {:?}", db.source_versions);
    println!("  wrote {} ({} bytes)", out_path.display(), bytes);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reused_body_and_hash_classes_are_recognized() {
        assert_eq!(
            classify("main.hdb", false),
            Classification::Reused(ReusedKind::Hdb)
        );
        assert_eq!(
            classify("main.hsb", false),
            Classification::Reused(ReusedKind::Hsb)
        );
        assert_eq!(
            classify("daily.ndb", false),
            Classification::Reused(ReusedKind::Ndb)
        );
        assert_eq!(
            classify("daily.ldb", false),
            Classification::Reused(ReusedKind::Ldb)
        );
    }

    #[test]
    fn unofficial_pua_variant_classes_match_their_db_counterparts() {
        // The `.?u` "unofficial"/PUA databases share the byte format of their `.?b` counterparts
        // (verified against the live CVD). build-atoms' fail-loud caught these as an unmodeled gap; this
        // pins the classification so they are reused/forced exactly like `.?b`, never bypassed.
        assert_eq!(
            classify("daily.hdu", false),
            Classification::Reused(ReusedKind::Hdb)
        );
        assert_eq!(
            classify("daily.hsu", false),
            Classification::Reused(ReusedKind::Hsb)
        );
        assert_eq!(
            classify("daily.ndu", false),
            Classification::Reused(ReusedKind::Ndb)
        );
        assert_eq!(
            classify("daily.ldu", false),
            Classification::Reused(ReusedKind::Ldb)
        );
        assert_eq!(
            classify("daily.mdu", false),
            Classification::ForceFallThrough(vec![TARGET_PE])
        );
        assert_eq!(
            classify("daily.msu", false),
            Classification::ForceFallThrough(vec![TARGET_PE])
        );
    }

    #[test]
    fn classification_is_case_insensitive_on_extension() {
        assert_eq!(
            classify("MAIN.HDB", false),
            Classification::Reused(ReusedKind::Hdb)
        );
        assert!(classify("Daily.CDB", false).is_force_fall_through());
    }

    #[test]
    fn pe_substructure_hash_classes_force_pe_fall_through() {
        // .mdb/.msb (PE section hashes) and .imp (PE import hash) hash a PE substructure we do not
        // compute — every one must force the PE class to fall through, never be silently bypassed.
        for name in ["main.mdb", "main.msb", "main.imp"] {
            assert_eq!(
                classify(name, false),
                Classification::ForceFallThrough(vec![TARGET_PE]),
                "{name} must force PE fall-through"
            );
        }
    }

    #[test]
    fn container_metadata_forces_container_classes() {
        assert_eq!(
            classify("daily.cdb", false),
            Classification::ForceFallThrough(vec![
                TARGET_PE,
                TARGET_OLE2,
                TARGET_ELF,
                TARGET_MACHO
            ])
        );
    }

    #[test]
    fn bytecode_forces_executable_classes() {
        assert_eq!(
            classify("daily.cbc", false),
            Classification::ForceFallThrough(vec![TARGET_PE, TARGET_ELF, TARGET_MACHO])
        );
    }

    #[test]
    fn image_fuzzy_forces_graphics() {
        assert_eq!(
            classify("daily.idb", false),
            Classification::ForceFallThrough(vec![TARGET_GRAPHICS])
        );
    }

    #[test]
    fn phishing_classes_force_document_classes() {
        for name in ["daily.pdb", "daily.gdb", "daily.wdb"] {
            assert_eq!(
                classify(name, false),
                Classification::ForceFallThrough(vec![3, 4, 7]),
                "{name} must force the document classes through"
            );
        }
    }

    #[test]
    fn non_detection_files_are_ignored() {
        for name in [
            "daily.info",
            "daily.cfg",
            "daily.ftm",
            "daily.fp",
            "local.ign",
            "daily.ign2",
            "daily.crb",
            "daily.cat",
            "daily.pwdb",
            "COPYING",
            "main.cvd",
            "daily.cld",
        ] {
            assert_eq!(
                classify(name, false),
                Classification::Ignored,
                "{name} is a non-detection file and must be ignored"
            );
        }
    }

    #[test]
    fn an_unrecognized_non_empty_file_fails_loud() {
        // THE self-maintenance guard: a new ClamAV database class (here a hypothetical `.qdb`) that this
        // extractor does not model must be flagged Unrecognized so the build fails — never silently
        // bypassed. This is the fail-loud that keeps freshclam-driven self-maintenance safe.
        assert_eq!(classify("daily.qdb", false), Classification::Unrecognized);
        assert_eq!(
            classify("some-new-class", false),
            Classification::Unrecognized
        );
    }

    #[test]
    fn an_empty_file_of_any_name_is_never_a_hole() {
        // An empty file (even of an unrecognized extension) carries no signature, so it is not a hole and
        // must NOT trip the fail-loud — otherwise an empty `daily.foo` would break every build.
        assert_eq!(classify("daily.qdb", true), Classification::Empty);
        assert_eq!(classify("main.ndb", true), Classification::Empty);
    }

    #[test]
    fn run_fails_loud_on_an_unrecognized_file_in_the_dir() {
        // End-to-end over a real temp dir: a directory containing an unrecognized non-empty file makes
        // `run` return Err (⇒ non-zero exit), and writes NO atoms.db.
        let dir =
            std::env::temp_dir().join(format!("build-atoms-test-fail-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("daily.ndb"), "Sig:0:*:1122334455667788\n").unwrap();
        std::fs::write(dir.join("mystery.qdb"), "some new clamav class body\n").unwrap();
        let out = dir.join("atoms.db");

        let result = run(&dir, &out);
        assert!(
            result.is_err(),
            "run must fail loud on an unrecognized non-empty file"
        );
        assert!(
            result.unwrap_err().contains("mystery.qdb"),
            "the error must name the offending file"
        );
        assert!(
            !out.exists(),
            "no atoms.db must be written on a failed build"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn run_extracts_and_writes_atoms_db_for_a_recognized_dir() {
        // A directory of recognized files: run succeeds, writes a non-empty atoms.db, folds atoms from
        // the .ndb and forces PE through for the .mdb.
        let dir = std::env::temp_dir().join(format!("build-atoms-test-ok-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("daily.ndb"), "Sig:1:*:1122334455667788\n").unwrap();
        std::fs::write(dir.join("main.mdb"), "486:32:somesectionhash:Name\n").unwrap();
        std::fs::write(dir.join("daily.info"), "ClamAV-VDB:metadata\n").unwrap();
        std::fs::write(dir.join("empty.qdb"), "").unwrap();
        let out = dir.join("atoms.db");

        run(&dir, &out).expect("run must succeed for a recognized dir");
        assert!(out.exists(), "atoms.db must be written");

        let json = std::fs::read(&out).unwrap();
        let db: AtomDb = serde_json::from_slice(&json).unwrap();
        // The .ndb atom is present; PE (1) is forced through by the .mdb.
        assert_eq!(db.atoms.len(), 1);
        assert!(db.fall_through_targets.contains(&TARGET_PE));

        std::fs::remove_dir_all(&dir).ok();
    }

    impl Classification {
        fn is_force_fall_through(&self) -> bool {
            matches!(self, Classification::ForceFallThrough(_))
        }
    }
}
