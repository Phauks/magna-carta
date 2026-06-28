use serde::{Deserialize, Serialize};
use yara_x::{Compiler, Rules, Scanner};

/// Per-rule metadata baked beside the compiled blob: the rule's Forge tier, its `score` meta, and whether
/// it is a heuristic `_SUSP_` rule. The runtime looks this up by rule id to enrich a bare yara match into a
/// fact the app can gate against a firm's policy — the container itself no longer decides a verdict.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RuleMeta {
    pub tier: crate::forge::Tier,
    pub score: i32,
    pub is_suspicious: bool,
}

pub type SideMap = std::collections::HashMap<String, RuleMeta>;

/// A single yara match enriched with its baked metadata. Serialized into the raw scan response.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RuleMatch {
    #[serde(rename = "ruleId")]
    pub rule_id: String,
    pub tier: crate::forge::Tier,
    pub score: i32,
    #[serde(rename = "isSuspicious")]
    pub is_suspicious: bool,
}

pub fn serialize_side_map(map: &SideMap) -> Vec<u8> {
    serde_json::to_vec(map).expect("a side map of plain data always serializes")
}

pub fn deserialize_side_map(bytes: &[u8]) -> Result<SideMap, String> {
    serde_json::from_slice(bytes).map_err(|error| format!("cannot deserialize rule side map: {error}"))
}

/// Enriches bare matched rule ids with their baked metadata. An id missing from the map (a blob/side-map
/// mismatch — should never happen, both are built together) fails safe toward flagging: `Tier::Core`,
/// score 0, not suspicious. Core has the narrowest tier rank (0), so it is within every firm policy,
/// meaning an unmapped match always counts and is never silently dropped. The fallback should never fire
/// because the rule blob and side-map are built in the same step; if it ever does, the match must count.
pub fn enrich_matches(ids: Vec<String>, map: &SideMap) -> Vec<RuleMatch> {
    ids.into_iter()
        .map(|rule_id| match map.get(&rule_id) {
            Some(meta) => RuleMatch {
                rule_id,
                tier: meta.tier,
                score: meta.score,
                is_suspicious: meta.is_suspicious,
            },
            None => RuleMatch {
                rule_id,
                tier: crate::forge::Tier::Core,
                score: 0,
                is_suspicious: false,
            },
        })
        .collect()
}

/// Counts scores into 5-point buckets, ascending by inclusive floor (`(score / 5) * 5`). The caller
/// pre-filters to the suspicious (`_SUSP_`) rules whose score the firm's floor actually gates, so this is
/// the distribution the scan-policy custom-floor slider plots. Shared between `build-yara-rules`' summary
/// log and the runtime `/rules/score-histogram` endpoint so the two never drift.
pub fn susp_score_histogram(scores: impl IntoIterator<Item = i32>) -> Vec<(i32, usize)> {
    let mut buckets: std::collections::BTreeMap<i32, usize> = std::collections::BTreeMap::new();
    for score in scores {
        *buckets.entry((score / 5) * 5).or_insert(0) += 1;
    }
    buckets.into_iter().collect()
}

/// The engine-code component of the composite engine version. Bump this constant whenever the Rust
/// crate's scan logic changes in a way that could alter verdicts — a bump causes re-scans across the
/// fleet, so it is deliberate and intentional, not automatic. The yara-x library version is a compiled
/// dependency folded into this component (a library upgrade requires a crate rebuild, which means bumping
/// this constant to signal the change to the staleness gate).
pub const ENGINE_CODE_VERSION: u32 = 1;

/// The yara-x engine version, kept for diagnostics and logging. Not part of the composite version string
/// directly; the compiled-in library version is represented by `ENGINE_CODE_VERSION`.
pub const ENGINE_VERSION: &str = yara_x::VERSION;

/// The number of compiled rules currently active — a diagnostic, logged at startup. The composite
/// engine-version's `yara-rules` component is the baked YARA Forge release tag, not this count (a count
/// can collide across releases; the tag changes exactly when Forge publishes). Zero means no rules are
/// loaded (the dev/test build, and any image built before rules land, run on clamd + the structural
/// heuristics alone).
pub fn rulesets_version(rules: &Rules) -> u32 {
    rules.iter().count() as u32
}

