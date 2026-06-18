use crate::clamav::ClamVerdict;
use crate::heuristics::{Heuristic, Reason};
use serde::Serialize;

/// The scan verdict returned to the worker adapter — mirrors the TypeScript `ScanResult` union exactly
/// (the Rust⇄TS boundary in packages/file-manager/src/scan-port.ts). Tagged by `verdict`; the fields
/// are camelCase to match. `oversize` is never produced here — the ingest pipeline decides that before
/// the engine is called.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "verdict", rename_all = "lowercase")]
pub enum ScanResult {
    Clean {
        #[serde(rename = "engineVersion")]
        engine_version: String,
        #[serde(rename = "activeContent")]
        active_content: bool,
    },
    Infected {
        #[serde(rename = "engineVersion")]
        engine_version: String,
        signature: String,
    },
    Unscanned {
        reason: String,
        #[serde(rename = "engineVersion")]
        engine_version: String,
    },
    Suspicious {
        #[serde(rename = "engineVersion")]
        engine_version: String,
        reason: String,
    },
}

fn reason_token(reason: Reason) -> &'static str {
    match reason {
        Reason::DecompressionBomb => "decompression-bomb",
        Reason::ArchiveNesting => "archive-nesting",
        Reason::ArchiveEntryCount => "archive-entry-count",
    }
}

/// Combines the three engine results into one verdict by precedence (most dangerous wins):
/// 1. a signature hit — clamd, else any yara match — is `infected` (clamd's name takes priority);
/// 2. a structural attack (bomb / nesting / entry-count) is `suspicious`;
/// 3. an inability to inspect — encrypted content, or clamd unavailable with no other signal — is
///    `unscanned`;
/// 4. otherwise `clean`, badged when active content (PDF JS / Office macros) is present.
///
/// Active content never alone gates to quarantine — the steps above take precedence over the badge.
pub fn combine(
    clam: &ClamVerdict,
    yara_matches: &[String],
    heuristic: Heuristic,
    engine_version: String,
) -> ScanResult {
    if let ClamVerdict::Infected(signature) = clam {
        return ScanResult::Infected {
            engine_version,
            signature: signature.clone(),
        };
    }
    if let Some(identifier) = yara_matches.first() {
        return ScanResult::Infected {
            engine_version,
            signature: identifier.clone(),
        };
    }
    if let Heuristic::Suspicious(reason) = heuristic {
        return ScanResult::Suspicious {
            engine_version,
            reason: reason_token(reason).to_string(),
        };
    }
    if heuristic == Heuristic::Encrypted {
        return ScanResult::Unscanned {
            engine_version,
            reason: "encrypted".to_string(),
        };
    }
    if matches!(clam, ClamVerdict::Unavailable) {
        return ScanResult::Unscanned {
            engine_version,
            reason: "no-engine".to_string(),
        };
    }
    ScanResult::Clean {
        engine_version,
        active_content: heuristic == Heuristic::ActiveContent,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn engine() -> String {
        "engine/1".to_string()
    }

    fn value(result: &ScanResult) -> serde_json::Value {
        serde_json::to_value(result).unwrap()
    }

    #[test]
    fn clamd_infection_is_infected_with_its_signature() {
        let result = combine(
            &ClamVerdict::Infected("Eicar".into()),
            &[],
            Heuristic::Clean,
            engine(),
        );
        assert_eq!(
            value(&result),
            json!({"verdict":"infected","engineVersion":"engine/1","signature":"Eicar"})
        );
    }

    #[test]
    fn yara_match_is_infected_when_clamd_is_clean() {
        let result = combine(
            &ClamVerdict::Clean,
            &["rule_x".into()],
            Heuristic::Clean,
            engine(),
        );
        assert_eq!(value(&result)["signature"], "rule_x");
        assert_eq!(value(&result)["verdict"], "infected");
    }

    #[test]
    fn clamd_signature_takes_priority_over_yara() {
        let result = combine(
            &ClamVerdict::Infected("Clam.Sig".into()),
            &["rule_x".into()],
            Heuristic::Clean,
            engine(),
        );
        assert_eq!(value(&result)["signature"], "Clam.Sig");
    }

    #[test]
    fn infected_takes_precedence_over_a_structural_attack() {
        let result = combine(
            &ClamVerdict::Infected("X".into()),
            &[],
            Heuristic::Suspicious(Reason::ArchiveNesting),
            engine(),
        );
        assert_eq!(value(&result)["verdict"], "infected");
    }

    #[test]
    fn structural_attack_is_suspicious_over_clean() {
        let result = combine(
            &ClamVerdict::Clean,
            &[],
            Heuristic::Suspicious(Reason::DecompressionBomb),
            engine(),
        );
        assert_eq!(
            value(&result),
            json!({"verdict":"suspicious","engineVersion":"engine/1","reason":"decompression-bomb"})
        );
    }

    #[test]
    fn encrypted_is_unscanned_encrypted() {
        let result = combine(&ClamVerdict::Clean, &[], Heuristic::Encrypted, engine());
        assert_eq!(
            value(&result),
            json!({"verdict":"unscanned","reason":"encrypted","engineVersion":"engine/1"})
        );
    }

    #[test]
    fn clamd_unavailable_is_unscanned_no_engine() {
        let result = combine(&ClamVerdict::Unavailable, &[], Heuristic::Clean, engine());
        assert_eq!(
            value(&result),
            json!({"verdict":"unscanned","reason":"no-engine","engineVersion":"engine/1"})
        );
    }

    #[test]
    fn clean_carries_the_active_content_badge() {
        let result = combine(&ClamVerdict::Clean, &[], Heuristic::ActiveContent, engine());
        assert_eq!(
            value(&result),
            json!({"verdict":"clean","engineVersion":"engine/1","activeContent":true})
        );
    }

    #[test]
    fn plain_clean_has_no_active_content() {
        let result = combine(&ClamVerdict::Clean, &[], Heuristic::Clean, engine());
        assert_eq!(
            value(&result),
            json!({"verdict":"clean","engineVersion":"engine/1","activeContent":false})
        );
    }
}
