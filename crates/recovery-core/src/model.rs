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
    /// True when the format pillars cannot help (unrecognized, or unrecoverable):
    /// carving may still extract embedded known-type files. Set by `diagnose`.
    pub carve_suggested: bool,
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
    /// Names of parts that were not present in the salvaged data but were
    /// synthesized during repair (e.g., OPC skeleton parts regenerated for
    /// an OOXML package). These parts exist in the output archive but were
    /// not recovered from the original bytes.
    pub synthesized: Vec<String>,
}

/// One output file a repair/carve produced. `media_type` is the detected MIME
/// where known (None when unknown). `name` is a sensible default the worker may
/// override from the original upload (a carve names fragments by index).
#[derive(Debug, Clone)]
pub struct SalvagedFile {
    pub name: String,
    pub bytes: Vec<u8>,
    pub media_type: Option<String>,
}

/// The product of a repair or carve: one-or-more recovered files plus the honest
/// loss manifest. Format pillars return exactly one file; carving returns many.
#[derive(Debug, Clone)]
pub struct RepairResult {
    pub files: Vec<SalvagedFile>,
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
            carve_suggested: false,
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
            synthesized: Vec::new(),
        };
        let result = RepairResult {
            files: vec![SalvagedFile {
                name: "repaired".to_string(),
                bytes: vec![1, 2, 3],
                media_type: None,
            }],
            loss,
        };
        assert!(!result.loss.fully_recovered);
        assert_eq!(result.loss.items.iter().filter(|i| !i.recovered).count(), 1);
    }
}
