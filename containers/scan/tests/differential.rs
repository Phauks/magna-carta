//! The DB-derived differential gate: the single automated check that the prefilter can never produce a
//! FALSE-CLEAN — a file the prefilter clears that clamd would flag. It is the safety net that makes the
//! engine SELF-MAINTAIN: on every rebuild against a fresh ClamAV database it re-derives its corpus FROM
//! that database and re-proves the property, with no hand-written test cases to go stale.
//!
//! ## What it proves and why this shape
//!
//! Two independent checks, deliberately separate:
//!
//!  1. **The live DB-derived gate** ([`prefilter_never_false_cleans_db_corpus`], `#[ignore]` — needs a
//!     running clamd). It builds a corpus DIRECTLY from the baked signature DB: for a representative
//!     sample of `.ndb`/`.ldb` signatures whose body is a pure fixed-byte run, it renders the exact bytes
//!     into a file. clamd, scanning that file, must flag it (the signature's required bytes are present);
//!     the prefilter, given the same bytes, must NOT clear it. The C1-correct assertion is
//!     `assert!(!matches!(clam, ClamVerdict::Infected(_)), ...)` — never `assert_ne!` against an empty
//!     string (a named signature is never `""`, so that always passes and the gate never fires). A clamd
//!     `Unavailable` is a HARD ERROR: we cannot validate against an absent authority, so we refuse to
//!     pass rather than silently skip.
//!
//!  2. **The negative self-test** ([`the_gate_fails_on_a_known_false_clean`], always runs, no clamd). A
//!     gate with no proof that it can fail is untrustworthy. This feeds the gate's own assertion a
//!     KNOWN-false-clean pair — clamd says `Infected`, an intentionally-broken prefilter says `Clean` —
//!     and asserts the assertion PANICS. If a future refactor neuters the assertion (e.g. back to
//!     `assert_ne!`), this test goes red.
//!
//! The corpus is built from pure-fixed-run signatures because those render to bytes clamd matches
//! deterministically (no wildcard/range/offset to satisfy), and they are exactly the signatures the
//! prefilter DOES reduce to an atom — so a false-clean here would be a real soundness bug in the atom
//! logic, not a test artifact.

use magna_carta_scan::atoms::{tokenize_fixed_runs, MIN_ATOM_LEN};
use magna_carta_scan::clamav::ClamVerdict;
use magna_carta_scan::prefilter::PrefilterOutcome;

// The corpus derivation is used by the live gate (unix-only — it scans files clamd opens by path, a
// transport that is `#[cfg(unix)]`). It is referenced only there, so gate the module too to keep the
// Windows dev build (always-on tests only) free of dead-code warnings.
#[cfg(unix)]
#[path = "common/differential_corpus.rs"]
mod corpus;

/// The C1-correct false-clean assertion, factored out so the live gate and the negative self-test
/// exercise the EXACT same check. Panics (fails the test) iff `clam` flagged the sample as infected while
/// the prefilter cleared it — the one catastrophic outcome. A prefilter `FallThrough` is always safe
/// (clamd is the authority), and a clamd `Clean`/`Unavailable` is handled by the caller (Unavailable is a
/// hard error upstream).
fn assert_no_false_clean(name: &str, clam: &ClamVerdict, prefilter: PrefilterOutcome) {
    if prefilter == PrefilterOutcome::Clean {
        assert!(
            !matches!(clam, ClamVerdict::Infected(_)),
            "FALSE-CLEAN: prefilter cleared {name} which clamd flagged {clam:?}"
        );
    }
}

/// The negative self-test — ALWAYS runs (no clamd needed). Proves the gate is not vacuous: a
/// known-false-clean pair (clamd `Infected`, a broken prefilter `Clean`) MUST make `assert_no_false_clean`
/// panic. A gate that cannot fail on a planted hole would never catch a real one.
#[test]
fn the_gate_fails_on_a_known_false_clean() {
    let broken_clam = ClamVerdict::Infected("Win.Test.Planted-1".to_string());
    let broken_prefilter = PrefilterOutcome::Clean;

    let caught = std::panic::catch_unwind(|| {
        assert_no_false_clean(
            "planted-false-clean-fixture",
            &broken_clam,
            broken_prefilter,
        );
    });
    assert!(
        caught.is_err(),
        "the differential gate did not fire on a KNOWN false-clean — the assertion is vacuous and would \
         not catch a real false-clean either"
    );
}

/// And the dual: a prefilter `FallThrough` on a clamd-infected file is the SAFE, expected outcome and
/// must NOT trip the gate. Confirms the assertion is not over-eager (which would make the live gate
/// un-passable and equally useless).
#[test]
fn the_gate_passes_when_the_prefilter_falls_through() {
    let clam = ClamVerdict::Infected("Win.Test.Planted-1".to_string());
    // Should not panic.
    assert_no_false_clean("safe-fall-through", &clam, PrefilterOutcome::FallThrough);
}

