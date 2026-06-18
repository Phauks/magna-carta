use yara_x::{Compiler, Rules, Scanner};

/// The yara-x engine version, for the `engineVersion` string in the scan verdict.
pub const ENGINE_VERSION: &str = yara_x::VERSION;

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
