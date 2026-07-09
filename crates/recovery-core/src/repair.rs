//! The top-level repair dispatch: route a damaged file to its format pillar.

use crate::error::RepairError;
use crate::model::RepairResult;
use engine_host::format::{detect, Format};

/// Repair a damaged file by detecting its format and dispatching to the matching
/// pillar. Every format `detect` currently recognizes has a pillar; unrecognized
/// input → NotRecognized. Adding a new `Format` variant stops this match compiling
/// until it is given an arm — a deliberate prompt to route it to a pillar or
/// return `Unsupported`. Never emits a silently-empty result.
pub fn repair(bytes: &[u8]) -> Result<RepairResult, RepairError> {
    match detect(bytes) {
        Some(Format::Zip) => crate::zip_repair::repair_zip(bytes),
        Some(Format::Ole2) => crate::cfb_repair::repair_cfb(bytes),
        Some(Format::Pdf) => crate::pdf_repair::repair_pdf(bytes),
        None => Err(RepairError::NotRecognized),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unrecognized_input_is_not_recognized() {
        // `matches!` (not assert_eq!) because RepairResult does not derive PartialEq.
        assert!(matches!(
            repair(b"not a known file at all"),
            Err(RepairError::NotRecognized)
        ));
    }

    #[test]
    fn a_pdf_without_recoverable_objects_is_unrepairable() {
        // PDF now dispatches to its pillar; a %PDF header with no indirect objects
        // has nothing to recover, so the pillar reports it unrepairable.
        assert!(matches!(
            repair(b"%PDF-1.7\nstuff"),
            Err(RepairError::Unrepairable)
        ));
    }
}
