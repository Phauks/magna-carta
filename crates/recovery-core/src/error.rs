//! The recovery error type and its stable edge error codes.

use engine_host::wasm_edge::EdgeError;

/// Recovery failures, mapped to fixed edge codes. A `&'static str` code is a
/// compile-time constant and cannot carry runtime file paths or file content.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RepairError {
    /// No known format magic — nothing to attempt.
    NotRecognized,
    /// Format recognized but no repair pillar supports it yet.
    Unsupported,
    /// Recognized and supported, but the damage is unrecoverable.
    Unrepairable,
    /// The input is malformed beyond the point a diagnoser can read it.
    Malformed,
}

pub const REPAIR_ERROR_CODES: &[&str] =
    &["notRecognized", "unsupported", "unrepairable", "malformed"];

impl EdgeError for RepairError {
    fn code(&self) -> &'static str {
        match self {
            RepairError::NotRecognized => "notRecognized",
            RepairError::Unsupported => "unsupported",
            RepairError::Unrepairable => "unrepairable",
            RepairError::Malformed => "malformed",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine_host::wasm_edge::allowed_code;

    #[test]
    fn every_error_code_is_in_the_declared_set() {
        for error in [
            RepairError::NotRecognized,
            RepairError::Unsupported,
            RepairError::Unrepairable,
            RepairError::Malformed,
        ] {
            assert!(allowed_code(error.code(), REPAIR_ERROR_CODES));
        }
    }

    #[test]
    fn a_content_like_string_is_not_a_valid_code() {
        assert!(!allowed_code("client-secret.docx", REPAIR_ERROR_CODES));
    }
}
