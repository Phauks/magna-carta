//! The email engine's error type and its stable edge error codes.

use engine_host::wasm_edge::EdgeError;

/// Parse failures, mapped to fixed edge codes. A `&'static str` code is a
/// compile-time constant and cannot carry runtime file paths or file content.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmailError {
    /// The input could not be read as the format it claims to be.
    Malformed,
    /// Recognized but this engine has no lane for it.
    Unsupported,
    /// A declared bound (size, part count, nesting depth) was exceeded.
    LimitExceeded,
    /// A requested part descriptor does not match any part this message parsed.
    PartNotFound,
}

pub const EMAIL_ERROR_CODES: &[&str] =
    &["malformed", "unsupported", "limitExceeded", "partNotFound"];

impl EdgeError for EmailError {
    fn code(&self) -> &'static str {
        match self {
            EmailError::Malformed => "malformed",
            EmailError::Unsupported => "unsupported",
            EmailError::LimitExceeded => "limitExceeded",
            EmailError::PartNotFound => "partNotFound",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine_host::wasm_edge::{allowed_code, EdgeError};

    #[test]
    fn every_error_maps_to_a_declared_static_code() {
        let cases = [
            EmailError::Malformed,
            EmailError::Unsupported,
            EmailError::LimitExceeded,
            EmailError::PartNotFound,
        ];
        for error in cases {
            assert!(allowed_code(error.code(), EMAIL_ERROR_CODES));
        }
    }

    #[test]
    fn a_content_bearing_string_is_rejected_by_the_guard() {
        assert!(!allowed_code(
            "privileged-client-memo.msg",
            EMAIL_ERROR_CODES
        ));
    }

    #[test]
    fn the_declared_code_set_is_exactly_the_engines_error_variants() {
        // One declared code per `EmailError` variant, and no more: a code that
        // slipped in without a variant (or a variant with no code) would let the
        // edge emit a string this set never vetted.
        assert_eq!(EMAIL_ERROR_CODES.len(), 4);
        for code in EMAIL_ERROR_CODES {
            // A code is a fixed keyword, never a filename or path — the shape that
            // would betray leaked file content.
            assert!(
                !code.contains('.'),
                "a code must never look like a filename"
            );
            assert!(!code.contains('/'), "a code must never look like a path");
        }
    }
}
