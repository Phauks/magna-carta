//! Reusable document-engine validation harness: run engine operations over a
//! corpus, classifying robustness (no panic/hang), safety (invariants hold), and
//! coverage (good path vs. fallback), and diff the summary against a baseline.

pub mod corpus;
pub mod operation;
pub mod operations;

/// Fetch any missing forms-corpus files into `corpus-forms/`. Requires the
/// `corpus-fetch` feature; without it, prints how to enable it.
pub fn corpus_fetch_mode() {
    let dir = std::path::Path::new("pdf-eval/corpus-forms");
    let manifest = include_str!("../../corpus-forms.lock");
    let entries = corpus::parse_manifest(manifest);
    #[cfg(feature = "corpus-fetch")]
    {
        match corpus::fetch_missing(&entries, dir) {
            Ok(n) => println!("fetched {n} file(s) into {}", dir.display()),
            Err(e) => {
                eprintln!("fetch failed: {e}");
                std::process::exit(1);
            }
        }
    }
    #[cfg(not(feature = "corpus-fetch"))]
    {
        let missing = corpus::missing_documents(&entries, dir);
        eprintln!(
            "corpus-fetch feature not enabled; {} file(s) missing. Re-run with:\n  cargo run -p pdf-eval --features corpus-fetch corpus-fetch",
            missing.len()
        );
        std::process::exit(2);
    }
}