/// The outcome of a tolerant compile over a (large, externally-sourced) rule corpus: the rules that
/// compiled, plus how many errors and warnings the compiler reported. Used by `build-yara-rules` to skip
/// and log any rule a future YARA Forge release introduces that yara-x cannot compile, instead of failing
/// the whole image build over it. The caller gate-checks the compiled count against the kept count so a
/// systemic compile collapse (not a stray incompatible rule) still fails the build loud.
pub struct CompileReport {
    pub rules: Rules,
    pub errors: usize,
    pub warnings: usize,
}

/// Compiles a multi-rule source TOLERANTLY: a per-rule compile error is recorded (and counted) but does
/// not abort the corpus — `build` returns every rule that did compile. This is the opposite policy from
/// [`build_rules`] (which fails fast on a hand-curated bundled rule); the YARA Forge corpus is external
/// and self-updating, so one incompatible rule must never break the build. The returned counts let the
/// build bin log the skipped rules and enforce a floor on how many may fail.
pub fn compile_tolerant(source: &str) -> CompileReport {
    let mut compiler = Compiler::new();
    let errors = match compiler.add_source(source) {
        Ok(_) => 0,
        // add_source records each rule error and continues over the rest of the corpus; the count is the
        // number of rules the build will skip. build() below returns the rules that did compile.
        Err(_) => compiler.errors().len(),
    };
    let warnings = compiler.warnings().len();
    CompileReport {
        rules: compiler.build(),
        errors,
        warnings,
    }
}

/// Deserializes compiled rules baked into the image by `build-yara-rules`. The build stage filters,
/// compiles, and serializes the YARA Forge corpus to a blob; the runtime restores it here — no startup
/// recompile of the (~10k-rule) corpus. A deserialize failure is fatal to the caller (a corrupt or
/// version-mismatched blob must fail loud, never silently fall back to an empty corpus that would let
/// every file through the heuristic layer unscanned).
pub fn deserialize_rules(bytes: &[u8]) -> Result<Rules, yara_x::errors::SerializationError> {
    Rules::deserialize(bytes)
}

/// Compiles YARA rule sources into one immutable, shareable rule set. Called once at startup over the
/// rules baked into the image, so a malformed bundled rule is a fail-fast startup error (not a
/// per-request fault). The returned `Rules` is Send + Sync — share it across requests by reference and
/// allocate a fresh `Scanner` per scan.
pub fn build_rules(sources: &[&str]) -> Rules {
    let mut compiler = Compiler::new();
    for source in sources {
        // add_source borrows &mut self and is fallible; build consumes the compiler and is infallible.
        compiler
            .add_source(*source)
            .expect("a bundled YARA rule should compile");
    }
    compiler.build()
}

/// A per-scan wall-clock bound on the YARA matcher. Bounds a slow-pattern rule on a large hostile input
/// from pinning a blocking thread unboundedly (a denial-of-service vector once the corpus carries real,
/// performance-imperfect rules). Generous for a legitimate full-size (2 GiB) scan — yara-x's atom
/// prefilter keeps the common no-match case near-linear in input size — but caps the worst case. clamd
/// enforces its own scan-time limit in parallel (entrypoint.sh `MaxScanTime`).
const YARA_SCAN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// A YARA scan that did not complete — a timeout or an internal scan error. It is NOT "no matches": the
/// caller must treat it as a retryable engine fault (never a clean verdict), the same as an engine panic.
#[derive(Debug)]
pub struct YaraScanFault(pub String);

