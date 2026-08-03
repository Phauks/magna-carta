use crate::clamav::ClamVerdict;
use crate::heuristics::{Heuristic, Reason};
use crate::yara::RuleMatch;
use serde::Serialize;

/// The clamd outcome as a fact (not a verdict): clean, a named signature, or the engine was unavailable.
/// The container reports the raw fact; the app — which holds the firm's policy — decides what it means
/// (a clamd-`Unavailable` with no other signal is a retry the app raises, never a fabricated clean).
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum ClamFact {
    Clean,
    Infected { signature: String },
    Unavailable,
}

/// A structural-heuristic fact: none, a named structural attack, encrypted/uninspectable, or active
/// content. A fact, not a verdict — the app maps it to its firm's policy.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum HeuristicFact {
    None,
    Structural { reason: String },
    Encrypted,
    ActiveContent,
}

/// Per-engine wall-clock timings, so the app can attribute scan latency to clamd vs. the in-process
/// engines (yara + structural heuristics) without re-deriving it from request-level timing.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct EngineTimings {
    #[serde(rename = "clamdMs")]
    pub clamd_ms: u64,
    #[serde(rename = "yaraMs")]
    pub yara_ms: u64,
}

/// The raw scan facts the container returns. The app computes the per-firm verdict from this; the
/// container never decides infected/suspicious. A clamd-unavailable with no other signal is surfaced
/// honestly (`clam: unavailable`) so the app can RETRY — never a fabricated clean.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct RawScanResult {
    #[serde(rename = "engineVersion")]
    pub engine_version: String,
    pub clam: ClamFact,
    pub heuristic: HeuristicFact,
    pub matches: Vec<RuleMatch>,
    pub timings: EngineTimings,
}

/// Maps a structural-heuristic reason to its stable wire token (the app keys policy off these strings).
pub fn structural_reason_token(reason: Reason) -> &'static str {
    match reason {
        Reason::DecompressionBomb => "decompression-bomb",
        Reason::ArchiveNesting => "archive-nesting",
        Reason::ArchiveEntryCount => "archive-entry-count",
    }
}

/// Lowers the structural-heuristic verdict to its wire fact.
pub fn heuristic_fact(heuristic: Heuristic) -> HeuristicFact {
    match heuristic {
        Heuristic::Clean => HeuristicFact::None,
        Heuristic::Suspicious(reason) => HeuristicFact::Structural {
            reason: structural_reason_token(reason).to_string(),
        },
        Heuristic::Encrypted => HeuristicFact::Encrypted,
        Heuristic::ActiveContent => HeuristicFact::ActiveContent,
    }
}

/// Lowers the clamd outcome to its wire fact.
pub fn clam_fact(clam: &ClamVerdict) -> ClamFact {
    match clam {
        ClamVerdict::Clean => ClamFact::Clean,
        ClamVerdict::Infected(signature) => ClamFact::Infected {
            signature: signature.clone(),
        },
        ClamVerdict::Unavailable => ClamFact::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serializes_a_clean_raw_result() {
        let raw = RawScanResult {
            engine_version: "engine/1".into(),
            clam: ClamFact::Clean,
            heuristic: HeuristicFact::None,
            matches: vec![],
            timings: EngineTimings {
                clamd_ms: 5,
                yara_ms: 2,
            },
        };
        assert_eq!(
            serde_json::to_value(&raw).unwrap(),
            json!({"engineVersion":"engine/1","clam":{"state":"clean"},
                   "heuristic":{"kind":"none"},"matches":[],"timings":{"clamdMs":5,"yaraMs":2}})
        );
    }

    #[test]
    fn an_infected_clam_fact_carries_its_signature() {
        let fact = clam_fact(&ClamVerdict::Infected("Eicar-Test-Signature".into()));
        assert_eq!(
            serde_json::to_value(&fact).unwrap(),
            json!({"state": "infected", "signature": "Eicar-Test-Signature"})
        );
    }

    #[test]
    fn an_unavailable_clam_fact_is_surfaced_honestly() {
        // The crux of the raw-facts contract: clamd unavailable is a fact the app sees, not a 503 the
        // container decides and not a fabricated clean.
        assert_eq!(clam_fact(&ClamVerdict::Unavailable), ClamFact::Unavailable);
    }

    #[test]
    fn a_structural_heuristic_lowers_to_its_reason_token() {
        assert_eq!(
            serde_json::to_value(heuristic_fact(Heuristic::Suspicious(
                Reason::DecompressionBomb
            )))
            .unwrap(),
            json!({"kind": "structural", "reason": "decompression-bomb"})
        );
    }
}
