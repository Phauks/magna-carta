//! decryption-core: in-house file decryption + password-recovery primitives.
//! One FormatAdapter per format behind magic-byte detection; shared RustCrypto
//! primitives. Consumed by the WASM wrapper and the Worker (built in Plan 2).

#[cfg(test)]
mod smoke {
    #[test]
    fn crate_builds() {
        assert_eq!(2 + 2, 4);
    }
}
