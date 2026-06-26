//! decryption-core: in-house file decryption + password-recovery primitives.
//! One FormatAdapter per format behind magic-byte detection; shared RustCrypto
//! primitives. Consumed by the WASM wrapper and the Worker (built in Plan 2).

mod adapter;
pub use adapter::{
    DecryptError, DecryptedFile, ExtractError, Format, FormatAdapter, KdfParams, RecoveryJob,
};

mod detect;
pub use detect::detect;

mod pdf;
pub use pdf::PdfAdapter;

#[cfg(test)]
mod smoke {
    #[test]
    fn crate_builds() {
        assert_eq!(2 + 2, 4);
    }
}
