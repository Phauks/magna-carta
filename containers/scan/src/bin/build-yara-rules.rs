//! Build-time bundling of a YARA Forge rule package into the compiled, serialized blob the scan service
//! loads at boot. Runs in the scan image's build stage (never at runtime): it reads three YARA Forge
//! packages (full, core, extended), tags each rule with its narrowest tier, compiles the whole corpus with
//! yara-x (tolerant — stray incompatible rules are skipped, a systemic collapse fails loud), and serializes
//! both the compiled blob AND a side-map JSON (`ruleId → {tier, score, isSuspicious}`) the runtime uses to
//! gate matches against a firm's chosen tier policy. No rules are dropped at build time; FP-pocket gating
//! moves app-side.
//!
//! ## Fail-loud, like `build-atoms`
//!
//! The engine SELF-MAINTAINS: the nightly Deploy-Hook rebuild re-fetches the latest YARA Forge release
//! and re-runs this. That stays safe only if the bundle can never silently degrade, so the build fails
//! (non-zero exit) when:
//!
//!   - a package cannot be read, or the full corpus parses to zero rules;
//!   - the parser's rule count disagrees with the full package's own rule-header count (a YARA Forge
//!     format change that would make the line-based split mis-fire — classify it before shipping); or
//!   - too many rules fail to compile under yara-x. A handful of incompatible rules from a future
//!     release are skipped + logged (tolerant compile); a systemic collapse stops the build.
//!
//! Args: `build-yara-rules <full.yar> <core.yar> <extended.yar> <out.bin> <out.sidemap.json> [min_suspicious_score]`
//! (score floor defaults to 75; it is recorded for the histogram only — no rules are dropped by it).

use std::process::ExitCode;

use magna_carta_scan::{forge, yara};

/// Default heuristic-`_SUSP_` score floor: recorded for the log/histogram only. No rules are dropped at
/// build time; the floor is applied app-side per firm policy. Overridable by the sixth CLI arg (the
/// Dockerfile passes the `YARA_MIN_SUSP_SCORE` build ARG).
const DEFAULT_MIN_SUSPICIOUS_SCORE: i32 = 75;