/// Scans a buffer against the compiled rules, returning the identifiers of every matching rule — or
/// `Err(YaraScanFault)` if the scan timed out or errored. The scan is wall-clock-bounded by
/// `YARA_SCAN_TIMEOUT`. Crucially a fault is surfaced, NOT swallowed as an empty match set: with a
/// loaded corpus a swallowed fault would silently drop the YARA detection layer for that file (a
/// best-effort scan recorded as if it ran clean), so the caller re-scans instead — clamd and the
/// structural heuristics still run independently, but the file is never committed clean on a yara fault.
pub fn yara_scan(rules: &Rules, bytes: &[u8]) -> Result<Vec<String>, YaraScanFault> {
    let mut scanner = Scanner::new(rules);
    scanner.set_timeout(YARA_SCAN_TIMEOUT);
    match scanner.scan(bytes) {
        Ok(results) => Ok(results
            .matching_rules()
            .map(|rule| rule.identifier().to_string())
            .collect()),
        Err(error) => Err(YaraScanFault(error.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_rules, compile_tolerant, deserialize_rules, deserialize_side_map, enrich_matches,
        serialize_side_map, susp_score_histogram, yara_scan, RuleMeta, RuleMatch,
    };

    const TRIVIAL_RULE: &str = r#"rule t { strings: $a = "malicious" condition: $a }"#;

    #[test]
    fn susp_score_histogram_buckets_ascending_by_five() {
        // 40,41 -> [40], 47 -> [45], 75 -> [75]; counts per 5-point floor, ascending; empty -> empty.
        let histogram = susp_score_histogram([41, 40, 75, 47]);
        assert_eq!(histogram, vec![(40, 2), (45, 1), (75, 1)]);
        assert!(susp_score_histogram(std::iter::empty::<i32>()).is_empty());
    }

    #[test]
    fn tolerant_compile_skips_a_broken_rule_then_round_trips_through_serialization() {
        // One good rule plus one referencing an undefined identifier (a compile error). The tolerant
        // compile keeps the good rule and skips the broken one (counting it), and the serialized blob
        // round-trips so the surviving rule still matches — the exact build→bake→boot→scan path the image
        // relies on (build-yara-rules serializes; main.rs deserializes).
        let source = "rule good { strings: $a = \"malicious\" condition: $a }\n\
                      rule broken { condition: undefined_identifier }\n";
        let report = compile_tolerant(source);
        assert_eq!(
            report.rules.iter().count(),
            1,
            "the broken rule must be skipped, the good one kept"
        );
        assert!(
            report.errors >= 1,
            "the skipped rule is counted as an error"
        );

        let blob = report.rules.serialize().expect("rules serialize");
        let restored = deserialize_rules(&blob).expect("rules deserialize");
        assert_eq!(
            yara_scan(&restored, b"a malicious payload").expect("scan ok"),
            vec!["good".to_string()],
            "the surviving rule must still match after a serialize/deserialize round-trip"
        );
    }

    #[test]
    fn matches_a_rule_whose_string_is_present() {
        let rules = build_rules(&[TRIVIAL_RULE]);
        assert_eq!(
            yara_scan(&rules, b"this is malicious content").expect("scan ok"),
            vec!["t".to_string()]
        );
    }

    #[test]
    fn returns_no_matches_for_clean_content() {
        let rules = build_rules(&[TRIVIAL_RULE]);
        assert!(yara_scan(&rules, b"this is perfectly fine")
            .expect("scan ok")
            .is_empty());
    }

    #[test]
    fn enriches_matches_from_the_side_map() {
        use crate::forge::Tier;
        let mut map = std::collections::HashMap::new();
        map.insert(
            "Known_Rule".to_string(),
            RuleMeta {
                tier: Tier::Core,
                score: 90,
                is_suspicious: false,
            },
        );
        let enriched = enrich_matches(vec!["Known_Rule".into(), "Unknown_Rule".into()], &map);
        assert_eq!(
            enriched[0],
            RuleMatch {
                rule_id: "Known_Rule".into(),
                tier: Tier::Core,
                score: 90,
                is_suspicious: false,
            }
        );
        // An unmapped match fails safe toward flagging: Core tier (rank 0, always within any firm
        // policy), score 0, not suspicious — the match always counts and is never silently dropped.
        assert_eq!(
            enriched[1],
            RuleMatch {
                rule_id: "Unknown_Rule".into(),
                tier: Tier::Core,
                score: 0,
                is_suspicious: false,
            }
        );
    }

    #[test]
    fn side_map_round_trips_through_serialization() {
        use crate::forge::Tier;
        let mut map = std::collections::HashMap::new();
        map.insert(
            "R".to_string(),
            RuleMeta {
                tier: Tier::Extended,
                score: 75,
                is_suspicious: true,
            },
        );
        let restored = deserialize_side_map(&serialize_side_map(&map)).unwrap();
        assert_eq!(restored, map);
    }
}
