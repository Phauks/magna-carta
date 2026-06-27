//! Build-time parsing and false-positive-pocket filtering of a YARA Forge rule package.
//!
//! YARA Forge publishes one concatenated `.yar` per tier. We bake the `extended` tier, which adds
//! thousands of high-confidence malware rules over `core` — but also a small pocket of heuristic
//! `*_SUSP_*` rules (structural patterns like base64 PowerShell, odd ZIP layouts, OneNote tricks) that
//! match legitimate-but-unusual documents and carry explicit "can yield many FP" notes. Under this
//! scanner's verdict model a YARA hit quarantines the file (same as a clamd signature), so a false
//! positive on a client's legal filing is costly. This module drops exactly that pocket: heuristic
//! `_SUSP_` rules scoring below a floor, while keeping every high-confidence detection.
//!
//! Pure text logic (no yara-x), unit-tested here; `bin/build-yara-rules.rs` wraps it to compile +
//! serialize the kept set into the image. Rules are found by their column-0 `rule`/`private rule`/`global
//! rule` headers and delimited by brace-matching — a string/comment/regex-aware scan, NOT a naive
//! "first column-0 `}`": real `extended` rules carry multi-line hex strings whose closing brace sits
//! flush-left, which a line-based close would clip (verified — naive line/brace splitting drops thousands
//! of rules; the string+comment+regex-aware scan recovers all of them). The build bin cross-checks the
//! split's block count against the package's own header count and fails loud on any drift.

use serde::{Deserialize, Serialize};

/// Which YARA Forge package a rule first appears in. The packages are nested (core ⊂ extended ⊂ full),
/// so a rule's tier is the narrowest package containing it. Carried per rule so the app can gate matches
/// to a firm's chosen tier without re-running the engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Core,
    Extended,
    Full,
}

/// One parsed rule block from a YARA Forge package.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForgeRule {
    pub name: String,
    /// The rule's `score` meta (YARA Forge's confidence/importance signal). Absent score is treated as 0
    /// — conservative: an unscored heuristic rule is dropped under any positive floor (fail FP-safe).
    pub score: i32,
    /// `private` rules are kept regardless of the filter: a public rule may reference one, and dropping a
    /// referenced private rule would fail the dependent's compile.
    pub is_private: bool,
    /// A heuristic `*_SUSP_*` rule — the FP-prone class the filter prunes by score.
    pub is_suspicious: bool,
    /// The full rule text, from its `rule …` line through its closing `}` (inclusive).
    pub text: String,
    /// The narrowest YARA Forge tier whose package contains this rule. Defaults to `Full` when provenance
    /// is unknown; overwritten by `assign_tiers` once the per-tier package membership sets are available.
    pub tier: Tier,
}

impl ForgeRule {
    /// Whether this rule survives the filter: keep all private rules (dependency safety) and all
    /// non-heuristic rules; drop only heuristic `_SUSP_` rules scoring below `min_suspicious_score`.
    pub fn is_kept(&self, min_suspicious_score: i32) -> bool {
        if self.is_private || !self.is_suspicious {
            return true;
        }
        self.score >= min_suspicious_score
    }
}

/// The file-level `import "<module>"` lines, preserved verbatim for the filtered output (imports are
/// file-scoped, so the kept rules need them re-emitted at the top).
pub fn imports(source: &str) -> Vec<String> {
    source
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("import \""))
        .map(str::to_string)
        .collect()
}

