//! The engine-agnostic validation-operation interface: run one engine capability
//! on document bytes and classify how it fared. The runner isolates `run` from
//! panics and hangs, so implementations may fail loudly without taking the harness
//! down.

use serde::Serialize;

/// How a document fared under one operation.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Outcome {
    /// Completed on the good path; `variant` names the success mode.
    Success { variant: String },
    /// Intentionally took a safe fallback (e.g. rasterized redaction).
    Fallback { reason: String },
    /// Nothing to do (e.g. the document has no form).
    Skipped { reason: String },
    /// Returned an error.
    Error { detail: String },
    /// Panicked — a robustness defect.
    Panicked { detail: String },
    /// Exceeded the timeout — a robustness defect.
    TimedOut,
}

/// Whether the operation's safety invariant held.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Safety {
    Upheld,
    Violated { detail: String },
    NotApplicable,
}

/// One operation's verdict on one document.
#[derive(Debug, Clone)]
pub struct OperationVerdict {
    pub outcome: Outcome,
    pub safety: Safety,
}

/// A validation operation. `run` may panic or hang; the runner isolates it.
pub trait ValidationOperation: Send + Sync {
    /// Stable identifier used in reports (e.g. "forms").
    fn name(&self) -> &str;
    /// Execute on `bytes` and classify. May panic.
    fn run(&self, bytes: &[u8]) -> OperationVerdict;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outcome_serializes_with_kind_tag() {
        let json = serde_json::to_string(&Outcome::Success {
            variant: "filled".into(),
        })
        .unwrap();
        assert_eq!(json, r#"{"kind":"success","variant":"filled"}"#);
    }

    #[test]
    fn timed_out_serializes_as_bare_kind() {
        let json = serde_json::to_string(&Outcome::TimedOut).unwrap();
        assert_eq!(json, r#"{"kind":"timed_out"}"#);
    }
}
