//! Per-document records and (Tasks 6–7) their aggregation into a summary plus a
//! regression diff against a committed baseline.

use crate::validate::operation::{Outcome, Safety};
use serde::Serialize;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::io::Write;
use std::path::Path;

/// One operation's verdict on one document, as written to the JSONL report.
#[derive(Debug, Clone, Serialize)]
pub struct DocumentReport {
    pub document: String,
    pub operation: String,
    pub outcome: Outcome,
    pub safety: Safety,
}

/// Aggregate view of a run. `outcomes` counts each outcome kind; `fallback_reasons`
/// histograms the reasons; the three lists name the documents that hit a robustness
/// or safety defect (each must stay empty).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Summary {
    pub total: usize,
    pub outcomes: BTreeMap<String, usize>,
    pub fallback_reasons: BTreeMap<String, usize>,
    pub panicked: Vec<String>,
    pub timed_out: Vec<String>,
    pub safety_violations: Vec<String>,
}

pub fn summarize(reports: &[DocumentReport]) -> Summary {
    let mut outcomes: BTreeMap<String, usize> = BTreeMap::new();
    let mut fallback_reasons: BTreeMap<String, usize> = BTreeMap::new();
    let mut panicked = Vec::new();
    let mut timed_out = Vec::new();
    let mut safety_violations = Vec::new();

    for r in reports {
        let kind = match &r.outcome {
            Outcome::Success { .. } => "success",
            Outcome::Fallback { reason } => {
                *fallback_reasons.entry(reason.clone()).or_default() += 1;
                "fallback"
            }
            Outcome::Skipped { .. } => "skipped",
            Outcome::Error { .. } => "error",
            Outcome::Panicked { .. } => {
                panicked.push(r.document.clone());
                "panicked"
            }
            Outcome::TimedOut => {
                timed_out.push(r.document.clone());
                "timed_out"
            }
        };
        *outcomes.entry(kind.to_string()).or_default() += 1;
        if let Safety::Violated { .. } = r.safety {
            safety_violations.push(r.document.clone());
        }
    }

    Summary {
        total: reports.len(),
        outcomes,
        fallback_reasons,
        panicked,
        timed_out,
        safety_violations,
    }
}

/// Write one JSON object per report, one per line.
pub fn write_jsonl(reports: &[DocumentReport], path: &Path) -> std::io::Result<()> {
    let mut file = std::fs::File::create(path)?;
    for r in reports {
        let line = serde_json::to_string(r).map_err(|e| std::io::Error::other(e.to_string()))?;
        writeln!(file, "{line}")?;
    }
    Ok(())
}

#[cfg(test)]
mod summary_tests {
    use super::*;

    fn report(document: &str, outcome: Outcome, safety: Safety) -> DocumentReport {
        DocumentReport {
            document: document.into(),
            operation: "forms".into(),
            outcome,
            safety,
        }
    }

    #[test]
    fn counts_outcomes_and_collects_defects() {
        let reports = vec![
            report("a", Outcome::Success { variant: "x".into() }, Safety::Upheld),
            report("b", Outcome::Skipped { reason: "no form".into() }, Safety::NotApplicable),
            report("c", Outcome::Panicked { detail: "boom".into() }, Safety::NotApplicable),
            report("d", Outcome::Success { variant: "x".into() }, Safety::Violated { detail: "leak".into() }),
        ];
        let s = summarize(&reports);
        assert_eq!(s.total, 4);
        assert_eq!(s.outcomes.get("success"), Some(&2));
        assert_eq!(s.outcomes.get("skipped"), Some(&1));
        assert_eq!(s.panicked, vec!["c".to_string()]);
        assert_eq!(s.safety_violations, vec!["d".to_string()]);
    }
}

/// A single regression versus the baseline.
#[derive(Debug, Clone, PartialEq)]
pub struct Regression {
    pub kind: String,
    pub detail: String,
}

/// Compare a run against the baseline. New panics, new timeouts, new safety
/// violations, and a drop in successes are regressions.
pub fn diff_baseline(current: &Summary, baseline: &Summary) -> Vec<Regression> {
    let mut out = Vec::new();
    let new_names = |cur: &[String], base: &[String]| -> Vec<String> {
        cur.iter().filter(|n| !base.contains(n)).cloned().collect()
    };
    for n in new_names(&current.panicked, &baseline.panicked) {
        out.push(Regression { kind: "new_panic".into(), detail: n });
    }
    for n in new_names(&current.timed_out, &baseline.timed_out) {
        out.push(Regression { kind: "new_timeout".into(), detail: n });
    }
    for n in new_names(&current.safety_violations, &baseline.safety_violations) {
        out.push(Regression { kind: "new_safety_violation".into(), detail: n });
    }
    let cur_success = current.outcomes.get("success").copied().unwrap_or(0);
    let base_success = baseline.outcomes.get("success").copied().unwrap_or(0);
    if cur_success < base_success {
        out.push(Regression {
            kind: "coverage_drop".into(),
            detail: format!("success {cur_success} < baseline {base_success}"),
        });
    }
    out
}

#[cfg(test)]
mod diff_tests {
    use super::*;

    fn base() -> Summary {
        Summary {
            total: 2,
            outcomes: BTreeMap::from([("success".to_string(), 2)]),
            fallback_reasons: BTreeMap::new(),
            panicked: vec![],
            timed_out: vec![],
            safety_violations: vec![],
        }
    }

    #[test]
    fn clean_run_matches_baseline() {
        assert!(diff_baseline(&base(), &base()).is_empty());
    }

    #[test]
    fn new_panic_and_coverage_drop_are_regressions() {
        let mut cur = base();
        cur.outcomes.insert("success".into(), 1);
        cur.panicked.push("evil.pdf".into());
        let regs = diff_baseline(&cur, &base());
        assert!(regs.iter().any(|r| r.kind == "new_panic" && r.detail == "evil.pdf"));
        assert!(regs.iter().any(|r| r.kind == "coverage_drop"));
    }
}
