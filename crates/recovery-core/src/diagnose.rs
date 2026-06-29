//! The diagnose dispatch framework (format -> diagnosis).

use crate::model::{CorruptionKind, DiagnosisReport, Recoverability};
use engine_host::format::{detect, Format};

pub fn diagnose(bytes: &[u8]) -> DiagnosisReport {
    if bytes.len() < 8 {
        return DiagnosisReport {
            detected_format: None,
            corruption: vec![CorruptionKind::Truncated],
            recoverability: Recoverability::Unrecoverable,
            repair_supported: false,
            detail: "input too short to identify".into(),
        };
    }
    match detect(bytes) {
        Some(Format::Zip) => {
            let (corruption, recoverability) = crate::zip_repair::diagnose_zip(bytes);
            DiagnosisReport {
                detected_format: Some(Format::Zip),
                corruption,
                recoverability,
                repair_supported: true,
                detail: "zip family".into(),
            }
        }
        Some(format) => DiagnosisReport {
            detected_format: Some(format),
            corruption: Vec::new(),
            recoverability: Recoverability::Unknown,
            repair_supported: false,
            detail: "format identified; no repair pillar registered yet".into(),
        },
        None => DiagnosisReport {
            detected_format: None,
            corruption: vec![CorruptionKind::Other],
            recoverability: Recoverability::Unrecoverable,
            repair_supported: false,
            detail: "no known format magic".into(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_a_known_format_but_reports_no_pillar_yet() {
        let report = diagnose(b"%PDF-1.7\nmore bytes here");
        assert_eq!(report.detected_format, Some(Format::Pdf));
        assert!(!report.repair_supported);
        assert_eq!(report.recoverability, Recoverability::Unknown);
    }

    #[test]
    fn unknown_bytes_are_unrecoverable() {
        let report = diagnose(b"not a known file at all");
        assert_eq!(report.detected_format, None);
        assert_eq!(report.recoverability, Recoverability::Unrecoverable);
    }

    #[test]
    fn too_short_input_is_truncated_and_unrecoverable() {
        let report = diagnose(b"PK");
        assert_eq!(report.recoverability, Recoverability::Unrecoverable);
        assert!(report.corruption.contains(&CorruptionKind::Truncated));
    }

    #[test]
    fn a_recognized_zip_reports_repair_supported() {
        // A minimal stored zip: local header for an empty file then EOCD is complex to
        // hand-build, so reuse the zip_repair helper indirectly via a real archive.
        let zip = crate::zip_repair::tests_build_minimal_zip();
        let report = diagnose(&zip);
        assert_eq!(report.detected_format, Some(Format::Zip));
        assert!(report.repair_supported);
    }
}
