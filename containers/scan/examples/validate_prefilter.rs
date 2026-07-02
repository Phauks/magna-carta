//! A one-shot validation of the prefilter against the real, baked ClamAV signature database. It is run
//! inside the scan image (where `sigtool` has unpacked every `.cvd`/`.cld` into a directory of `.ndb`/
//! `.ldb`/`.hdb`/`.hsb` files) to confirm two things that cannot be checked with a unit fixture:
//!
//! 1. the full `AtomDb` builds into a `Prefilter` (the whole literal+regex set compiles in Vectorscan), and
//! 2. a clean, non-PE buffer returns `Clean` — i.e. the residual-regex handling actually keeps TargetType
//!    0 (ANY) OUT of the universal fall-through set, so the prefilter still saves work on real files.
//!
//! It exits non-zero on any failure so it can gate the image build. Build it with `--features vectorscan`.

use std::path::Path;

use magna_carta_scan::atoms::{parse_hdb, parse_hsb, parse_ldb, parse_ndb, AtomDb};
use magna_carta_scan::prefilter::{Prefilter, PrefilterOutcome};

fn main() {
    let dir = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "/var/lib/clamav/unpacked".to_string());
    let dir = Path::new(&dir);

    let mut db = AtomDb::default();
    let mut counts = (0usize, 0usize, 0usize, 0usize); // ndb, ldb, hdb, hsb files folded

    let entries = std::fs::read_dir(dir).unwrap_or_else(|error| {
        eprintln!("cannot read sig dir {}: {error}", dir.display());
        std::process::exit(2);
    });
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(extension) = path.extension().and_then(|os| os.to_str()) else {
            continue;
        };
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        match extension {
            "ndb" => {
                db.absorb(parse_ndb(&text));
                counts.0 += 1;
            }
            "ldb" => {
                db.absorb(parse_ldb(&text));
                counts.1 += 1;
            }
            "hdb" => {
                db.hashes.extend(parse_hdb(&text));
                counts.2 += 1;
            }
            "hsb" => {
                db.hashes.extend(parse_hsb(&text));
                counts.3 += 1;
            }
            _ => {}
        }
    }

    let any_in_fall_through = db.fall_through_targets.contains(&0);
    println!(
        "folded: {} .ndb, {} .ldb, {} .hdb, {} .hsb",
        counts.0, counts.1, counts.2, counts.3
    );
    println!(
        "atoms={} residual_regexes={} hashes={} fall_through_targets={:?}",
        db.atoms.len(),
        db.residual_regexes.len(),
        db.hashes.len(),
        db.fall_through_targets,
    );
    println!("ANY(0) in fall_through_targets BEFORE prefilter build: {any_in_fall_through}");

    let build_start = std::time::Instant::now();
    let prefilter = Prefilter::from_atom_db(db).unwrap_or_else(|error| {
        eprintln!("FAIL: prefilter did not build: {error}");
        std::process::exit(1);
    });
    println!("prefilter built in {:?}", build_start.elapsed());

    // A clean, non-PE, non-container buffer. If the prefilter still has ANY(0) forced to fall through
    // (universal fall-through, the failure the residual-regex handling exists to avoid), this returns
    // FallThrough; we want Clean.
    let clean =
        b"This is a perfectly ordinary clean plain-text legal document with no signatures in it. \
        It contains only prose and should be cleared by the prefilter without paying clamd.";
    let outcome = prefilter.verdict(clean, Some("text/plain"));
    println!("clean non-PE text/plain buffer verdict: {outcome:?}");

    match outcome {
        PrefilterOutcome::Clean => {
            println!("PASS: clean non-PE buffer is Clean — no universal fall-through.");
        }
        PrefilterOutcome::FallThrough => {
            eprintln!(
                "FAIL: clean non-PE buffer fell through — the prefilter is in universal fall-through \
                 (ANY-type residual handling is not keeping TargetType 0 out of the fall-through set)."
            );
            std::process::exit(1);
        }
    }
}
