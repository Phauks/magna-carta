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

/// The outcome of combining the three engines: either a verdict to return, or a signal that the
/// signature engine (clamd) could not run and nothing else flagged the file. The latter is a transient
/// fault to RETRY — never a verdict. A running container always booted with clamd ready (the entrypoint
/// fails fast otherwise), so a clamd-unavailable at scan time is exceptional; re-scanning it is correct,
/// and committing it as `unscanned` — pretending a bound engine was never there — is not. The only
/// honest `unscanned`/no-engine is the engine-less launch adapter in
/// packages/file-manager/src/scan-port.ts, where no engine is deployed at all.
pub enum CombineOutcome {
    Verdict(ScanResult),
    SignatureEngineUnavailable,
}

/// Combines the three engine results by precedence (most dangerous wins):
/// 1. a signature hit — clamd, else any yara match — is `infected` (clamd's name takes priority);
/// 2. a structural attack (bomb / nesting / entry-count) is `suspicious`;
/// 3. encrypted content that cannot be inspected is an honest `unscanned`;
/// 4. clamd unavailable with no other signal is a retryable engine fault, not a verdict;
/// 5. otherwise `clean`, badged when active content (PDF JS / Office macros) is present.
///
/// A definitive bad signal (infected / suspicious) wins even when clamd is unavailable — those are
/// never retried. Active content never alone gates to quarantine — the steps above take precedence.
pub fn combine(
    clam: &ClamVerdict,
    yara_matches: &[String],
    heuristic: Heuristic,
    engine_version: String,
) -> CombineOutcome {
    if let ClamVerdict::Infected(signature) = clam {
        return CombineOutcome::Verdict(ScanResult::Infected {
            engine_version,
            signature: signature.clone(),
        });
    }
    if let Some(identifier) = yara_matches.first() {
        return CombineOutcome::Verdict(ScanResult::Infected {
            engine_version,
            signature: identifier.clone(),
        });
    }
    if let Heuristic::Suspicious(reason) = heuristic {
        return CombineOutcome::Verdict(ScanResult::Suspicious {
            engine_version,
            reason: reason_token(reason).to_string(),
        });
    }
    if heuristic == Heuristic::Encrypted {
        return CombineOutcome::Verdict(ScanResult::Unscanned {
            engine_version,
            reason: "encrypted".to_string(),
        });
    }
    if matches!(clam, ClamVerdict::Unavailable) {
        return CombineOutcome::SignatureEngineUnavailable;
    }
    CombineOutcome::Verdict(ScanResult::Clean {
        engine_version,
        active_content: heuristic == Heuristic::ActiveContent,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn engine() -> String {
        "engine/1".to_string()
    }

    // Unwraps a definitive verdict; panics if combine signalled a retryable engine fault instead.
    fn verdict(outcome: CombineOutcome) -> ScanResult {
        match outcome {
            CombineOutcome::Verdict(result) => result,
            CombineOutcome::SignatureEngineUnavailable => {
                panic!("expected a verdict, got a retryable engine fault")
            }
        }
    }

    fn value(result: &ScanResult) -> serde_json::Value {
        serde_json::to_value(result).unwrap()
    }

    #[test]
    fn clamd_infection_is_infected_with_its_signature() {
        let result = verdict(combine(
            &ClamVerdict::Infected("Eicar".into()),
            &[],
            Heuristic::Clean,
            engine(),
        ));
        assert_eq!(
            value(&result),
            json!({"verdict":"infected","engineVersion":"engine/1","signature":"Eicar"})
        );
    }

    #[test]
    fn yara_match_is_infected_when_clamd_is_clean() {
        let result = verdict(combine(
            &ClamVerdict::Clean,
            &["rule_x".into()],
            Heuristic::Clean,
            engine(),
        ));
        assert_eq!(value(&result)["signature"], "rule_x");
        assert_eq!(value(&result)["verdict"], "infected");
    }

    #[test]
    fn clamd_signature_takes_priority_over_yara() {
        let result = verdict(combine(
            &ClamVerdict::Infected("Clam.Sig".into()),
            &["rule_x".into()],
            Heuristic::Clean,
            engine(),
        ));
        assert_eq!(value(&result)["signature"], "Clam.Sig");
    }

    #[test]
    fn infected_takes_precedence_over_a_structural_attack() {
        let result = verdict(combine(
            &ClamVerdict::Infected("X".into()),
            &[],
            Heuristic::Suspicious(Reason::ArchiveNesting),
            engine(),
        ));
        assert_eq!(value(&result)["verdict"], "infected");
    }

    #[test]
    fn structural_attack_is_suspicious_over_clean() {
        let result = verdict(combine(
            &ClamVerdict::Clean,
            &[],
            Heuristic::Suspicious(Reason::DecompressionBomb),
            engine(),
        ));
        assert_eq!(
            value(&result),
            json!({"verdict":"suspicious","engineVersion":"engine/1","reason":"decompression-bomb"})
        );
    }

    #[test]
    fn encrypted_is_unscanned_encrypted() {
        let result = verdict(combine(
            &ClamVerdict::Clean,
            &[],
            Heuristic::Encrypted,
            engine(),
        ));
        assert_eq!(
            value(&result),
            json!({"verdict":"unscanned","reason":"encrypted","engineVersion":"engine/1"})
        );
    }

    #[test]
    fn clamd_unavailable_with_no_other_signal_is_a_retryable_fault() {
        // The crux of the reconsidered combine: a clamd-unavailable, otherwise-clean file is NOT
        // flattened to unscanned/no-engine (which would commit a never-virus-scanned file as usable) —
        // it is a retryable engine fault the ingest consumer re-queues.
        let outcome = combine(&ClamVerdict::Unavailable, &[], Heuristic::Clean, engine());
        assert!(matches!(
            outcome,
            CombineOutcome::SignatureEngineUnavailable
        ));
    }

    #[test]
    fn a_definitive_signal_while_clamd_is_unavailable_is_still_a_verdict() {
        // clamd down but yara matched -> infected verdict, never a retry: a definitive bad signal is
        // acted on regardless of the signature engine's availability.
        let result = verdict(combine(
            &ClamVerdict::Unavailable,
            &["rule_x".into()],
            Heuristic::Clean,
            engine(),
        ));
        assert_eq!(value(&result)["verdict"], "infected");
    }

    #[test]
    fn encrypted_while_clamd_is_unavailable_is_still_unscanned_encrypted() {
        // Encryption blocks inspection; re-scanning cannot help, so it is an honest verdict, not a fault.
        let result = verdict(combine(
            &ClamVerdict::Unavailable,
            &[],
            Heuristic::Encrypted,
            engine(),
        ));
        assert_eq!(value(&result)["reason"], "encrypted");
    }

    #[test]
    fn clean_carries_the_active_content_badge() {
        let result = verdict(combine(
            &ClamVerdict::Clean,
            &[],
            Heuristic::ActiveContent,
            engine(),
        ));
        assert_eq!(
            value(&result),
            json!({"verdict":"clean","engineVersion":"engine/1","activeContent":true})
        );
    }

    #[test]
    fn plain_clean_has_no_active_content() {
        let result = verdict(combine(
            &ClamVerdict::Clean,
            &[],
            Heuristic::Clean,
            engine(),
        ));
        assert_eq!(
            value(&result),
            json!({"verdict":"clean","engineVersion":"engine/1","activeContent":false})
        );
    }
}