/// True if a line begins a rule at column 0 — `rule`, `private rule`, or `global rule` (modifiers in
/// either order), with the keyword `rule` followed by an identifier. Returns the rule name when so.
fn rule_start(line: &str) -> Option<(String, bool)> {
    // The line must start at column 0 (no leading whitespace) — Forge formats rule headers flush-left,
    // and every interior line is indented, so this disambiguates a header from a `rule`-mentioning body.
    if line.starts_with(char::is_whitespace) {
        return None;
    }
    let mut is_private = false;
    let mut rest = line;
    loop {
        if let Some(after) = rest.strip_prefix("private ") {
            is_private = true;
            rest = after.trim_start();
        } else if let Some(after) = rest.strip_prefix("global ") {
            rest = after.trim_start();
        } else {
            break;
        }
    }
    let after_rule = rest.strip_prefix("rule ")?;
    let name: String = after_rule
        .trim_start()
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect();
    if name.is_empty() {
        None
    } else {
        Some((name, is_private))
    }
}

/// Lexer state while brace-matching a rule body (see `rule_body_end`).
enum ScanState {
    Normal,
    StringLiteral,
    LineComment,
    BlockComment,
    Regex,
}

/// Where a rule's `{ … }` body ends, found by brace-matching from its header — NOT by a naive "first
/// column-0 `}`". Real YARA Forge rules contain multi-line hex strings whose closing brace sits flush-left
/// (`$chunk = {` … bytes … `}` at column 0), which a line-based close would clip. Hex-string braces are
/// balanced, so the matcher only has to avoid counting braces inside string literals, comments, and
/// regexes. YARA's division operator is `\`, so a `/` here unambiguously opens a regex or a comment, never
/// arithmetic — making regex detection unambiguous. Scans bytes (delimiters are ASCII; UTF-8 content bytes
/// are ≥0x80 and never collide). Returns the byte index just past the closing `}`, or `None` if the braces
/// never balance (a truncated rule — the caller's block-vs-header count then fails the build loud).
fn rule_body_end(bytes: &[u8], header_start: usize) -> Option<usize> {
    let mut i = header_start;
    while i < bytes.len() && bytes[i] != b'{' {
        i += 1;
    }
    if i >= bytes.len() {
        return None;
    }
    let mut depth = 0i32;
    let mut state = ScanState::Normal;
    let mut escaped = false;
    let mut in_char_class = false;
    while i < bytes.len() {
        let c = bytes[i];
        match state {
            ScanState::Normal => match c {
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(i + 1);
                    }
                }
                b'"' => {
                    state = ScanState::StringLiteral;
                    escaped = false;
                }
                b'/' if bytes.get(i + 1) == Some(&b'*') => {
                    state = ScanState::BlockComment;
                    i += 1;
                }
                b'/' if bytes.get(i + 1) == Some(&b'/') => state = ScanState::LineComment,
                b'/' => {
                    state = ScanState::Regex;
                    escaped = false;
                    in_char_class = false;
                }
                _ => {}
            },
            ScanState::StringLiteral => {
                if escaped {
                    escaped = false;
                } else if c == b'\\' {
                    escaped = true;
                } else if c == b'"' {
                    state = ScanState::Normal;
                }
            }
            ScanState::LineComment => {
                if c == b'\n' {
                    state = ScanState::Normal;
                }
            }
            ScanState::BlockComment => {
                if c == b'*' && bytes.get(i + 1) == Some(&b'/') {
                    state = ScanState::Normal;
                    i += 1;
                }
            }
            ScanState::Regex => {
                // A `/` ends the regex only outside a `[…]` char class; `\` escapes the next byte.
                if escaped {
                    escaped = false;
                } else if c == b'\\' {
                    escaped = true;
                } else if c == b'[' {
                    in_char_class = true;
                } else if c == b']' {
                    in_char_class = false;
                } else if c == b'/' && !in_char_class {
                    state = ScanState::Normal;
                }
            }
        }
        i += 1;
    }
    None
}

/// Finds the next column-0 rule header at or after byte `from`, returning its byte offset, name, and
/// privateness. Scans line by line with exact byte offsets (robust to `\r\n` and to rule content).
fn next_header(source: &str, from: usize) -> Option<(usize, String, bool)> {
    let mut start = from;
    loop {
        let end = source[start..]
            .find('\n')
            .map(|newline| start + newline)
            .unwrap_or(source.len());
        if let Some((name, is_private)) = rule_start(&source[start..end]) {
            return Some((start, name, is_private));
        }
        if end >= source.len() {
            return None;
        }
        start = end + 1;
    }
}

