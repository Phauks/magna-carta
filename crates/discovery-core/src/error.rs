//! The discovery engine's error type and its stable edge error codes.

use engine_host::wasm_edge::EdgeError;

/// What reading a document can fail at. A `&'static str` code is a compile-time constant and cannot
/// carry a runtime file name, a path, or a byte of the document — and this engine's whole input is
/// privileged material, so that property is the point rather than a nicety.
///
/// Every variant is a different sentence a firm has to be able to say about a document it did not
/// produce. "We could not read this, and it was an encrypted Word document" is defensible;
/// "extraction failed" is not, which is why there is no general-purpose failure variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiscoveryError {
    /// The bytes are the format they claim to be, but damaged past reading.
    Corrupt,
    /// The document's content is encrypted. Readable with a key nobody supplied, not damaged.
    Encrypted,
    /// The document is locked with a user password. Distinguished from `Encrypted` because the
    /// remedy differs: a password can be asked for, a key cannot.
    PasswordProtected,
    /// Identified, and this engine has no native route for it. The identified format travels
    /// separately from the error, so a caller can still record what the document actually was.
    UnsupportedFormat,
    /// A declared bound (input size, page count, text size, XML depth, entry count) was exceeded.
    LimitExceeded,
    /// An archive tripped one of the expansion guards — depth, ratio, total bytes, entry count, or
    /// a path that tried to escape the extraction root.
    ContainerGuardTripped,
    /// The document was read successfully and holds no text at all. Deliberately an error and not
    /// an empty success: an empty index entry asserts "this document contains no words", which is
    /// the one answer a discovery search must never give wrongly.
    NoTextExtracted,
}

pub const DISCOVERY_ERROR_CODES: &[&str] = &[
    "corrupt",
    "encrypted",
    "passwordProtected",
    "unsupportedFormat",
    "limitExceeded",
    "containerGuardTripped",
    "noTextExtracted",
];

impl EdgeError for DiscoveryError {
    fn code(&self) -> &'static str {
        match self {
            DiscoveryError::Corrupt => "corrupt",
            DiscoveryError::Encrypted => "encrypted",
            DiscoveryError::PasswordProtected => "passwordProtected",
            DiscoveryError::UnsupportedFormat => "unsupportedFormat",
            DiscoveryError::LimitExceeded => "limitExceeded",
            DiscoveryError::ContainerGuardTripped => "containerGuardTripped",
            DiscoveryError::NoTextExtracted => "noTextExtracted",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine_host::wasm_edge::allowed_code;

    const EVERY_VARIANT: &[DiscoveryError] = &[
        DiscoveryError::Corrupt,
        DiscoveryError::Encrypted,
        DiscoveryError::PasswordProtected,
        DiscoveryError::UnsupportedFormat,
        DiscoveryError::LimitExceeded,
        DiscoveryError::ContainerGuardTripped,
        DiscoveryError::NoTextExtracted,
    ];

    #[test]
    fn every_error_maps_to_a_declared_static_code() {
        for error in EVERY_VARIANT {
            assert!(allowed_code(error.code(), DISCOVERY_ERROR_CODES));
        }
    }

    #[test]
    fn the_declared_code_set_is_exactly_the_engines_error_variants() {
        // One declared code per variant and no more: a code that slipped in without a variant (or a
        // variant with no code) would let the edge emit a string this set never vetted.
        assert_eq!(DISCOVERY_ERROR_CODES.len(), EVERY_VARIANT.len());
        let mut emitted: Vec<&str> = EVERY_VARIANT.iter().map(|error| error.code()).collect();
        emitted.sort_unstable();
        let mut declared = DISCOVERY_ERROR_CODES.to_vec();
        declared.sort_unstable();
        assert_eq!(emitted, declared);
    }

    /// The privileged-content rule, enforced on the shape of the codes themselves. A code is a fixed
    /// keyword; anything that looks like a file name, a path, or a sentence is the shape a leaked
    /// document fragment would take.
    #[test]
    fn no_code_can_look_like_a_file_name_a_path_or_content() {
        for code in DISCOVERY_ERROR_CODES {
            assert!(
                !code.contains('.'),
                "a code must never look like a file name"
            );
            assert!(!code.contains('/'), "a code must never look like a path");
            assert!(!code.contains(' '), "a code must never carry prose");
            assert!(
                code.chars()
                    .all(|character| character.is_ascii_alphabetic()),
                "a code is a fixed ASCII keyword"
            );
        }
    }

    #[test]
    fn a_content_bearing_string_is_rejected_by_the_guard() {
        assert!(!allowed_code(
            "plaintiff-privileged-memo.docx",
            DISCOVERY_ERROR_CODES
        ));
    }
}
