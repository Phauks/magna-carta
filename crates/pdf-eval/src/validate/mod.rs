//! Reusable document-engine validation harness: run engine operations over a
//! corpus, classifying robustness (no panic/hang), safety (invariants hold), and
//! coverage (good path vs. fallback), and diff the summary against a baseline.

pub mod corpus;
pub mod operation;
pub mod operations;
pub mod report;
pub mod runner;

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

use crate::validate::operations::forms::FormsOperation;
use crate::validate::operations::surgery::SurgeryOperation;
use crate::validate::report::{diff_baseline, summarize, write_jsonl, DocumentReport, Summary};
use crate::validate::runner::run_document;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

/// Run every phase-1 operation over each PDF in `dir`, write a JSONL report, print a
/// summary, and diff against the committed baseline. Exit code 1 on any regression.
pub fn validate_mode(dir: String) {
    let operations: Vec<Arc<dyn operation::ValidationOperation>> =
        vec![Arc::new(FormsOperation), Arc::new(SurgeryOperation)];
    let timeout = Duration::from_secs(10);

    let mut reports: Vec<DocumentReport> = Vec::new();
    let mut documents: Vec<std::path::PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("read corpus dir {dir}: {e}"))
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.extension()
                .map(|extension| extension == "pdf")
                .unwrap_or(false)
        })
        .collect();
    documents.sort();

    for path in &documents {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(e) => {
                eprintln!("skip {name}: read error {e}");
                continue;
            }
        };
        for operation in &operations {
            let report = run_document(operation.clone(), name.clone(), bytes.clone(), timeout);
            println!(
                "{:<10} {:<34} {:?}",
                report.operation, report.document, report.outcome
            );
            reports.push(report);
        }
    }

    let summary = summarize(&reports);
    let report_path = Path::new("pdf-eval/validation-report.jsonl");
    if let Err(e) = write_jsonl(&reports, report_path) {
        eprintln!("warning: could not write {}: {e}", report_path.display());
    }
    println!(
        "\nSUMMARY: {} documents; outcomes {:?}; panicked {}; timed_out {}; safety_violations {}",
        summary.total,
        summary.outcomes,
        summary.panicked.len(),
        summary.timed_out.len(),
        summary.safety_violations.len()
    );

    let baseline_text = include_str!("../../validation-baseline.json");
    let baseline: Summary =
        serde_json::from_str(baseline_text).expect("validation-baseline.json is valid");
    let regressions = diff_baseline(&summary, &baseline);
    if regressions.is_empty() {
        println!("no regressions versus baseline");
    } else {
        eprintln!("REGRESSIONS ({}):", regressions.len());
        for r in &regressions {
            eprintln!("  {} : {}", r.kind, r.detail);
        }
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::operation::{Outcome, ValidationOperation};
    use super::operations::forms::FormsOperation;

    #[test]
    fn forms_operation_never_panics_on_ci_corpus() {
        // The committed CI corpus must run clean through the forms operation.
        for bytes in [
            include_bytes!("../../corpus-ci/gov_irs_w9_acroform.pdf").as_slice(),
            include_bytes!("../../corpus-ci/basicapi.pdf").as_slice(),
            include_bytes!("../../corpus-ci/pdfjs_franz_image.pdf").as_slice(),
        ] {
            let verdict = FormsOperation.run(bytes);
            assert!(
                !matches!(
                    verdict.outcome,
                    Outcome::Panicked { .. } | Outcome::TimedOut
                ),
                "forms operation must not panic/timeout: {:?}",
                verdict.outcome
            );
        }
    }
}
