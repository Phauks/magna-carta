use crate::{Format, OoxmlAdapter, PdfAdapter, RecoveryJob, ZipAdapter};
use rayon::prelude::*;

/// Dispatch a single candidate password to the appropriate format adapter's verifier.
/// Returns `true` if the candidate authenticates against the job's hash parameters.
pub fn verify(job: &RecoveryJob, candidate: &str) -> bool {
    match job.format {
        Format::Pdf => PdfAdapter::verify_guess(job, candidate),
        Format::Zip => ZipAdapter::verify_guess(job, candidate),
        Format::Ooxml => OoxmlAdapter::verify_guess(job, candidate),
    }
}

/// Test every candidate in `candidates` against `job` in parallel (rayon) and return the
/// first one that authenticates, or `None` if none do. Order of the returned winner is
/// not guaranteed — `find_any` returns whichever thread finishes first.
pub fn run_dictionary(
    job: &RecoveryJob,
    candidates: impl IntoIterator<Item = String>,
) -> Option<String> {
    let words: Vec<String> = candidates.into_iter().collect();
    words.par_iter().find_any(|c| verify(job, c)).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    // hashcat example_hashes mode 9600 (MS Office 2013 agile, `$office$`).
    // Password for every hashcat example vector is "hashcat".
    // Source: https://hashcat.net/wiki/doku.php?id=example_hashes
    const OFFICE_2013_EXAMPLE: &str = "$office$*2013*100000*256*16*7dd611d7eb4c899f74816d1dec817b3b*948dc0b2c2c6c32f14b5995a543ad037*0b7ee0e48e935f937192a59de48a7d561ef2691d5c8a3ba87ec2d04402a94895";

    #[test]
    fn finds_password_in_wordlist() {
        let params =
            crate::OoxmlAdapter::parse_hash(OFFICE_2013_EXAMPLE).expect("parses the example hash");
        let job = crate::RecoveryJob {
            format: crate::Format::Ooxml,
            hash: OFFICE_2013_EXAMPLE.into(),
            hashcat_mode: 9600,
            params,
        };
        let words = vec![
            "foo".to_string(),
            "bar".to_string(),
            "hashcat".to_string(),
            "baz".to_string(),
        ];
        assert_eq!(run_dictionary(&job, words), Some("hashcat".to_string()));
    }

    #[test]
    fn returns_none_when_absent() {
        let params =
            crate::OoxmlAdapter::parse_hash(OFFICE_2013_EXAMPLE).expect("parses the example hash");
        let job = crate::RecoveryJob {
            format: crate::Format::Ooxml,
            hash: OFFICE_2013_EXAMPLE.into(),
            hashcat_mode: 9600,
            params,
        };
        assert_eq!(
            run_dictionary(&job, vec!["a".to_string(), "b".to_string()]),
            None
        );
    }
}
