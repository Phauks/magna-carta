//! Build-time bundling of a YARA Forge rule package into the compiled, serialized blob the scan service
//! loads at boot. Runs in the scan image's build stage (never at runtime): it reads the downloaded
//! YARA Forge `.yar` package, drops the false-positive-prone heuristic pocket ([`forge::filter`]),
//! compiles the kept set with yara-x, and serializes the result to a file the runtime deserializes.
//!
//! ## Fail-loud, like `build-atoms`
//!
//! The engine SELF-MAINTAINS: the nightly Deploy-Hook rebuild re-fetches the latest YARA Forge release
//! and re-runs this. That stays safe only if the bundle can never silently degrade, so the build fails
//! (non-zero exit) when:
//!
//!   - the package cannot be read, or the kept set is empty;
//!   - the parser's rule count disagrees with the package's own rule-header count (a YARA Forge format
//!     change that would make the line-based split mis-fire — classify it before shipping); or
//!   - too many kept rules fail to compile under yara-x. A handful of incompatible rules from a future
//!     release are skipped + logged (tolerant compile); a systemic collapse stops the build.
//!
//! Args: `build-yara-rules <input.yar> <output.bin> [min_suspicious_score]` (score floor defaults to 75).

use std::process::ExitCode;

use magna_carta_scan::{forge, yara};

/// Default heuristic-`_SUSP_` score floor: rules below it are dropped as the FP pocket. Overridable by the
/// third CLI arg (the Dockerfile passes the `YARA_MIN_SUSP_SCORE` build ARG).
const DEFAULT_MIN_SUSPICIOUS_SCORE: i32 = 75;

/// The largest share of kept rules allowed to fail yara-x compilation before the build is treated as a
/// systemic collapse rather than a few stray incompatible rules. YARA Forge validates against classic
/// YARA; a future release could add a rule using a module/feature yara-x lacks. One-offs are skipped and
/// logged; anything above this fraction means something broke wholesale (a yara-x upgrade regression, a
/// corrupt download) and must stop the build.
const MAX_COMPILE_FAILURE_RATIO: f64 = 0.05;

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let input = args.next().unwrap_or_else(|| "/yara-src.yar".to_string());
    let output = args.next().unwrap_or_else(|| "/yara-rules.bin".to_string());
    let min_score = args
        .next()
        .and_then(|value| value.parse::<i32>().ok())
        .unwrap_or(DEFAULT_MIN_SUSPICIOUS_SCORE);

    match run(&input, &output, min_score) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("build-yara-rules FAILED: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(input: &str, output: &str, min_score: i32) -> Result<(), String> {
    let source = std::fs::read_to_string(input)
        .map_err(|error| format!("cannot read YARA package {input}: {error}"))?;

    // Format-drift guard: the line-based split assumes YARA Forge's normalized layout (one column-0
    // `rule …` header per rule). Cross-check against a direct header count; a mismatch means the format
    // changed and the split would silently mis-group rules — stop the build until it is re-validated.
    let header_count = count_rule_headers(&source);
    let (filtered, stats) = forge::filter(&source, min_score);
    if stats.total != header_count {
        return Err(format!(
            "rule-split inconsistency: brace-matching produced {} rule blocks but the package has {} \
             `rule` headers. A rule likely failed to brace-match (a truncated body, or a string/regex \
             the matcher mis-read), which would drop or merge rules silently. Re-validate src/forge.rs's \
             split before shipping.",
            stats.total, header_count
        ));
    }
    if stats.kept == 0 {
        return Err(format!(
            "the filtered rule set is empty ({} rules in, all dropped). Refusing to bake an empty \
             corpus — check the input package and the min-suspicious-score floor ({min_score}).",
            stats.total
        ));
    }

    // Tolerant compile: skip + log a stray incompatible rule, but fail loud on a systemic collapse.
    let report = yara::compile_tolerant(&filtered);
    let compiled = report.rules.iter().count();
    let failed = stats.kept.saturating_sub(compiled);
    let failure_ratio = failed as f64 / stats.kept as f64;
    if failure_ratio > MAX_COMPILE_FAILURE_RATIO {
        return Err(format!(
            "{failed} of {} kept rules failed to compile under yara-x ({:.1}% > {:.1}% ceiling). \
             That is a systemic failure, not a few incompatible rules — inspect the yara-x version and \
             the downloaded package before shipping. Compiler reported {} errors.",
            stats.kept,
            100.0 * failure_ratio,
            100.0 * MAX_COMPILE_FAILURE_RATIO,
            report.errors,
        ));
    }

    let blob = report
        .rules
        .serialize()
        .map_err(|error| format!("cannot serialize compiled rules: {error}"))?;
    std::fs::write(output, &blob).map_err(|error| format!("cannot write {output}: {error}"))?;

    print_report(
        &stats,
        compiled,
        failed,
        report.warnings,
        output,
        blob.len(),
    );
    Ok(())
}

