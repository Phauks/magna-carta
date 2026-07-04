//! Surgery-path comparison: run the op-path and byte-path writers independently on
//! page 0's text region and classify how each fared against the surgery outcome gate.
//! Confirms the byte-path recovers pages the op-path flattens (bar A) and diagnoses
//! whether the byte-path could fully replace the op-path (bar B).

use crate::validate::operation::{OperationVerdict, Outcome, Safety, ValidationOperation};

pub struct SurgeryOperation;

impl ValidationOperation for SurgeryOperation {
    fn name(&self) -> &str {
        "surgery"
    }

    fn run(&self, bytes: &[u8]) -> OperationVerdict {
        // A generous rect over the lower-left; page 0. Real corpus pages have text here,
        // and the comparison is only meaningful where glyphs are marked.
        let rects = [pdf_core::Rect {
            x0: 0.0,
            y0: 0.0,
            x1: 300.0,
            y1: 200.0,
        }];
        match pdf_core::compare_surgery_paths(bytes, 0, &rects) {
            None => OperationVerdict {
                outcome: Outcome::Skipped {
                    reason: "page 0 not analyzable".into(),
                },
                safety: Safety::NotApplicable,
            },
            Some(cmp) => {
                use pdf_core::SurgeryDisposition::*;
                let variant = match (cmp.op_path, cmp.byte_path) {
                    // Byte-path matches or beats op-path — the bar-B-favourable cases.
                    (Surgered, Surgered) => "both_surgered",
                    (Flattened, Surgered) => "byte_path_recovers", // bar A: the win
                    (Flattened, Flattened) => "both_flattened",
                    // Byte-path LOSES to op-path — the only bar-B blocker.
                    (Surgered, Flattened) => "byte_path_regresses",
                };
                let safety = if variant == "byte_path_regresses" {
                    Safety::Violated {
                        detail: "byte-path flattened a page the op-path surgered".into(),
                    }
                } else {
                    Safety::Upheld
                };
                OperationVerdict {
                    outcome: Outcome::Success {
                        variant: variant.into(),
                    },
                    safety,
                }
            }
        }
    }
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
}
