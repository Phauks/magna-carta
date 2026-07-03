//! Forms validation: read the AcroForm, fill every text field with a probe value,
//! confirm the probe reads back from the output (the safety invariant), and flatten
//! to a document that re-parses. Documents without a fillable form are skipped.

use crate::validate::operation::{Outcome, OperationVerdict, Safety, ValidationOperation};
use pdf_core::{
    fill_form, flatten_form, read_form, Document, FieldKind, FieldValue, FormError,
    FormFillOptions,
};
use std::collections::BTreeMap;

const PROBE: &str = "VALIDATION_PROBE";

pub struct FormsOperation;

impl ValidationOperation for FormsOperation {
    fn name(&self) -> &str {
        "forms"
    }

    fn run(&self, bytes: &[u8]) -> OperationVerdict {
        let fields = match read_form(bytes) {
            Ok(f) => f,
            Err(e) => return err(format!("read_form: {e:?}")),
        };

        let probes: BTreeMap<String, FieldValue> = fields
            .iter()
            .filter(|f| f.kind == FieldKind::Text && !f.read_only)
            .map(|f| (f.name.clone(), FieldValue::Text(PROBE.to_string())))
            .collect();

        if probes.is_empty() {
            return OperationVerdict {
                outcome: Outcome::Skipped {
                    reason: "no fillable text field".into(),
                },
                safety: Safety::NotApplicable,
            };
        }

        let filled = match fill_form(bytes, &probes, &FormFillOptions { flatten: false }) {
            Ok(b) => b,
            Err(FormError::NoAcroForm) => {
                return OperationVerdict {
                    outcome: Outcome::Skipped {
                        reason: "no AcroForm".into(),
                    },
                    safety: Safety::NotApplicable,
                }
            }
            Err(e) => return err(format!("fill_form: {e:?}")),
        };

        // Safety: the probe must read back from the produced document.
        let safety = match read_form(&filled) {
            Ok(after) => {
                let ok = probes.keys().all(|name| {
                    after
                        .iter()
                        .find(|f| &f.name == name)
                        .map(|f| f.value == Some(FieldValue::Text(PROBE.to_string())))
                        .unwrap_or(false)
                });
                if ok {
                    Safety::Upheld
                } else {
                    Safety::Violated {
                        detail: "probe value did not read back after fill".into(),
                    }
                }
            }
            Err(e) => Safety::Violated {
                detail: format!("output unreadable: {e:?}"),
            },
        };

        // Flatten must produce a re-parseable document.
        match flatten_form(bytes) {
            Ok(flat) => {
                if Document::load(flat).is_err() {
                    return OperationVerdict {
                        outcome: Outcome::Error {
                            detail: "flattened output failed to re-parse".into(),
                        },
                        safety,
                    };
                }
            }
            Err(e) => {
                return OperationVerdict {
                    outcome: Outcome::Error {
                        detail: format!("flatten_form: {e:?}"),
                    },
                    safety,
                }
            }
        }

        OperationVerdict {
            outcome: Outcome::Success {
                variant: "filled+flattened".into(),
            },
            safety,
        }
    }
}

fn err(detail: String) -> OperationVerdict {
    OperationVerdict {
        outcome: Outcome::Error { detail },
        safety: Safety::NotApplicable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acroform_document_fills_flattens_and_upholds_safety() {
        // gov_irs_w9 is a real AcroForm committed for CI.
        let bytes = include_bytes!("../../../corpus-ci/gov_irs_w9_acroform.pdf").to_vec();
        let verdict = FormsOperation.run(&bytes);
        assert!(
            matches!(verdict.outcome, Outcome::Success { .. }),
            "expected Success, got {:?}",
            verdict.outcome
        );
        assert_eq!(verdict.safety, Safety::Upheld);
    }

    #[test]
    fn non_form_document_is_skipped() {
        // basicapi has no AcroForm.
        let bytes = include_bytes!("../../../corpus-ci/basicapi.pdf").to_vec();
        let verdict = FormsOperation.run(&bytes);
        assert!(
            matches!(verdict.outcome, Outcome::Skipped { .. }),
            "expected Skipped, got {:?}",
            verdict.outcome
        );
    }
}
