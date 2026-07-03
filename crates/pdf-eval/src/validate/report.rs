//! Per-document records and (Tasks 6–7) their aggregation into a summary plus a
//! regression diff against a committed baseline.

use crate::validate::operation::{Outcome, Safety};
use serde::Serialize;

/// One operation's verdict on one document, as written to the JSONL report.
#[derive(Debug, Clone, Serialize)]
pub struct DocumentReport {
    pub document: String,
    pub operation: String,
    pub outcome: Outcome,
    pub safety: Safety,
}