/// The largest share of rules allowed to fail yara-x compilation before the build is treated as a
/// systemic collapse rather than a few stray incompatible rules. YARA Forge validates against classic
/// YARA; a future release could add a rule using a module/feature yara-x lacks. One-offs are skipped and
/// logged; anything above this fraction means something broke wholesale (a yara-x upgrade regression, a
/// corrupt download) and must stop the build.
const MAX_COMPILE_FAILURE_RATIO: f64 = 0.05;

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let full = args.next().unwrap_or_else(|| "/yara-full.yar".to_string());
    let core = args.next().unwrap_or_else(|| "/yara-core.yar".to_string());
    let extended = args.next().unwrap_or_else(|| "/yara-extended.yar".to_string());
    let out_blob = args.next().unwrap_or_else(|| "/yara-rules.bin".to_string());
    let out_sidemap = args.next().unwrap_or_else(|| "/yara-rules-sidemap.json".to_string());
    let min_score = args
        .next()
        .and_then(|value| value.parse::<i32>().ok())
        .unwrap_or(DEFAULT_MIN_SUSPICIOUS_SCORE);

    match run(&full, &core, &extended, &out_blob, &out_sidemap, min_score) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("build-yara-rules FAILED: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(
    full: &str,
    core: &str,
    extended: &str,
    out_blob: &str,
    out_sidemap: &str,
    min_score: i32,
) -> Result<(), String> {
    let full_src = std::fs::read_to_string(full)
        .map_err(|e| format!("cannot read full package {full}: {e}"))?;
    let core_ids = forge::rule_ids(
        &std::fs::read_to_string(core)
            .map_err(|e| format!("cannot read core package {core}: {e}"))?,
    );
    let extended_ids = forge::rule_ids(
        &std::fs::read_to_string(extended)
            .map_err(|e| format!("cannot read extended package {extended}: {e}"))?,
    );

    // Format-drift guard: the line-based split assumes YARA Forge's normalized layout (one column-0
    // `rule …` header per rule). Cross-check against a direct header count; a mismatch means the format
    // changed and the split would silently mis-group rules — stop the build until it is re-validated.
    let header_count = count_rule_headers(&full_src);
    let tagged = forge::assign_tiers(&full_src, &core_ids, &extended_ids);
    if tagged.len() != header_count {
        return Err(format!(
            "rule-split inconsistency: brace-matching produced {} blocks but the full package has {} \
             headers — a rule failed to brace-match. Re-validate src/forge.rs's split before shipping.",
            tagged.len(),
            header_count
        ));
    }
    if tagged.is_empty() {
        return Err(
            "the full package parsed to zero rules — refusing to bake an empty corpus".to_string(),
        );
    }

    // Compile the WHOLE tagged corpus (no FP-pocket drop — gating is app-side now). Tolerant compile keeps
    // a stray incompatible rule from failing the build; a systemic collapse still stops it.
    let source: String = forge::imports(&full_src).join("\n")
        + "\n\n"
        + &tagged
            .iter()
            .map(|r| r.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
    let report = yara::compile_tolerant(&source);
    let compiled = report.rules.iter().count();
    let failed = tagged.len().saturating_sub(compiled);
    let failure_ratio = failed as f64 / tagged.len() as f64;
    if failure_ratio > MAX_COMPILE_FAILURE_RATIO {
        return Err(format!(
            "{failed} of {} rules failed to compile under yara-x ({:.1}% > {:.1}% ceiling) — systemic, \
             inspect the yara-x version and the package. Compiler reported {} errors.",
            tagged.len(),
            100.0 * failure_ratio,
            100.0 * MAX_COMPILE_FAILURE_RATIO,
            report.errors
        ));
    }

    // Side-map: built from the full tagged corpus. A non-compiled rule simply never matches at runtime;
    // keeping it in the map is safe (the match path only fires on actual yara hits).
    let mut side_map: yara::SideMap = std::collections::HashMap::with_capacity(tagged.len());
    for rule in &tagged {
        side_map.insert(
            rule.name.clone(),
            yara::RuleMeta {
                tier: rule.tier,
                score: rule.score,
                is_suspicious: rule.is_suspicious,
            },
        );
    }

    let blob = report
        .rules
        .serialize()
        .map_err(|e| format!("cannot serialize compiled rules: {e}"))?;
    std::fs::write(out_blob, &blob).map_err(|e| format!("cannot write {out_blob}: {e}"))?;
    std::fs::write(out_sidemap, yara::serialize_side_map(&side_map))
        .map_err(|e| format!("cannot write {out_sidemap}: {e}"))?;

    print_report(&tagged, compiled, failed, report.warnings, min_score, out_blob, blob.len());
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
    tagged: &[forge::ForgeRule],
    compiled: usize,
    failed: usize,
    warnings: usize,
    min_score: i32,
    output: &str,
    bytes: usize,
) {
    let core_count = tagged
        .iter()
        .filter(|r| r.tier == forge::Tier::Core)
        .count();
    let extended_count = tagged
        .iter()
        .filter(|r| r.tier == forge::Tier::Extended)
        .count();
    let full_count = tagged
        .iter()
        .filter(|r| r.tier == forge::Tier::Full)
        .count();

    println!("build-yara-rules: bundle complete");
    println!("  parsed:           {} rules", tagged.len());
    println!("  tier core:        {core_count}");
    println!("  tier extended:    {extended_count}");
    println!("  tier full:        {full_count}");
    println!(
        "  compiled:         {} ({} skipped incompatible)",
        compiled, failed
    );
    println!("  yara-x warnings:  {}", warnings);
    println!("  wrote {output} ({bytes} bytes)");

    // _SUSP_ score histogram: count of suspicious rules per 5-point score bucket, ascending. Shares the
    // bucket logic with the runtime /rules/score-histogram endpoint (yara::susp_score_histogram) so the
    // build log and the API never drift.
    let buckets =
        yara::susp_score_histogram(tagged.iter().filter(|r| r.is_suspicious).map(|r| r.score));
    let suspicious_total: usize = buckets.iter().map(|(_, count)| count).sum();
    if suspicious_total > 0 {
        println!("  _SUSP_ rules: {suspicious_total} total (min_score gate = {min_score})");
        println!("  _SUSP_ score histogram (5-point buckets):");
        for (bucket, count) in &buckets {
            println!("    [{:3}-{:3}): {count}", bucket, bucket + 5);
        }
    }
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

    /// Paths for a multi-package build (full / core / extended inputs plus blob and side-map outputs).
    struct MultiPkg {
        full: String,
        core: String,
        extended: String,
        out: String,
        sidemap: String,
    }

    /// Writes three package bodies to a fresh temp dir and returns `(dir, paths)`.
    fn temp_pkg_multi(
        test: &str,
        full_body: &str,
        core_body: &str,
        extended_body: &str,
    ) -> (PathBuf, MultiPkg) {
        let dir =
            std::env::temp_dir().join(format!("byr-{}-{}", test, std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let full = dir.join("full.yar");
        let core = dir.join("core.yar");
        let extended = dir.join("extended.yar");
        let out = dir.join("out.bin");
        let sidemap = dir.join("out.sidemap.json");
        std::fs::write(&full, full_body).unwrap();
        std::fs::write(&core, core_body).unwrap();
        std::fs::write(&extended, extended_body).unwrap();
        let paths = MultiPkg {
            full: full.to_str().unwrap().to_string(),
            core: core.to_str().unwrap().to_string(),
            extended: extended.to_str().unwrap().to_string(),
            out: out.to_str().unwrap().to_string(),
            sidemap: sidemap.to_str().unwrap().to_string(),
        };
        (dir, paths)
    }

    #[test]
    fn run_bakes_full_corpus_and_a_side_map() {
        let full = "import \"pe\"\n\n\
            rule Core_One\n{\n strings:\n  $a = \"x\"\n condition:\n  $a\n}\n\n\
            rule Ext_SUSP_Two\n{\n meta:\n  score = 40\n strings:\n  $b = \"y\"\n condition:\n  $b\n}\n";
        let core = "rule Core_One\n{\n strings:\n  $a = \"x\"\n condition:\n  $a\n}\n";
        let extended = full; // extended ⊇ core; here it equals full minus full-only rules
        let (dir, paths) = temp_pkg_multi("bake", full, core, extended);
        run(&paths.full, &paths.core, &paths.extended, &paths.out, &paths.sidemap, 75)
            .expect("valid packages bake");
        assert!(
            std::fs::metadata(&paths.out).unwrap().len() > 0,
            "blob written"
        );
        let map = magna_carta_scan::yara::deserialize_side_map(
            &std::fs::read(&paths.sidemap).unwrap(),
        )
        .unwrap();
        // The _SUSP_ rule is NOT dropped — it is baked and tagged is_suspicious for app-side gating.
        assert_eq!(map["Core_One"].tier, magna_carta_scan::forge::Tier::Core);
        assert!(map["Ext_SUSP_Two"].is_suspicious && map["Ext_SUSP_Two"].score == 40);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn run_writes_a_blob_for_a_valid_package() {
        let body = "import \"pe\"\n\n\
            rule Good_One\n{\n strings:\n  $a = \"alpha\"\n condition:\n  $a\n}\n\n\
            rule Good_Two\n{\n strings:\n  $b = \"beta\"\n condition:\n  $b\n}\n";
        let (dir, paths) = temp_pkg_multi("valid", body, body, body);
        run(&paths.full, &paths.core, &paths.extended, &paths.out, &paths.sidemap, 75)
            .expect("valid package builds");
        assert!(
            std::path::Path::new(&paths.out).exists(),
            "a blob must be written"
        );
        assert!(
            std::fs::metadata(&paths.out).unwrap().len() > 0,
            "the blob must be non-empty"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn run_fails_loud_on_an_all_dropped_empty_corpus() {
        // A package with no rule headers parses to zero rules → fail loud. The score floor no longer drops
        // rules, so the test uses a genuinely empty package rather than a low-score _SUSP_ rule.
        let body = "import \"pe\"\n\n";
        let (dir, paths) = temp_pkg_multi("empty", body, body, body);
        let err =
            run(&paths.full, &paths.core, &paths.extended, &paths.out, &paths.sidemap, 75)
                .unwrap_err();
        assert!(
            err.contains("empty"),
            "expected the empty-corpus gate; got: {err}"
        );
        assert!(
            !std::path::Path::new(&paths.out).exists(),
            "no blob may be written on a failed build"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn run_fails_loud_on_a_split_inconsistency() {
        // An unclosed rule cannot brace-match → it swallows the next header to EOF → block count (1) falls
        // below header count (2) → the format-drift gate fires.
        let body =
            "import \"pe\"\n\nrule A\n{\n condition:\n  true\n\nrule B\n{\n condition:\n  true\n}\n";
        let (dir, paths) = temp_pkg_multi("inconsistent", body, body, body);
        let err =
            run(&paths.full, &paths.core, &paths.extended, &paths.out, &paths.sidemap, 75)
                .unwrap_err();
        assert!(
            err.contains("inconsistency"),
            "expected the split-inconsistency gate; got: {err}"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn run_fails_loud_on_systemic_compile_failure() {
        // Two rules, one referencing an undefined identifier → 50% compile failure > 5% ceiling.
        let body = "import \"pe\"\n\n\
            rule Ok_Rule\n{\n strings:\n  $a = \"x\"\n condition:\n  $a\n}\n\n\
            rule Bad_Rule\n{\n condition:\n  undefined_identifier\n}\n";
        let (dir, paths) = temp_pkg_multi("collapse", body, body, body);
        let err =
            run(&paths.full, &paths.core, &paths.extended, &paths.out, &paths.sidemap, 75)
                .unwrap_err();
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
        let (dir, paths) = temp_pkg_multi("tolerate", &body, &body, &body);
        run(&paths.full, &paths.core, &paths.extended, &paths.out, &paths.sidemap, 75)
            .expect("one broken rule of 41 is under the ceiling");
        assert!(
            std::path::Path::new(&paths.out).exists(),
            "a blob must be written when under the ceiling"
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}