/// Splits a YARA Forge package into its rule blocks by header detection + brace-matching. Text outside a
/// `rule … { … }` block (the banner, imports, inter-rule comments) is not captured. A rule whose braces
/// never balance (truncated) is captured to end-of-file; the build bin's block-vs-header count then
/// catches the resulting shortfall and fails loud.
pub fn split_rules(source: &str) -> Vec<ForgeRule> {
    let bytes = source.as_bytes();
    let mut rules = Vec::new();
    let mut search = 0usize;
    while let Some((header_start, name, is_private)) = next_header(source, search) {
        let end = rule_body_end(bytes, header_start).unwrap_or(source.len());
        let text = source[header_start..end].to_string();
        let score = parse_score(&text);
        let is_suspicious = name.to_ascii_uppercase().contains("_SUSP_");
        rules.push(ForgeRule {
            name,
            score,
            is_private,
            is_suspicious,
            text,
            tier: Tier::Full,
        });
        if end <= header_start {
            break; // defensive: guarantee forward progress
        }
        search = end;
    }
    rules
}

/// Reads the `score = <int>` meta from a rule body. Absent or unparsable score yields 0 (FP-safe: an
/// unscored heuristic rule is then dropped under any positive floor).
fn parse_score(rule_text: &str) -> i32 {
    for line in rule_text.lines() {
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix("score") {
            let value = value.trim_start();
            if let Some(number) = value.strip_prefix('=') {
                if let Ok(score) = number.trim().parse::<i32>() {
                    return score;
                }
            }
        }
    }
    0
}

/// The outcome of filtering a package: the kept-rules `.yar` source (imports + kept rule bodies) plus the
/// census the build bin prints and gate-checks.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct FilterStats {
    pub total: usize,
    pub kept: usize,
    pub dropped_suspicious: usize,
    pub suspicious_total: usize,
    pub private_total: usize,
}

/// Filters a YARA Forge package, returning the kept-rules `.yar` source and a census. The output re-emits
/// the file-level imports followed by each kept rule's verbatim text.
pub fn filter(source: &str, min_suspicious_score: i32) -> (String, FilterStats) {
    let rules = split_rules(source);
    let mut stats = FilterStats {
        total: rules.len(),
        ..Default::default()
    };
    let mut out = String::new();
    for import in imports(source) {
        out.push_str(&import);
        out.push('\n');
    }
    out.push('\n');
    for rule in &rules {
        if rule.is_suspicious {
            stats.suspicious_total += 1;
        }
        if rule.is_private {
            stats.private_total += 1;
        }
        if rule.is_kept(min_suspicious_score) {
            stats.kept += 1;
            out.push_str(&rule.text);
            out.push('\n');
        } else {
            stats.dropped_suspicious += 1;
        }
    }
    (out, stats)
}

/// The set of rule names declared in a package source — used to derive tier membership by diffing the
/// three packages (a rule in core.yar is tier Core, in extended.yar but not core is Extended, etc.).
pub fn rule_ids(source: &str) -> std::collections::HashSet<String> {
    split_rules(source).into_iter().map(|rule| rule.name).collect()
}

