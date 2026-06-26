use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Pdf,
    Zip,
    Ooxml,
}

#[derive(Debug, Clone)]
pub struct DecryptedFile {
    pub bytes: Vec<u8>,
    pub filename_hint: Option<String>,
}

/// Per-format parsed key-derivation parameters, used by `verify_guess` to test a
/// candidate without re-parsing the container. Variants are filled in by each
/// adapter task; `Placeholder` exists only until the first real variant lands.
#[derive(Debug, Clone)]
pub enum KdfParams {
    Placeholder,
}

#[derive(Debug, Clone)]
pub struct RecoveryJob {
    pub format: Format,
    /// The cracker hash string (e.g. `$pdf$...`), directly consumable by hashcat.
    pub hash: String,
    /// The hashcat mode matching `hash` (e.g. 10700 for PDF R6).
    pub hashcat_mode: u32,
    pub params: KdfParams,
}

#[derive(Debug, Error)]
pub enum DecryptError {
    #[error("wrong password")]
    WrongPassword,
    #[error("file is not encrypted")]
    NotEncrypted,
    #[error("unsupported variant: {0}")]
    Unsupported(String),
    #[error("malformed container: {0}")]
    Malformed(String),
}

#[derive(Debug, Error)]
pub enum ExtractError {
    #[error("file is not encrypted")]
    NotEncrypted,
    #[error("unsupported variant: {0}")]
    Unsupported(String),
    #[error("malformed container: {0}")]
    Malformed(String),
}

pub trait FormatAdapter {
    fn strip_with_key(bytes: &[u8], password: &str) -> Result<DecryptedFile, DecryptError>;
    fn extract_hash(bytes: &[u8]) -> Result<RecoveryJob, ExtractError>;
    fn verify_guess(job: &RecoveryJob, candidate: &str) -> bool;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovery_job_round_trips_fields() {
        let job = RecoveryJob {
            format: Format::Pdf,
            hash: "$pdf$...".into(),
            hashcat_mode: 10700,
            params: KdfParams::Placeholder,
        };
        assert_eq!(job.format, Format::Pdf);
        assert_eq!(job.hashcat_mode, 10700);
        assert!(job.hash.starts_with("$pdf$"));
    }
}
