//! The JSON wire contract for the recovery container. Serde-serializable
//! mirrors of the engine's pure model types, plus the one-way conversions from
//! `recovery_core` values. This module is the only place a human-readable string
//! is assigned to an enum: every mapping below is a fixed `&'static str`, never
//! derived from file content, so no privileged bytes can escape through a label.
//! Free-text `detail` fields are carried verbatim from the engine, which already
//! sets them to fixed literals.

use base64::Engine as _;

use engine_host::format::Format;
use recovery_core::model::{
    CorruptionKind, DiagnosisReport, LossManifest, Recoverability, RecoveredItem, RepairResult,
    SalvagedFile,
};

/// Fixed label for a detected container format. A `&'static str`, never file
/// bytes.
fn format_label(format: Format) -> &'static str {
    match format {
        Format::Pdf => "pdf",
        Format::Zip => "zip",
        Format::Ole2 => "ole2",
    }
}

/// Fixed label for a recoverability verdict.
fn recoverability_label(recoverability: Recoverability) -> &'static str {
    match recoverability {
        Recoverability::Intact => "intact",
        Recoverability::Repairable => "repairable",
        Recoverability::Partial => "partial",
        Recoverability::Unrecoverable => "unrecoverable",
        Recoverability::Unknown => "unknown",
    }
}

/// Fixed label for a corruption finding.
fn corruption_label(kind: CorruptionKind) -> &'static str {
    match kind {
        CorruptionKind::Truncated => "truncated",
        CorruptionKind::BrokenCentralDirectory => "brokenCentralDirectory",
        CorruptionKind::MissingEndOfCentralDirectory => "missingEndOfCentralDirectory",
        CorruptionKind::BadLocalHeaders => "badLocalHeaders",
        CorruptionKind::MissingRequiredParts => "missingRequiredParts",
        CorruptionKind::BrokenCrossReference => "brokenCrossReference",
        CorruptionKind::Other => "other",
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosisReportDto {
    pub detected_format: Option<String>,
    pub corruption: Vec<String>,
    pub recoverability: String,
    pub repair_supported: bool,
    pub carve_suggested: bool,
    pub detail: String,
}

impl From<DiagnosisReport> for DiagnosisReportDto {
    fn from(report: DiagnosisReport) -> Self {
        Self {
            detected_format: report.detected_format.map(|f| format_label(f).to_string()),
            corruption: report
                .corruption
                .into_iter()
                .map(|k| corruption_label(k).to_string())
                .collect(),
            recoverability: recoverability_label(report.recoverability).to_string(),
            repair_supported: report.repair_supported,
            carve_suggested: report.carve_suggested,
            detail: report.detail,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalvagedFileDto {
    pub name: String,
    pub media_type: Option<String>,
    pub content_base64: String,
}

impl From<SalvagedFile> for SalvagedFileDto {
    fn from(file: SalvagedFile) -> Self {
        Self {
            name: file.name,
            media_type: file.media_type,
            content_base64: base64::engine::general_purpose::STANDARD.encode(&file.bytes),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveredItemDto {
    pub name: String,
    pub recovered: bool,
    pub detail: String,
}

impl From<RecoveredItem> for RecoveredItemDto {
    fn from(item: RecoveredItem) -> Self {
        Self {
            name: item.name,
            recovered: item.recovered,
            detail: item.detail,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LossManifestDto {
    pub items: Vec<RecoveredItemDto>,
    pub fully_recovered: bool,
    pub synthesized: Vec<String>,
}

impl From<LossManifest> for LossManifestDto {
    fn from(loss: LossManifest) -> Self {
        Self {
            items: loss.items.into_iter().map(RecoveredItemDto::from).collect(),
            fully_recovered: loss.fully_recovered,
            synthesized: loss.synthesized,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairResultDto {
    pub files: Vec<SalvagedFileDto>,
    pub loss: LossManifestDto,
}

impl From<RepairResult> for RepairResultDto {
    fn from(result: RepairResult) -> Self {
        Self {
            files: result
                .files
                .into_iter()
                .map(SalvagedFileDto::from)
                .collect(),
            loss: LossManifestDto::from(result.loss),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_repair_result_maps_and_the_bytes_round_trip_through_base64() {
        let original_bytes = vec![0x25, 0x50, 0x44, 0x46, 0x00, 0xFF];
        let result = RepairResult {
            files: vec![SalvagedFile {
                name: "repaired.pdf".to_string(),
                bytes: original_bytes.clone(),
                media_type: Some("application/pdf".to_string()),
            }],
            loss: LossManifest {
                items: vec![RecoveredItem {
                    name: "body".to_string(),
                    recovered: true,
                    detail: String::new(),
                }],
                fully_recovered: true,
                synthesized: vec!["xref".to_string()],
            },
        };

        let dto = RepairResultDto::from(result.clone());

        assert_eq!(dto.files.len(), 1);
        assert_eq!(dto.files[0].name, "repaired.pdf");
        assert_eq!(dto.files[0].media_type.as_deref(), Some("application/pdf"));
        assert_eq!(dto.loss.fully_recovered, result.loss.fully_recovered);
        assert_eq!(dto.loss.synthesized, vec!["xref".to_string()]);

        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&dto.files[0].content_base64)
            .unwrap();
        assert_eq!(decoded, original_bytes);
    }

    #[test]
    fn a_diagnosis_report_maps_enums_to_fixed_labels_and_renames_to_camel_case() {
        let report = DiagnosisReport {
            detected_format: Some(Format::Zip),
            corruption: vec![
                CorruptionKind::MissingEndOfCentralDirectory,
                CorruptionKind::Truncated,
            ],
            recoverability: Recoverability::Repairable,
            repair_supported: true,
            carve_suggested: false,
            detail: "central directory missing".to_string(),
        };

        let dto = DiagnosisReportDto::from(report);
        let json = serde_json::to_value(&dto).unwrap();

        assert_eq!(json["detectedFormat"], "zip");
        assert_eq!(json["corruption"][0], "missingEndOfCentralDirectory");
        assert_eq!(json["corruption"][1], "truncated");
        assert_eq!(json["recoverability"], "repairable");
        assert_eq!(json["repairSupported"], true);
        assert_eq!(json["carveSuggested"], false);
        assert_eq!(json["detail"], "central directory missing");
    }
}
