//! decryption-core: in-house file decryption + password-recovery primitives.
//! One FormatAdapter per format behind magic-byte detection; shared RustCrypto
//! primitives. Consumed by the WASM wrapper and the Worker.

mod adapter;
pub use adapter::{
    DecryptError, DecryptedFile, ExtractError, Format, FormatAdapter, KdfParams, RecoveryJob,
};

mod detect;
pub use detect::detect;

mod hex;

mod ooxml;
pub use ooxml::OoxmlAdapter;

mod pdf;
pub use pdf::PdfAdapter;

mod zip_adapter;
pub use zip_adapter::ZipAdapter;

mod rules;
pub use rules::{apply_rule, expand, parse_rules, Rule, RuleError, RuleSet};

mod tier;
pub use tier::{recovery_tier, RecoveryTier};

mod shard;
pub use shard::{shard_candidate_count, split_keyspace, ShardSpec};

#[cfg(not(target_arch = "wasm32"))]
mod dictionary;
#[cfg(not(target_arch = "wasm32"))]
pub use dictionary::{run_dictionary, verify};

#[cfg(not(target_arch = "wasm32"))]
mod recover;
#[cfg(not(target_arch = "wasm32"))]
pub use recover::{recover_shard, ShardOutcome};

#[cfg(target_arch = "wasm32")]
mod wasm;

/// Decrypt a password-protected file by detecting its format and dispatching to the
/// matching adapter. Returns `DecryptError::Unsupported` when the format is not
/// recognised by `detect`.
pub fn strip_with_key(bytes: &[u8], password: &str) -> Result<DecryptedFile, DecryptError> {
    match detect(bytes) {
        Some(Format::Pdf) => PdfAdapter::strip_with_key(bytes, password),
        Some(Format::Zip) => ZipAdapter::strip_with_key(bytes, password),
        Some(Format::Ooxml) => OoxmlAdapter::strip_with_key(bytes, password),
        None => Err(DecryptError::Unsupported("unrecognized file format".into())),
    }
}

/// Extract the password-recovery hash from a password-protected file by detecting its
/// format and dispatching to the matching adapter. Returns `ExtractError::Unsupported`
/// when the format is not recognised by `detect`.
pub fn extract_hash(bytes: &[u8]) -> Result<RecoveryJob, ExtractError> {
    match detect(bytes) {
        Some(Format::Pdf) => PdfAdapter::extract_hash(bytes),
        Some(Format::Zip) => ZipAdapter::extract_hash(bytes),
        Some(Format::Ooxml) => OoxmlAdapter::extract_hash(bytes),
        None => Err(ExtractError::Unsupported("unrecognized file format".into())),
    }
}

#[cfg(test)]
mod smoke {
    #[test]
    fn crate_builds() {
        assert_eq!(2 + 2, 4);
    }
}
