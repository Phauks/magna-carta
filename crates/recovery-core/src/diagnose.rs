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
        Some(Format::Ole2) => {
            let (corruption, recoverability) = crate::cfb_repair::diagnose_cfb(bytes);
            DiagnosisReport {
                detected_format: Some(Format::Ole2),
                corruption,
                recoverability,
                repair_supported: true,
                detail: "cfb / ole2 compound file".into(),
            }
        }
        Some(Format::Pdf) => {
            let (corruption, recoverability) = crate::pdf_repair::diagnose_pdf(bytes);
            DiagnosisReport {
                detected_format: Some(Format::Pdf),
                corruption,
                recoverability,
                repair_supported: true,
                detail: "pdf document".into(),
            }
        }
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

    #[test]
    fn a_recognized_cfb_reports_repair_supported() {
        let cfb = crate::cfb_repair::tests_build_minimal_cfb();
        let report = diagnose(&cfb);
        assert_eq!(report.detected_format, Some(Format::Ole2));
        assert!(report.repair_supported);
    }

    #[test]
    fn a_recognized_pdf_reports_repair_supported() {
        let pdf = b"%PDF-1.5\n1 0 obj\n<< /Type /Catalog >>\nendobj\n";
        let report = diagnose(pdf);
        assert_eq!(report.detected_format, Some(Format::Pdf));
        assert!(report.repair_supported);
    }
}
