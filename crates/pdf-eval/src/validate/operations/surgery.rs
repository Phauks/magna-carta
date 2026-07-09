//! Surgery-path comparison: run the op-path and byte-path writers independently on
//! every page of the document and classify how each fared against the surgery
//! outcome gate. Confirms the byte-path recovers pages the op-path flattens, and
//! diagnoses whether the byte-path could fully replace the op-path — by checking
//! every page rather than only the first, since the one page that would confirm or
//! block either question can be anywhere in the document.
//!
//! Scope: this only tells you whether each writer's candidate gate-passes per page,
//! independently. See [`pdf_core::compare_surgery_paths`] for what a green result
//! does and does not prove about surviving-glyph layout.

use crate::validate::operation::{OperationVerdict, Outcome, Safety, ValidationOperation};
use pdf_core::SurgeryDisposition;

pub struct SurgeryOperation;

impl ValidationOperation for SurgeryOperation {
    fn name(&self) -> &str {
        "surgery"
    }

    fn run(&self, bytes: &[u8]) -> OperationVerdict {
        // A generous rect over the lower-left, applied to every page in turn. Real
        // corpus pages have text here, and the comparison is only meaningful where
        // glyphs are marked.
        let rects = [pdf_core::Rect {
            x0: 0.0,
            y0: 0.0,
            x1: 300.0,
            y1: 200.0,
        }];

        let page_count = pdf_core::Document::load(bytes.to_vec())
            .map(|doc| doc.page_count())
            .unwrap_or(0);

        let dispositions: Vec<(SurgeryDisposition, SurgeryDisposition)> = (0..page_count)
            .filter_map(|page_index| pdf_core::compare_surgery_paths(bytes, page_index, &rects))
            .map(|cmp| (cmp.op_path, cmp.byte_path))
            .collect();

        match aggregate(&dispositions) {
            Some((variant, safety)) => OperationVerdict {
                outcome: Outcome::Success {
                    variant: variant.into(),
                },
                safety,
            },
            None => OperationVerdict {
                outcome: Outcome::Skipped {
                    reason: "no page was analyzable".into(),
                },
                safety: Safety::NotApplicable,
            },
        }
    }
}

/// Aggregate one document's per-page (op_path, byte_path) dispositions into a single
/// variant + safety verdict, in this precedence (most significant wins):
///
/// 1. Any page where the byte-path lost to the op-path (`Surgered, Flattened`) — the
///    byte-path would regress that page if it replaced the op-path. Names the first
///    such page index.
/// 2. Any page where the byte-path recovered a page the op-path flattens (`Flattened,
///    Surgered`) — the byte-path's whole reason for existing.
/// 3. Any page where both writers surgered — the byte-path matched the op-path.
/// 4. Otherwise, every analyzable page was flattened by both writers.
///
/// Returns `None` when `dispositions` is empty (no page was analyzable at all).
fn aggregate(
    dispositions: &[(SurgeryDisposition, SurgeryDisposition)],
) -> Option<(&'static str, Safety)> {
    use SurgeryDisposition::*;

    if dispositions.is_empty() {
        return None;
    }

    if let Some(page_index) = dispositions
        .iter()
        .position(|(op, byte)| *op == Surgered && *byte == Flattened)
    {
        return Some((
            "byte_path_regresses",
            Safety::Violated {
                detail: format!(
                    "byte-path flattened a page the op-path surgered (page {page_index})"
                ),
            },
        ));
    }

    if dispositions
        .iter()
        .any(|(op, byte)| *op == Flattened && *byte == Surgered)
    {
        return Some(("byte_path_recovers", Safety::Upheld));
    }

    if dispositions
        .iter()
        .any(|(op, byte)| *op == Surgered && *byte == Surgered)
    {
        return Some(("both_surgered", Safety::Upheld));
    }

    Some(("both_flattened", Safety::Upheld))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ci_corpus_never_panics() {
        // The committed CI corpus must run clean through the surgery comparison.
        for bytes in [
            include_bytes!("../../../corpus-ci/gov_irs_w9_acroform.pdf").as_slice(),
            include_bytes!("../../../corpus-ci/basicapi.pdf").as_slice(),
            include_bytes!("../../../corpus-ci/pdfjs_franz_image.pdf").as_slice(),
        ] {
            let verdict = SurgeryOperation.run(bytes);
            assert!(
                !matches!(
                    verdict.outcome,
                    Outcome::Panicked { .. } | Outcome::TimedOut
                ),
                "surgery operation must not panic/timeout: {:?}",
                verdict.outcome
            );
        }
    }

    // ── Aggregation precedence ────────────────────────────────────────────────

    use SurgeryDisposition::*;

    #[test]
    fn aggregate_empty_is_none() {
        assert!(aggregate(&[]).is_none());
    }

    #[test]
    fn aggregate_all_both_flattened() {
        let (variant, safety) = aggregate(&[(Flattened, Flattened), (Flattened, Flattened)])
            .expect("expected a verdict");
        assert_eq!(variant, "both_flattened");
        assert_eq!(safety, Safety::Upheld);
    }

    #[test]
    fn aggregate_any_both_surgered_wins_over_both_flattened() {
        let (variant, safety) = aggregate(&[(Flattened, Flattened), (Surgered, Surgered)])
            .expect("expected a verdict");
        assert_eq!(variant, "both_surgered");
        assert_eq!(safety, Safety::Upheld);
    }

    #[test]
    fn aggregate_any_recovery_wins_over_both_surgered() {
        // A multi-disposition document: one page both-surgered, one page recovered —
        // the recovery must take precedence in the reported variant.
        let (variant, safety) = aggregate(&[(Surgered, Surgered), (Flattened, Surgered)])
            .expect("expected a verdict");
        assert_eq!(variant, "byte_path_recovers");
        assert_eq!(safety, Safety::Upheld);
    }

    #[test]
    fn aggregate_any_regression_wins_over_everything_and_names_first_page() {
        // A multi-disposition document exercising every case at once: page 0 both
        // surgers, page 1 recovers, page 2 regresses. The regression must win the
        // aggregation and name page 2 (its actual index), not an earlier page.
        let (variant, safety) = aggregate(&[
            (Surgered, Surgered),
            (Flattened, Surgered),
            (Surgered, Flattened),
        ])
        .expect("expected a verdict");
        assert_eq!(variant, "byte_path_regresses");
        match safety {
            Safety::Violated { detail } => {
                assert!(
                    detail.contains('2'),
                    "expected the detail to name page 2, got: {detail}"
                );
            }
            other => panic!("expected Safety::Violated, got {other:?}"),
        }
    }

    #[test]
    fn aggregate_regression_names_first_matching_page_not_a_later_one() {
        let (_, safety) =
            aggregate(&[(Surgered, Flattened), (Surgered, Flattened)]).expect("expected a verdict");
        match safety {
            Safety::Violated { detail } => {
                assert!(
                    detail.contains('0'),
                    "expected the FIRST regressing page (0) named, got: {detail}"
                );
            }
            other => panic!("expected Safety::Violated, got {other:?}"),
        }
    }
}
