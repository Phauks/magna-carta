//! The JSON wire contract for the discovery container. Serde mirrors of the engine's pure model
//! types, plus the one-way conversions from them.
//!
//! THIS MODULE IS THE ONLY PLACE A LABEL IS ASSIGNED, and every label is a fixed `&'static str`
//! taken from the engine's own vocabulary — never derived from file content. That matters more here
//! than in any other container: everything this service reads is privileged, and a label built from
//! input would be a way for a document's own bytes to leave in a response body.
//!
//! Bytes cross the wire base64-encoded, because an expanded archive's entries are binary and JSON is
//! not.

use base64::Engine as _;

use discovery_core::archive::{ArchiveEntry, ExpandedEntry, Expansion, SkippedEntry};
use discovery_core::extract::ExtractedDocument;
use discovery_core::identify::Identification;
use discovery_core::{DigestSet, DocumentRead, DocumentReading, Passage};

fn encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentificationDto {
    pub format: &'static str,
    pub confidence: &'static str,
    pub charset: Option<&'static str>,
}

impl From<Identification> for IdentificationDto {
    fn from(identification: Identification) -> Self {
        Self {
            format: identification.format.label(),
            confidence: identification.confidence.label(),
            charset: identification.charset,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DigestSetDto {
    pub md5: String,
    pub sha1: String,
    pub sha256: String,
    pub sha384: String,
    pub sha512: String,
    pub size_bytes: u64,
}

impl From<DigestSet> for DigestSetDto {
    fn from(digests: DigestSet) -> Self {
        Self {
            md5: digests.md5,
            sha1: digests.sha1,
            sha256: digests.sha256,
            sha384: digests.sha384,
            sha512: digests.sha512,
            size_bytes: digests.size_bytes,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PassageDto {
    pub chunk_id: String,
    pub text: String,
    pub page: usize,
}

impl From<&Passage> for PassageDto {
    fn from(passage: &Passage) -> Self {
        Self {
            chunk_id: passage.chunk_id.clone(),
            text: passage.text.clone(),
            page: passage.page,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentDateDto {
    pub value: String,
    pub source: &'static str,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingDto {
    /// `read`, `needsConversion`, or `needsExpansion`. A document that reaches its text through the
    /// conversion engine, or whose contents are separate documents, says so rather than being
    /// reported as a document that read to nothing.
    pub outcome: &'static str,
    pub identification: IdentificationDto,
    pub passages: Vec<PassageDto>,
    pub page_count: Option<usize>,
    pub document_date: Option<DocumentDateDto>,
    /// Zero-based page indexes whose words exist only as pixels. EMPTY for a born-digital document,
    /// which is what stops the caller from sending it to recognition.
    pub pages_needing_recognition: Vec<usize>,
    /// The near-duplicate signature, hex — 64 bits does not survive a JSON number.
    pub text_fingerprint: Option<String>,
    pub digests: Option<DigestSetDto>,
}

impl From<DocumentReading> for ReadingDto {
    fn from(reading: DocumentReading) -> Self {
        match reading {
            DocumentReading::Read(read) => {
                let DocumentRead {
                    identification,
                    document,
                    passages,
                    fingerprint,
                    digests,
                } = *read;
                let ExtractedDocument {
                    page_count,
                    document_date,
                    pages_needing_recognition,
                    ..
                } = document;
                Self {
                    outcome: "read",
                    identification: identification.into(),
                    passages: passages.iter().map(PassageDto::from).collect(),
                    page_count,
                    document_date: document_date.map(|date| DocumentDateDto {
                        value: date.value,
                        source: date.source.label(),
                    }),
                    pages_needing_recognition,
                    text_fingerprint: Some(format!("{fingerprint:016x}")),
                    digests: Some(digests.into()),
                }
            }
            DocumentReading::NeedsConversion { identification, .. } => Self {
                outcome: "needsConversion",
                identification: identification.into(),
                passages: Vec::new(),
                page_count: None,
                document_date: None,
                pages_needing_recognition: Vec::new(),
                text_fingerprint: None,
                digests: None,
            },
            DocumentReading::NeedsExpansion { identification, .. } => Self {
                outcome: "needsExpansion",
                identification: identification.into(),
                passages: Vec::new(),
                page_count: None,
                document_date: None,
                pages_needing_recognition: Vec::new(),
                text_fingerprint: None,
                digests: None,
            },
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntryDto {
    pub path: String,
    pub compressed_size: u64,
    /// What the archive CLAIMS the entry expands to. Reported so a caller can describe the archive;
    /// never trusted, and never used to size anything.
    pub declared_size: u64,
    pub encrypted: bool,
    pub is_directory: bool,
    pub is_traversal: bool,
}

impl From<&ArchiveEntry> for ArchiveEntryDto {
    fn from(entry: &ArchiveEntry) -> Self {
        Self {
            path: entry.path.clone(),
            compressed_size: entry.compressed_size,
            declared_size: entry.declared_size,
            encrypted: entry.encrypted,
            is_directory: entry.is_directory,
            is_traversal: entry.is_traversal(),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpandedEntryDto {
    pub path: String,
    pub bytes: String,
    pub depth: usize,
}

impl From<&ExpandedEntry> for ExpandedEntryDto {
    fn from(entry: &ExpandedEntry) -> Self {
        Self {
            path: entry.path.clone(),
            bytes: encode(&entry.bytes),
            depth: entry.depth,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedEntryDto {
    pub path: String,
    pub reason: &'static str,
    pub depth: usize,
}

impl From<&SkippedEntry> for SkippedEntryDto {
    fn from(entry: &SkippedEntry) -> Self {
        Self {
            path: entry.path.clone(),
            reason: entry.reason.label(),
            depth: entry.depth,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpansionDto {
    pub entries: Vec<ExpandedEntryDto>,
    /// Entries that were described rather than expanded, each with the guard that stopped it. Never
    /// empty silence: an entry that did not come out is named here or it did not exist.
    pub skipped: Vec<SkippedEntryDto>,
    pub total_expanded_bytes: u64,
}

impl From<Expansion> for ExpansionDto {
    fn from(expansion: Expansion) -> Self {
        Self {
            entries: expansion
                .entries
                .iter()
                .map(ExpandedEntryDto::from)
                .collect(),
            skipped: expansion
                .skipped
                .iter()
                .map(SkippedEntryDto::from)
                .collect(),
            total_expanded_bytes: expansion.total_expanded_bytes,
        }
    }
}
