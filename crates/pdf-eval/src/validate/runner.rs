//! Executes one operation on one document under panic-catching and a wall-clock
//! timeout, so a bad document yields a `Panicked`/`TimedOut` record instead of
//! taking the harness down. A timed-out worker thread is abandoned (Rust threads
//! are not killable); acceptable for a batch tool. Process isolation is a future
//! hardening if hostile hangs become common.

use crate::validate::operation::{Outcome, Safety, ValidationOperation};
use crate::validate::report::DocumentReport;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

pub fn run_document(
    operation: Arc<dyn ValidationOperation>,
    document: String,
    bytes: Vec<u8>,
    timeout: Duration,
) -> DocumentReport {
    let name = operation.name().to_string();
    let (sender, receiver) = mpsc::channel();
    let worker = operation.clone();
    std::thread::spawn(move || {
        let verdict = catch_unwind(AssertUnwindSafe(|| worker.run(&bytes)));
        let _ = sender.send(verdict);
    });

    let (outcome, safety) = match receiver.recv_timeout(timeout) {
        Ok(Ok(verdict)) => (verdict.outcome, verdict.safety),
        Ok(Err(payload)) => (
            Outcome::Panicked {
                detail: panic_detail(payload.as_ref()),
            },
            Safety::NotApplicable,
        ),
        Err(_) => (Outcome::TimedOut, Safety::NotApplicable),
    };

    DocumentReport {
        document,
        operation: name,
        outcome,
        safety,
    }
}

fn panic_detail(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "non-string panic payload".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::validate::operation::OperationVerdict;

    struct Panicker;
    impl ValidationOperation for Panicker {
        fn name(&self) -> &str {
            "panicker"
        }
        fn run(&self, _bytes: &[u8]) -> OperationVerdict {
            panic!("boom");
        }
    }

    struct Sleeper;
    impl ValidationOperation for Sleeper {
        fn name(&self) -> &str {
            "sleeper"
        }
        fn run(&self, _bytes: &[u8]) -> OperationVerdict {
            std::thread::sleep(Duration::from_secs(10));
            unreachable!()
        }
    }

    struct Ok;
    impl ValidationOperation for Ok {
        fn name(&self) -> &str {
            "ok"
        }
        fn run(&self, _bytes: &[u8]) -> OperationVerdict {
            OperationVerdict {
                outcome: Outcome::Success {
                    variant: "x".into(),
                },
                safety: Safety::Upheld,
            }
        }
    }

    #[test]
    fn captures_panic_as_panicked() {
        let r = run_document(Arc::new(Panicker), "d".into(), vec![], Duration::from_secs(5));
        assert!(matches!(r.outcome, Outcome::Panicked { .. }));
    }

    #[test]
    fn captures_timeout() {
        let r = run_document(Arc::new(Sleeper), "d".into(), vec![], Duration::from_millis(100));
        assert_eq!(r.outcome, Outcome::TimedOut);
    }

    #[test]
    fn passes_through_success() {
        let r = run_document(Arc::new(Ok), "d".into(), vec![], Duration::from_secs(5));
        assert!(matches!(r.outcome, Outcome::Success { .. }));
        assert_eq!(r.safety, Safety::Upheld);
    }
}
