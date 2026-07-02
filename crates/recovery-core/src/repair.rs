//! The top-level repair dispatch: route a damaged file to its format pillar.

use crate::error::RepairError;
use crate::model::RepairResult;
use engine_host::format::{detect, Format};

/// Repair a damaged file by detecting its format and dispatching to the matching
/// pillar. Unrecognized input → NotRecognized; a recognized format with no pillar
/// yet → Unsupported. Never emits a silently-empty result.
pub fn repair(bytes: &[u8]) -> Result<RepairResult, RepairError> {
    match detect(bytes) {
        Some(Format::Zip) => crate::zip_repair::repair_zip(bytes),
        Some(Format::Ole2) => crate::cfb_repair::repair_cfb(bytes),
        Some(_) => Err(RepairError::Unsupported),
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
    fn a_recognized_unsupported_format_is_unsupported() {
        // A PDF is recognized but its pillar is not in this plan.
        assert!(matches!(
            repair(b"%PDF-1.7\nstuff"),
            Err(RepairError::Unsupported)
        ));
    }
}
