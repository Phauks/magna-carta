use yara_x::{Compiler, Rules, Scanner};

/// The engine-code component of the composite engine version. Bump this constant whenever the Rust
/// crate's scan logic changes in a way that could alter verdicts — a bump causes re-scans across the
/// fleet, so it is deliberate and intentional, not automatic. The yara-x library version is a compiled
/// dependency folded into this component (a library upgrade requires a crate rebuild, which means bumping
/// this constant to signal the change to the staleness gate).
pub const ENGINE_CODE_VERSION: u32 = 1;

/// The yara-x engine version, kept for diagnostics and logging. Not part of the composite version string
/// directly; the compiled-in library version is represented by `ENGINE_CODE_VERSION`.
pub const ENGINE_VERSION: &str = yara_x::VERSION;

/// Returns the rulesets version for the loaded rule set — the number of compiled rules currently active.
/// Zero means no rules are loaded (the image ships with an empty corpus today; this component becomes
/// non-zero when rule-directory loading lands). Any rule content change changes this count, driving
/// re-scans via the staleness gate.
pub fn rulesets_version(rules: &Rules) -> u32 {
    rules.iter().count() as u32
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

/// Scans a buffer against the compiled rules, returning the identifiers of every matching rule. A scan
/// error (rare for an in-memory buffer) yields no matches — clamd and the structural heuristics still
/// run, so a yara fault never alone decides a verdict.
pub fn yara_scan(rules: &Rules, bytes: &[u8]) -> Vec<String> {
    let mut scanner = Scanner::new(rules);
    match scanner.scan(bytes) {
        Ok(results) => results
            .matching_rules()
            .map(|rule| rule.identifier().to_string())
            .collect(),
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::{build_rules, yara_scan};

    const TRIVIAL_RULE: &str = r#"rule t { strings: $a = "malicious" condition: $a }"#;

    #[test]
    fn matches_a_rule_whose_string_is_present() {
        let rules = build_rules(&[TRIVIAL_RULE]);
        assert_eq!(
            yara_scan(&rules, b"this is malicious content"),
            vec!["t".to_string()]
        );
    }

    #[test]
    fn returns_no_matches_for_clean_content() {
        let rules = build_rules(&[TRIVIAL_RULE]);
        assert!(yara_scan(&rules, b"this is perfectly fine").is_empty());
    }
}