/// Parses the full package and tags every rule with the narrowest tier whose package contains it.
pub fn assign_tiers(
    full_source: &str,
    core_ids: &std::collections::HashSet<String>,
    extended_ids: &std::collections::HashSet<String>,
) -> Vec<ForgeRule> {
    split_rules(full_source)
        .into_iter()
        .map(|mut rule| {
            rule.tier = if core_ids.contains(&rule.name) {
                Tier::Core
            } else if extended_ids.contains(&rule.name) {
                Tier::Extended
            } else {
                Tier::Full
            };
            rule
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"/*
 * YARA-Forge banner comment
 */

import "pe"
import "hash"

rule HIGH_CONF_Malware
{
    meta:
        description = "Detects a real malware family"
        score = 85
    strings:
        $a = { 4D 5A 90 00 }
    condition:
        $a
}

rule SOURCE_SUSP_Base64_Heuristic
{
    meta:
        description = "Heuristic; can yield many FP"
        score = 60
    strings:
        $b = "FromBase64String"
    condition:
        $b
}

private rule SHARED_SUSP_Helper
{
    meta:
        score = 10
    condition:
        true
}

rule SOURCE_SUSP_HighScore_Heuristic
{
    meta:
        score = 80
    condition:
        true
}
"#;

    #[test]
    fn imports_are_extracted_verbatim() {
        assert_eq!(imports(SAMPLE), vec!["import \"pe\"", "import \"hash\""]);
    }

    #[test]
    fn splits_every_rule_block() {
        let rules = split_rules(SAMPLE);
        let names: Vec<&str> = rules.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "HIGH_CONF_Malware",
                "SOURCE_SUSP_Base64_Heuristic",
                "SHARED_SUSP_Helper",
                "SOURCE_SUSP_HighScore_Heuristic",
            ]
        );
    }

    #[test]
    fn parses_score_and_flags() {
        let rules = split_rules(SAMPLE);
        assert_eq!(rules[0].score, 85);
        assert!(!rules[0].is_suspicious);
        assert_eq!(rules[1].score, 60);
        assert!(rules[1].is_suspicious);
        assert!(rules[2].is_private);
        assert!(rules[2].is_suspicious);
    }

    #[test]
    fn rule_text_is_brace_balanced_including_hex_strings() {
        // The first rule contains a `{ 4D 5A 90 00 }` hex string — the captured text must still be the
        // whole rule (line-based close on the column-0 `}`), not clipped at the hex brace.
        let rules = split_rules(SAMPLE);
        assert!(rules[0].text.contains("$a = { 4D 5A 90 00 }"));
        assert!(rules[0].text.trim_end().ends_with('}'));
    }

    #[test]
    fn keeps_high_confidence_and_drops_low_score_suspicious() {
        // floor 75: keep the malware rule (not suspicious), drop the score-60 SUSP heuristic, keep the
        // private SUSP helper (dependency safety) and the score-80 SUSP rule (above the floor).
        let rules = split_rules(SAMPLE);
        assert!(rules[0].is_kept(75)); // HIGH_CONF, not suspicious
        assert!(!rules[1].is_kept(75)); // SUSP score 60 < 75 -> dropped
        assert!(rules[2].is_kept(75)); // private -> always kept
        assert!(rules[3].is_kept(75)); // SUSP score 80 >= 75 -> kept
    }

    #[test]
    fn filter_census_and_output_are_consistent() {
        let (out, stats) = filter(SAMPLE, 75);
        assert_eq!(stats.total, 4);
        assert_eq!(stats.kept, 3);
        assert_eq!(stats.dropped_suspicious, 1);
        assert_eq!(stats.suspicious_total, 3);
        assert_eq!(stats.private_total, 1);
        // Imports re-emitted; the dropped rule's text is gone; kept rules remain.
        assert!(out.contains("import \"pe\""));
        assert!(out.contains("rule HIGH_CONF_Malware"));
        assert!(!out.contains("SOURCE_SUSP_Base64_Heuristic"));
        assert!(out.contains("SHARED_SUSP_Helper"));
        assert!(out.contains("SOURCE_SUSP_HighScore_Heuristic"));
    }

    #[test]
    fn multiline_hex_with_a_flush_left_close_does_not_clip_the_rule() {
        // The real-package shape that broke a line-based splitter: a multi-line hex string whose closing
        // brace is at COLUMN 0. Brace-matching must keep the rule whole (hex braces are balanced), not
        // end it at the hex string's flush-left `}`.
        let src = "import \"pe\"\n\n\
            rule Multi\n{\n strings:\n  $h = {\n4D 5A 90 00\nE8 00 00 00\n}\n condition:\n  $h\n}\n\n\
            rule After\n{\n condition:\n  true\n}\n";
        let rules = split_rules(src);
        assert_eq!(
            rules.len(),
            2,
            "the flush-left hex close must not split Multi early"
        );
        assert_eq!(rules[0].name, "Multi");
        assert!(
            rules[0].text.contains("E8 00 00 00"),
            "hex body must be intact"
        );
        assert!(
            rules[0].text.contains("condition:"),
            "the rule must include its condition, not be clipped at the hex close"
        );
        assert_eq!(rules[1].name, "After");
    }

    #[test]
    fn braces_inside_strings_comments_and_regexes_do_not_split_the_rule() {
        // A text string, a line comment, and a regex each carrying an unbalanced `{`/`}` must not confuse
        // the brace-matcher (it skips string/comment/regex content). YARA's division operator is `\`, so
        // the `/` here is unambiguously a regex.
        let src = "import \"pe\"\n\n\
            rule Tricky\n{\n meta:\n  description = \"unbalanced } brace in a string\"\n strings:\n  \
            $r = /foo{1,3}/ // a } in a comment\n condition:\n  $r\n}\n\n\
            rule Next\n{\n condition:\n  true\n}\n";
        let rules = split_rules(src);
        assert_eq!(
            rules.len(),
            2,
            "braces in a string/comment/regex must not split Tricky"
        );
        assert_eq!(rules[0].name, "Tricky");
        assert!(rules[0].text.contains("condition:"));
        assert_eq!(rules[1].name, "Next");
    }

    #[test]
    fn an_unclosed_rule_swallows_to_eof() {
        // A rule missing its closing brace cannot brace-match; it captures to EOF, swallowing the next
        // header. The block count (1) then falls below the header count (2) — the build bin's guard fires.
        let src = "rule Broken\n{\n condition:\n  true\n\nrule After\n{\n condition:\n  true\n}\n";
        let rules = split_rules(src);
        assert_eq!(rules.len(), 1, "the unclosed rule swallows the rest to EOF");
    }

    #[test]
    fn unscored_suspicious_rule_is_dropped_under_a_positive_floor() {
        let src = "import \"pe\"\n\nrule X_SUSP_NoScore\n{\n    condition:\n        true\n}\n";
        let rules = split_rules(src);
        assert_eq!(rules[0].score, 0);
        assert!(!rules[0].is_kept(75));
    }

    #[test]
    fn assigns_tier_by_package_membership() {
        let full = "import \"pe\"\n\n\
            rule Core_Rule\n{\n condition:\n  true\n}\n\n\
            rule Extended_Rule\n{\n condition:\n  true\n}\n\n\
            rule Full_Only_Rule\n{\n condition:\n  true\n}\n";
        let core_ids: std::collections::HashSet<String> = ["Core_Rule".to_string()].into_iter().collect();
        let extended_ids: std::collections::HashSet<String> =
            ["Core_Rule".to_string(), "Extended_Rule".to_string()].into_iter().collect();
        let tagged = assign_tiers(full, &core_ids, &extended_ids);
        let tier = |name: &str| tagged.iter().find(|r| r.name == name).unwrap().tier;
        assert_eq!(tier("Core_Rule"), Tier::Core);
        assert_eq!(tier("Extended_Rule"), Tier::Extended);
        assert_eq!(tier("Full_Only_Rule"), Tier::Full);
    }

    #[test]
    fn rule_ids_extracts_every_header_name() {
        let src = "rule A\n{\n condition:\n true\n}\n\nprivate rule B\n{\n condition:\n true\n}\n";
        let ids = rule_ids(src);
        assert!(ids.contains("A") && ids.contains("B") && ids.len() == 2);
    }
}