/// Counts column-0 `rule` / `private rule` / `global rule` headers — the package's own rule count, used to
/// cross-check the parser's brace-matched split (a shortfall means a rule failed to match and swallowed
/// the next header).
fn count_rule_headers(source: &str) -> usize {
    source
        .lines()
        .filter(|line| {
            let mut rest = *line;
            // Same flush-left + modifier handling as forge::split_rules' rule_start.
            if rest.starts_with(char::is_whitespace) {
                return false;
            }
            while let Some(after) = rest
                .strip_prefix("private ")
                .or_else(|| rest.strip_prefix("global "))
            {
                rest = after.trim_start();
            }
            rest.strip_prefix("rule ")
                .map(|name| {
                    name.trim_start()
                        .starts_with(|c: char| c.is_alphanumeric() || c == '_')
                })
                .unwrap_or(false)
        })
        .count()
}

fn print_report(
    stats: &forge::FilterStats,
    compiled: usize,
    failed: usize,
    warnings: usize,
    output: &str,
    bytes: usize,
) {
    println!("build-yara-rules: bundle complete");
    println!("  parsed:            {} rules", stats.total);
    println!(
        "  suspicious:        {} ({} private kept)",
        stats.suspicious_total, stats.private_total
    );
    println!(
        "  dropped (FP pocket): {} low-score _SUSP_ rules",
        stats.dropped_suspicious
    );
    println!("  kept:              {}", stats.kept);
    println!(
        "  compiled:          {} ({} skipped incompatible)",
        compiled, failed
    );
    println!("  yara-x warnings:   {}", warnings);
    println!("  wrote {output} ({bytes} bytes)");
}

#[cfg(test)]
mod tests {
    use super::{count_rule_headers, forge, run};
    use std::path::PathBuf;

    #[test]
    fn header_count_matches_split_on_a_sample() {
        let src = "import \"pe\"\n\nrule A\n{\n condition:\n true\n}\n\nprivate rule B\n{\n condition:\n true\n}\n";
        assert_eq!(count_rule_headers(src), 2);
        assert_eq!(forge::split_rules(src).len(), 2);
    }

    #[test]
    fn header_count_ignores_indented_rule_mentions() {
        // A `rule` word inside a comment or condition (indented) must not be counted as a header.
        let src =
            "rule Real\n{\n    // this rule references nothing\n    condition:\n        true\n}\n";
        assert_eq!(count_rule_headers(src), 1);
    }

    #[test]
    fn header_count_agrees_with_split_on_modifier_permutations() {
        // The format-drift guard's value rests on the two independent rule recognizers
        // (`count_rule_headers` here vs `forge::rule_start`) staying in lockstep. Pin agreement across
        // modifier orders so a divergence cannot silently pass the guard.
        for header in [
            "rule X",
            "private rule X",
            "global rule X",
            "global private rule X",
            "private global rule X",
            "rule _LeadingUnderscore",
        ] {
            let src = format!("{header}\n{{\n condition:\n  true\n}}\n");
            assert_eq!(count_rule_headers(&src), 1, "header_count for: {header}");
            assert_eq!(forge::split_rules(&src).len(), 1, "split for: {header}");
        }
    }

