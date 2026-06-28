//! The diagnose/repair data model shared across the format pillars.

use engine_host::format::Format;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Recoverability {
    Intact,
    Repairable,
    Partial,
    Unrecoverable,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CorruptionKind {
    Truncated,
    BrokenCentralDirectory,
    MissingEndOfCentralDirectory,
    BadLocalHeaders,
    MissingRequiredParts,
    BrokenCrossReference,
    Other,
}

#[derive(Debug, Clone)]
pub struct DiagnosisReport {
    pub detected_format: Option<Format>,
    pub corruption: Vec<CorruptionKind>,
    pub recoverability: Recoverability,
    pub repair_supported: bool,
    pub detail: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_report_carries_format_and_recoverability() {
        let report = DiagnosisReport {
            detected_format: Some(Format::Zip),
            corruption: vec![CorruptionKind::MissingEndOfCentralDirectory],
            recoverability: Recoverability::Repairable,
            repair_supported: true,
            detail: "central directory missing".into(),
        };
        assert_eq!(report.detected_format, Some(Format::Zip));
        assert_eq!(report.recoverability, Recoverability::Repairable);
        assert!(report.corruption.contains(&CorruptionKind::MissingEndOfCentralDirectory));
    }
}
