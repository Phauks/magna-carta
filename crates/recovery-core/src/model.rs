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

#[derive(Debug, Clone)]
pub struct RecoveredItem {
    pub name: String,
    pub recovered: bool,
    pub detail: String,
}

#[derive(Debug, Clone)]
pub struct LossManifest {
    pub items: Vec<RecoveredItem>,
    pub fully_recovered: bool,
}

#[derive(Debug, Clone)]
pub struct RepairResult {
    pub salvaged: Vec<u8>,
    pub loss: LossManifest,
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
        assert!(report
            .corruption
            .contains(&CorruptionKind::MissingEndOfCentralDirectory));
    }
}

#[cfg(test)]
mod repair_model_tests {
    use super::*;

    #[test]
    fn a_partial_recovery_is_not_marked_fully_recovered() {
        let loss = LossManifest {
            items: vec![
                RecoveredItem {
                    name: "word/document.xml".into(),
                    recovered: true,
                    detail: String::new(),
                },
                RecoveredItem {
                    name: "word/media/image1.png".into(),
                    recovered: false,
                    detail: "stream truncated".into(),
                },
            ],
            fully_recovered: false,
        };
        let result = RepairResult {
            salvaged: vec![1, 2, 3],
            loss,
        };
        assert!(!result.loss.fully_recovered);
        assert_eq!(result.loss.items.iter().filter(|i| !i.recovered).count(), 1);
    }
}