    // Writes a package body to a fresh temp dir and returns (dir, input.yar, output.bin).
    fn temp_pkg(test: &str, body: &str) -> (PathBuf, PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("byr-{}-{}", test, std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let input = dir.join("in.yar");
        let output = dir.join("out.bin");
        std::fs::write(&input, body).unwrap();
        (dir, input, output)
    }

    #[test]
    fn run_writes_a_blob_for_a_valid_package() {
        let body = "import \"pe\"\n\n\
            rule Good_One\n{\n strings:\n  $a = \"alpha\"\n condition:\n  $a\n}\n\n\
            rule Good_Two\n{\n strings:\n  $b = \"beta\"\n condition:\n  $b\n}\n";
        let (dir, input, output) = temp_pkg("valid", body);
        run(input.to_str().unwrap(), output.to_str().unwrap(), 75).expect("valid package builds");
        assert!(output.exists(), "a blob must be written");
        assert!(
            std::fs::metadata(&output).unwrap().len() > 0,
            "the blob must be non-empty"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn run_fails_loud_on_an_all_dropped_empty_corpus() {
        // A single low-score _SUSP_ rule is dropped by the score floor → kept == 0 → fail loud.
        let body =
            "import \"pe\"\n\nrule X_SUSP_Heur\n{\n meta:\n  score = 10\n condition:\n  true\n}\n";
        let (dir, input, output) = temp_pkg("empty", body);
        let err = run(input.to_str().unwrap(), output.to_str().unwrap(), 75).unwrap_err();
        assert!(
            err.contains("empty"),
            "expected the empty-corpus gate; got: {err}"
        );
        assert!(!output.exists(), "no blob may be written on a failed build");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn run_fails_loud_on_a_split_inconsistency() {
        // An unclosed rule cannot brace-match → it swallows the next header to EOF → block count (1) falls
        // below header count (2) → the format-drift gate fires.
        let body =
            "import \"pe\"\n\nrule A\n{\n condition:\n  true\n\nrule B\n{\n condition:\n  true\n}\n";
        let (dir, input, output) = temp_pkg("inconsistent", body);
        let err = run(input.to_str().unwrap(), output.to_str().unwrap(), 75).unwrap_err();
        assert!(
            err.contains("inconsistency"),
            "expected the split-inconsistency gate; got: {err}"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn run_fails_loud_on_systemic_compile_failure() {
        // Two kept rules, one referencing an undefined identifier → 50% compile failure > 5% ceiling.
        let body = "import \"pe\"\n\n\
            rule Ok_Rule\n{\n strings:\n  $a = \"x\"\n condition:\n  $a\n}\n\n\
            rule Bad_Rule\n{\n condition:\n  undefined_identifier\n}\n";
        let (dir, input, output) = temp_pkg("collapse", body);
        let err = run(input.to_str().unwrap(), output.to_str().unwrap(), 75).unwrap_err();
        assert!(
            err.contains("failed to compile"),
            "expected the systemic-collapse gate; got: {err}"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn run_tolerates_a_few_incompatible_rules_under_the_ceiling() {
        // 40 good + 1 broken = 1/41 ≈ 2.4% < 5% ceiling → the broken rule is skipped, the build succeeds.
        let mut body = String::from("import \"pe\"\n\n");
        for i in 0..40 {
            body.push_str(&format!(
                "rule Good_{i}\n{{\n strings:\n  $a = \"s{i}\"\n condition:\n  $a\n}}\n\n"
            ));
        }
        body.push_str("rule Bad_One\n{\n condition:\n  undefined_identifier\n}\n");
        let (dir, input, output) = temp_pkg("tolerate", &body);
        run(input.to_str().unwrap(), output.to_str().unwrap(), 75)
            .expect("one broken rule of 41 is under the ceiling");
        assert!(
            output.exists(),
            "a blob must be written when under the ceiling"
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}