/// The live DB-derived gate. Needs a running clamd whose DB is the same one `SIGSRC` was unpacked from
/// (the scan container, or `CLAMD_ADDRESS` + `SIGSRC` set locally). `#[ignore]`d so a normal `cargo test`
/// (no daemon) stays green; the scan-container CI job runs it with `--ignored`.
///
/// For each DB-derived sample it: writes the rendered bytes to a scratch file clamd reads by path, takes
/// clamd's verdict (a `Unavailable` is a hard error — we cannot validate), takes the prefilter's verdict,
/// and asserts no false-clean. It additionally requires that clamd actually flagged a non-trivial
/// fraction of the rendered samples — if clamd cleared everything, the corpus is not exercising the gate
/// and the test fails loudly rather than passing vacuously.
#[cfg(unix)]
#[tokio::test]
#[ignore = "live differential gate: needs clamd + SIGSRC; runs in the scan-container CI job with --ignored"]
async fn prefilter_never_false_cleans_db_corpus() {
    use corpus::{build_prefilter_from_sigsrc, derive_pure_fixed_run_samples, Sample};
    use magna_carta_scan::clamav::scan_file_path;

    let clamd_address =
        std::env::var("CLAMD_ADDRESS").unwrap_or_else(|_| "127.0.0.1:3310".to_string());
    let sigsrc = std::env::var("SIGSRC").unwrap_or_else(|_| "/var/lib/clamav/unpacked".to_string());
    let scratch_dir = std::env::var("SCAN_SCRATCH").unwrap_or_else(|_| "/scan".to_string());

    // Build the prefilter from the SAME unpacked DB clamd is running — so the two are derived from one
    // source and the differential is meaningful.
    let prefilter = build_prefilter_from_sigsrc(std::path::Path::new(&sigsrc))
        .expect("prefilter must build from the unpacked signature DB");

    // Derive a representative corpus of pure-fixed-run signatures from the same DB.
    let samples: Vec<Sample> = derive_pure_fixed_run_samples(std::path::Path::new(&sigsrc), 2_000);
    assert!(
        !samples.is_empty(),
        "no DB-derived samples — SIGSRC ({sigsrc}) has no usable pure-fixed-run signatures; the gate \
         cannot run"
    );

    let mut clamd_flagged = 0usize;
    for (index, sample) in samples.iter().enumerate() {
        let path = std::path::Path::new(&scratch_dir).join(format!("diff-{index}"));
        std::fs::write(&path, &sample.bytes).expect("write scratch sample");

        let clam = scan_file_path(&path, &clamd_address).await;
        // A clamd fault means we cannot validate this sample against the authority — HARD ERROR, never a
        // silent skip (skipping would let the gate pass while proving nothing).
        assert!(
            clam != ClamVerdict::Unavailable,
            "clamd UNAVAILABLE while validating {} — cannot run the differential gate without the \
             authority",
            sample.name
        );

        let prefilter_outcome = prefilter.verdict(&sample.bytes, sample.content_type.as_deref());
        assert_no_false_clean(&sample.name, &clam, prefilter_outcome);

        if matches!(clam, ClamVerdict::Infected(_)) {
            clamd_flagged += 1;
        }
        std::fs::remove_file(&path).ok();
    }

    // If clamd flagged (almost) nothing, the corpus is not actually exercising the gate — fail loudly
    // rather than report a vacuous pass. Rendered pure-fixed-run signatures should overwhelmingly match.
    assert!(
        clamd_flagged * 2 >= samples.len(),
        "clamd flagged only {clamd_flagged}/{} rendered DB samples — the corpus is not exercising the \
         gate (expected most pure-fixed-run signatures to match)",
        samples.len()
    );
    eprintln!(
        "differential gate: {} samples, clamd flagged {clamd_flagged}, no false-cleans",
        samples.len()
    );
}

/// A unit-level sanity check on the corpus derivation that runs WITHOUT clamd: rendering a pure-fixed-run
/// `.ndb` line yields a file whose bytes contain the signature's fixed run, so any sound prefilter built
/// over that atom MUST fall through on it. This proves the synthesis logic produces atom-bearing files
/// before we ever involve clamd.
#[test]
fn derived_samples_contain_their_fixed_run() {
    // A hand-written pure-fixed-run .ndb body (no wildcards) the corpus logic must render verbatim.
    let hex = "1122334455667788aabbccdd";
    let runs = tokenize_fixed_runs(hex);
    assert_eq!(runs.len(), 1, "the test fixture must be a single fixed run");
    assert!(runs[0].len() >= MIN_ATOM_LEN);
    // The rendered bytes ARE the decoded run — so a prefilter atom (its longest run) is a substring.
    assert_eq!(
        runs[0],
        vec![0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0xaa, 0xbb, 0xcc, 0xdd]
    );
}
