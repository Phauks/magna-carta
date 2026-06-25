# Per-firm Scan Policy — Slice A (Engine Substrate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the scan engine so the container reports *raw* facts (clamd verdict + enriched YARA matches tagged with tier/score + structural flags) and the verdict is computed app-side — with **zero behaviour change** (default policy reproduces today's extended/75 result), laying the contract Slice B's per-firm policy needs.

**Architecture:** The container bakes the *full* YARA Forge corpus, tags every rule `{tier, score, isSuspicious}`, runs clamd and yara **concurrently**, and returns a `RawScanResult` instead of a decided verdict. A new pure TypeScript function `computeVerdict(raw, policy)` reproduces the old `combine` logic; `scan_cache` stores the raw result so dedup stays global and Slice B can re-evaluate policy with no re-scan.

**Tech Stack:** Rust (yara-x 1.18, axum 0.8, tokio, serde/serde_json), TypeScript (Cloudflare Workers, Drizzle, Vitest + `@cloudflare/vitest-pool-workers`), Docker.

## Global Constraints

- **Never silently clean** — a scan fault/timeout/missing-engine is a retryable throw (503 from the container; a thrown error in the consumer), NEVER a fabricated clean/unscanned verdict. Copied verbatim from the spec.
- **Per-firm content dedup** — the cached raw result is firm-agnostic; only the verdict is per-firm.
- **Redact-by-default** — telemetry/audit carry verdict + reason only, never file content or name.
- **Zero runtime egress** — the container bakes rules at build; `enableInternet = false` unchanged.
- **Full names, no shorthand** — `engineVersion` not `ev`, `suspiciousScoreFloor` not `floor` in identifiers, etc. (golden rule 12).
- **No process-artifact references in source/tests/config** — no "Slice A", "ADR-NNNN", "spec §" in code/comments; state the reasoning inline (golden rule 13; CI: `node tooling/lint-process-references.mjs`).
- **Commit trailer:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Behaviour-preservation invariant for Slice A:** with the default policy (`tier=extended, suspiciousScoreFloor=75`), `computeVerdict` MUST produce byte-identical verdicts to today's `combine` for every input. This is the slice's acceptance bar.
- **Quality gate:** `pnpm check` (root) for TS; `cargo test` + `cargo clippy` in `containers/scan` for Rust. Worker suite: `pnpm --filter @magna-carta/worker run test`.
- **Worktree:** all work in `C:/dev/magna-carta-worktrees/scan-per-firm-policy` (branch `scan-per-firm-policy`). Subagents MUST `cd` there and verify the branch before editing.

---

## File Structure

**Rust container (`containers/scan/`)**
- `src/forge.rs` — gains a `Tier` enum, a `tier` field on `ForgeRule`, `rule_ids()`, and `assign_tiers()`. Stops being the place rules are *dropped*; becomes the tagger.
- `src/bin/build-yara-rules.rs` — takes three input packages (core/extended/full), bakes the **full** compiled blob, writes a **side-map** `ruleId → {tier, score, isSuspicious}`, and emits the `_SUSP_` score histogram. Keeps all fail-loud gates.
- `src/yara.rs` — gains `RuleMeta`, a baked-side-map loader, and an enriched scan that returns `Vec<RuleMatch>`.
- `src/raw.rs` (NEW) — the `RawScanResult` serialized response struct (clamd verdict + matches + heuristic flag + engineVersion + timings). Replaces the container's role in `verdict.rs`.
- `src/verdict.rs` — `ScanResult`/`combine`/`CombineOutcome` **deleted** from the container (the verdict moves app-side). The file is removed; its structural-`Reason` token mapping moves to `raw.rs`.
- `src/lib.rs` — `scan`/`finish` run clamd ∥ yara concurrently, build a `RawScanResult`, and serialize it; `AppState` gains the side-map.
- `src/main.rs` — loads the side-map at boot alongside the rules blob.
- `Dockerfile` — fetches all three tier packages; passes them to `build-yara-rules`; bakes the side-map file.

**TypeScript (`packages/file-manager/src/`)**
- `scan-port.ts` — `MalwareScanPort.scan` returns `RawScanResult` (new TS type mirroring `raw.rs`); `unscannedAdapter` returns a no-engine raw result.
- `verdict.ts` (NEW) — `computeVerdict(raw, policy): FileVerdict` (the old `combine`, app-side) + `DEFAULT_SCAN_POLICY`.
- `scan-cache.ts` — stores/reads the raw result (serialized JSON) instead of a decided verdict.
- `ingest-core.ts` — calls `computeVerdict(raw, DEFAULT_SCAN_POLICY)` then branches commit/quarantine exactly as today.

**Worker (`apps/worker/src/files/`)**
- `container-scan-adapter.ts` — new zod schema parsing `RawScanResult`.
- `ingest-consumer.ts` — `handleRescanMessage` reads the cached raw result and recomputes the verdict.
- `apps/worker/vitest.config.ts` — the `magna-carta-scan` stub returns a no-engine `RawScanResult`.

---

## Task 1: `forge.rs` — tier tagging

**Files:**
- Modify: `containers/scan/src/forge.rs`
- Test: `containers/scan/src/forge.rs` (`#[cfg(test)]`)

**Interfaces:**
- Produces: `pub enum Tier { Core, Extended, Full }` (derives `Debug, Clone, Copy, PartialEq, Eq, Serialize` with `#[serde(rename_all = "lowercase")]`); `pub fn rule_ids(source: &str) -> std::collections::HashSet<String>`; `pub fn assign_tiers(full_source: &str, core_ids: &HashSet<String>, extended_ids: &HashSet<String>) -> Vec<ForgeRule>` where each returned `ForgeRule` has its `tier` set (Core if its name ∈ core_ids, else Extended if ∈ extended_ids, else Full); `ForgeRule` gains `pub tier: Tier`.

- [ ] **Step 1: Write the failing test**

```rust
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p magna-carta-scan --lib forge::tests::assigns_tier_by_package_membership forge::tests::rule_ids_extracts_every_header_name`
Expected: FAIL — `Tier`, `rule_ids`, `assign_tiers` not found; `ForgeRule` has no `tier`.

- [ ] **Step 3: Implement**

Add to `forge.rs` (top-level), and add `use serde::Serialize;` if absent:

```rust
/// Which YARA Forge package a rule first appears in. The packages are nested (core ⊂ extended ⊂ full),
/// so a rule's tier is the narrowest package containing it. Carried per rule so the app can gate matches
/// to a firm's chosen tier without re-running the engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Core,
    Extended,
    Full,
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
```

Add `pub tier: Tier,` to the `ForgeRule` struct, and set it to `Tier::Full` in the `split_rules` constructor (it is overwritten by `assign_tiers`; `Full` is the safe default for a rule of unknown provenance). Update the `splits_every_rule_block` / `parses_score_and_flags` existing tests' `ForgeRule { … }` literals if they construct the struct directly (they use `split_rules`, so only the constructor in `split_rules` changes).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p magna-carta-scan --lib forge::`
Expected: PASS (new + existing forge tests).

- [ ] **Step 5: Commit**

```bash
git add containers/scan/src/forge.rs
git commit -m "feat(scan): tag YARA rules with their Forge tier (core/extended/full)"
```

---

## Task 2: `yara.rs` — rule metadata side-map + enriched matches

**Files:**
- Modify: `containers/scan/src/yara.rs`
- Test: `containers/scan/src/yara.rs` (`#[cfg(test)]`)

**Interfaces:**
- Consumes: `forge::Tier` (Task 1).
- Produces: `pub struct RuleMeta { pub tier: forge::Tier, pub score: i32, pub is_suspicious: bool }` (derives `Debug, Clone, Serialize, Deserialize, PartialEq`); `pub type SideMap = std::collections::HashMap<String, RuleMeta>`; `pub fn serialize_side_map(map: &SideMap) -> Vec<u8>` and `pub fn deserialize_side_map(bytes: &[u8]) -> Result<SideMap, String>` (JSON); `pub struct RuleMatch { pub rule_id: String, pub tier: forge::Tier, pub score: i32, pub is_suspicious: bool }` (derives `Debug, Clone, Serialize, PartialEq`); `pub fn enrich_matches(ids: Vec<String>, map: &SideMap) -> Vec<RuleMatch>` (a matched id absent from the map — defensive — is emitted as `tier=Full, score=0, is_suspicious=false`, i.e. it always counts, fail-safe-toward-flagging).

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn enriches_matches_from_the_side_map() {
    use crate::forge::Tier;
    let mut map = std::collections::HashMap::new();
    map.insert("Known_Rule".to_string(), RuleMeta { tier: Tier::Core, score: 90, is_suspicious: false });
    let enriched = enrich_matches(vec!["Known_Rule".into(), "Unknown_Rule".into()], &map);
    assert_eq!(enriched[0], RuleMatch { rule_id: "Known_Rule".into(), tier: Tier::Core, score: 90, is_suspicious: false });
    // An unmapped match fails safe toward flagging: Full tier, score 0, not suspicious → always counts.
    assert_eq!(enriched[1], RuleMatch { rule_id: "Unknown_Rule".into(), tier: Tier::Full, score: 0, is_suspicious: false });
}

#[test]
fn side_map_round_trips_through_serialization() {
    use crate::forge::Tier;
    let mut map = std::collections::HashMap::new();
    map.insert("R".to_string(), RuleMeta { tier: Tier::Extended, score: 75, is_suspicious: true });
    let restored = deserialize_side_map(&serialize_side_map(&map)).unwrap();
    assert_eq!(restored, map);
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p magna-carta-scan --lib yara::tests::enriches yara::tests::side_map`
Expected: FAIL — `RuleMeta`, `enrich_matches`, `serialize_side_map`, `deserialize_side_map`, `RuleMatch` undefined.

- [ ] **Step 3: Implement**

Add `use serde::{Deserialize, Serialize};` and:

```rust
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
#[derive(Debug, Clone, Serialize, PartialEq)]
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
/// mismatch — should never happen, both are built together) fails safe toward flagging: tier Full, score 0,
/// not suspicious, so the match always counts under any policy rather than being silently dropped.
pub fn enrich_matches(ids: Vec<String>, map: &SideMap) -> Vec<RuleMatch> {
    ids.into_iter()
        .map(|rule_id| match map.get(&rule_id) {
            Some(meta) => RuleMatch { rule_id, tier: meta.tier, score: meta.score, is_suspicious: meta.is_suspicious },
            None => RuleMatch { rule_id, tier: crate::forge::Tier::Full, score: 0, is_suspicious: false },
        })
        .collect()
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cargo test -p magna-carta-scan --lib yara::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add containers/scan/src/yara.rs
git commit -m "feat(scan): rule metadata side-map + enriched yara matches"
```

---

## Task 3: `build-yara-rules.rs` — bake full corpus + side-map + histogram

**Files:**
- Modify: `containers/scan/src/bin/build-yara-rules.rs`
- Test: `containers/scan/src/bin/build-yara-rules.rs` (`#[cfg(test)]`)

**Interfaces:**
- Consumes: `forge::{assign_tiers, rule_ids, Tier}`, `yara::{RuleMeta, SideMap, serialize_side_map, compile_tolerant}`.
- Produces: a CLI `build-yara-rules <full.yar> <core.yar> <extended.yar> <out.bin> <out.sidemap.json> [min_suspicious_score]` that bakes the full compiled blob (tolerant compile, all gates retained) AND writes the side-map JSON. The `min_suspicious_score` no longer DROPS rules — it is recorded only for the histogram/log; all rules are baked (gating happens app-side). The empty-corpus gate now checks the full parsed/compiled count, not a post-filter count.

- [ ] **Step 1: Write the failing test**

```rust
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
    assert!(std::fs::metadata(&paths.out).unwrap().len() > 0, "blob written");
    let map = magna_carta_scan::yara::deserialize_side_map(&std::fs::read(&paths.sidemap).unwrap()).unwrap();
    // The _SUSP_ rule is NOT dropped — it is baked and tagged is_suspicious for app-side gating.
    assert_eq!(map["Core_One"].tier, magna_carta_scan::forge::Tier::Core);
    assert!(map["Ext_SUSP_Two"].is_suspicious && map["Ext_SUSP_Two"].score == 40);
    std::fs::remove_dir_all(&dir).ok();
}
```

Add a `temp_pkg_multi` helper mirroring the existing `temp_pkg`, returning a struct with `full/core/extended/out/sidemap` `PathBuf`s.

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p magna-carta-scan --bin build-yara-rules run_bakes_full_corpus_and_a_side_map`
Expected: FAIL — `run` has the old 3-arg signature; no side-map.

- [ ] **Step 3: Implement**

Rewrite `run` to the new signature. Key body (retain the existing fail-loud gates, adapted to "bake-all"):

```rust
fn run(full: &str, core: &str, extended: &str, out_blob: &str, out_sidemap: &str, min_score: i32) -> Result<(), String> {
    let full_src = std::fs::read_to_string(full).map_err(|e| format!("cannot read full package {full}: {e}"))?;
    let core_ids = forge::rule_ids(&std::fs::read_to_string(core).map_err(|e| format!("cannot read core package {core}: {e}"))?);
    let extended_ids = forge::rule_ids(&std::fs::read_to_string(extended).map_err(|e| format!("cannot read extended package {extended}: {e}"))?);

    // Format-drift guard, unchanged in spirit: brace-matched split count must equal the header count.
    let header_count = count_rule_headers(&full_src);
    let tagged = forge::assign_tiers(&full_src, &core_ids, &extended_ids);
    if tagged.len() != header_count {
        return Err(format!(
            "rule-split inconsistency: brace-matching produced {} blocks but the full package has {} \
             headers — a rule failed to brace-match. Re-validate src/forge.rs's split before shipping.",
            tagged.len(), header_count
        ));
    }
    if tagged.is_empty() {
        return Err("the full package parsed to zero rules — refusing to bake an empty corpus".to_string());
    }

    // Compile the WHOLE tagged corpus (no FP-pocket drop — gating is app-side now). Tolerant compile keeps a
    // stray incompatible rule from failing the build; a systemic collapse still stops it.
    let source: String = forge::imports(&full_src).join("\n") + "\n\n"
        + &tagged.iter().map(|r| r.text.as_str()).collect::<Vec<_>>().join("\n");
    let report = yara::compile_tolerant(&source);
    let compiled = report.rules.iter().count();
    let failed = tagged.len().saturating_sub(compiled);
    let failure_ratio = failed as f64 / tagged.len() as f64;
    if failure_ratio > MAX_COMPILE_FAILURE_RATIO {
        return Err(format!(
            "{failed} of {} rules failed to compile under yara-x ({:.1}% > {:.1}% ceiling) — systemic, \
             inspect the yara-x version and the package. Compiler reported {} errors.",
            tagged.len(), 100.0 * failure_ratio, 100.0 * MAX_COMPILE_FAILURE_RATIO, report.errors
        ));
    }

    // Side-map: only rules that actually compiled are reachable as matches, but bake the full tagged set —
    // a non-compiled rule simply never matches. Build the map from the tagged corpus.
    let mut side_map: yara::SideMap = std::collections::HashMap::with_capacity(tagged.len());
    for rule in &tagged {
        side_map.insert(rule.name.clone(), yara::RuleMeta { tier: rule.tier, score: rule.score, is_suspicious: rule.is_suspicious });
    }

    let blob = report.rules.serialize().map_err(|e| format!("cannot serialize compiled rules: {e}"))?;
    std::fs::write(out_blob, &blob).map_err(|e| format!("cannot write {out_blob}: {e}"))?;
    std::fs::write(out_sidemap, yara::serialize_side_map(&side_map)).map_err(|e| format!("cannot write {out_sidemap}: {e}"))?;

    print_report(&tagged, compiled, failed, report.warnings, min_score, out_blob, blob.len());
    Ok(())
}
```

Update `main()` to read five positional args + optional score; update `print_report` to take `&[forge::ForgeRule]` and log the tier breakdown + the `_SUSP_` score histogram (count of suspicious rules per 5-point score bucket). Update the existing gate tests (`run_fails_loud_on_*`) to the new 6-arg `run` signature and the bake-all semantics (the empty-corpus test now needs a truly empty package; the split-inconsistency and systemic-collapse tests pass the same body as full/core/extended).

- [ ] **Step 4: Run to verify pass**

Run: `cargo test -p magna-carta-scan --bin build-yara-rules`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add containers/scan/src/bin/build-yara-rules.rs
git commit -m "feat(scan): bake the full YARA corpus + tier/score side-map (no build-time FP drop)"
```

---

## Task 4: `Dockerfile` — fetch all three tiers, bake the side-map

**Files:**
- Modify: `containers/scan/Dockerfile`
- Modify: `containers/scan/entrypoint.sh` (export `YARA_SIDEMAP_PATH`)

**Interfaces:**
- Produces: image bakes `/etc/scan/yara-rules.bin`, `/etc/scan/yara-rules.tag`, and `/etc/scan/yara-rules.sidemap.json`; runtime env `YARA_SIDEMAP_PATH=/etc/scan/yara-rules.sidemap.json`.

- [ ] **Step 1: Edit the build stage**

Replace the single-tier fetch + `build-yara-rules` call (current Dockerfile lines ~31-45) with a three-tier fetch. Download `yara-forge-rules-core.zip`, `-extended.zip`, `-full.zip` for the resolved `${TAG}`, unzip each to its own dir, assert exactly one `.yar` per package (same guard as today, per package), then:

```dockerfile
    /src/target/release/build-yara-rules \
      "$FULL_YAR" "$CORE_YAR" "$EXTENDED_YAR" \
      /out/yara-rules.bin /out/yara-rules.sidemap.json "${YARA_MIN_SUSP_SCORE}"; \
    printf '%s' "$TAG" > /out/yara-rules.tag
```

`YARA_FORGE_TIER` ARG is removed (we now bake all tiers). Keep `YARA_MIN_SUSP_SCORE` (histogram/log only) and `YARA_FORGE_TAG`.

In the runtime stage, add:

```dockerfile
COPY --from=build /out/yara-rules.sidemap.json /etc/scan/yara-rules.sidemap.json
ENV YARA_SIDEMAP_PATH=/etc/scan/yara-rules.sidemap.json
```

In `entrypoint.sh`, beside the existing `YARA_RULES_TAG` export, add `export YARA_SIDEMAP_PATH=/etc/scan/yara-rules.sidemap.json` (or rely on the Dockerfile `ENV`; keep one source of truth — prefer the Dockerfile `ENV`, so no entrypoint change is strictly needed; only add it if the tag pattern is mirrored).

- [ ] **Step 2: Validate the Dockerfile parses (no Docker build here — gated to deploy)**

Run: `docker build --no-cache --target build -t scan-build-check containers/scan` is NOT run locally (Docker is flaky and image build is deploy-gated). Instead, lint the Dockerfile syntax by inspection and rely on the Workers Builds CI for the real build. Note this in the commit body.

- [ ] **Step 3: Commit**

```bash
git add containers/scan/Dockerfile containers/scan/entrypoint.sh
git commit -m "build(scan): fetch all three YARA Forge tiers and bake the rule side-map"
```

---

## Task 5: `raw.rs` — the RawScanResult response; delete container-side verdict

**Files:**
- Create: `containers/scan/src/raw.rs`
- Delete: `containers/scan/src/verdict.rs`
- Modify: `containers/scan/src/lib.rs` (module wiring; keep `combine` call-sites until Task 6)

**Interfaces:**
- Consumes: `yara::RuleMatch`, `heuristics::{Heuristic, Reason}`, `clamav::ClamVerdict`.
- Produces: `RawScanResult` (serialized to the HTTP body) and `EngineTimings`:

```rust
// containers/scan/src/raw.rs
use serde::Serialize;
use crate::clamav::ClamVerdict;
use crate::heuristics::{Heuristic, Reason};
use crate::yara::RuleMatch;

/// The clamd outcome as a fact (not a verdict): clean, a named signature, or the engine was unavailable.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum ClamFact {
    Clean,
    Infected { signature: String },
    Unavailable,
}

/// A structural-heuristic fact: none, a named structural attack, encrypted/uninspectable, or active content.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum HeuristicFact {
    None,
    Structural { reason: String },
    Encrypted,
    ActiveContent,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct EngineTimings {
    #[serde(rename = "clamdMs")]
    pub clamd_ms: u64,
    #[serde(rename = "yaraMs")]
    pub yara_ms: u64,
}

/// The raw scan facts the container returns. The app computes the per-firm verdict from this; the container
/// never decides infected/suspicious. A clamd-unavailable with no other signal is surfaced honestly so the
/// app can RETRY (never a fabricated clean).
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct RawScanResult {
    #[serde(rename = "engineVersion")]
    pub engine_version: String,
    pub clam: ClamFact,
    pub heuristic: HeuristicFact,
    pub matches: Vec<RuleMatch>,
    pub timings: EngineTimings,
}

pub fn structural_reason_token(reason: Reason) -> &'static str {
    match reason {
        Reason::DecompressionBomb => "decompression-bomb",
        Reason::ArchiveNesting => "archive-nesting",
        Reason::ArchiveEntryCount => "archive-entry-count",
    }
}

pub fn heuristic_fact(heuristic: Heuristic) -> HeuristicFact {
    match heuristic {
        Heuristic::Clean => HeuristicFact::None,
        Heuristic::Suspicious(reason) => HeuristicFact::Structural { reason: structural_reason_token(reason).to_string() },
        Heuristic::Encrypted => HeuristicFact::Encrypted,
        Heuristic::ActiveContent => HeuristicFact::ActiveContent,
    }
}

pub fn clam_fact(clam: &ClamVerdict) -> ClamFact {
    match clam {
        ClamVerdict::Clean => ClamFact::Clean,
        ClamVerdict::Infected(signature) => ClamFact::Infected { signature: signature.clone() },
        ClamVerdict::Unavailable => ClamFact::Unavailable,
    }
}
```

- [ ] **Step 1: Write the failing test (in `raw.rs`)**

```rust
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
            timings: EngineTimings { clamd_ms: 5, yara_ms: 2 },
        };
        assert_eq!(
            serde_json::to_value(&raw).unwrap(),
            json!({"engineVersion":"engine/1","clam":{"state":"clean"},
                   "heuristic":{"kind":"none"},"matches":[],"timings":{"clamdMs":5,"yaraMs":2}})
        );
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p magna-carta-scan --lib raw::`
Expected: FAIL — module `raw` not declared.

- [ ] **Step 3: Implement** — create `raw.rs` as above; in `lib.rs` replace `mod verdict;` / `pub use verdict::…` with `mod raw; pub use raw::*;`. Delete `src/verdict.rs`. `lib.rs`'s `finish` still references `combine`; temporarily inline the old behaviour is NOT needed — Task 6 rewrites `finish`. To keep the tree compiling between tasks, do Task 5 and Task 6 as one commit if `finish` will not compile without `combine`. (Practically: implement Task 5 + Task 6 together; the test gate for Task 5 is the `raw::` unit test, for Task 6 the handler tests.)

- [ ] **Step 4: Run to verify pass** — `cargo test -p magna-carta-scan --lib raw::` PASS (after Task 6 the whole crate compiles).

- [ ] **Step 5: Commit** (folded with Task 6 if needed)

```bash
git add containers/scan/src/raw.rs containers/scan/src/verdict.rs containers/scan/src/lib.rs
git commit -m "refactor(scan): container returns raw facts (RawScanResult), not a verdict"
```

---

## Task 6: `lib.rs` — concurrent engines, build & serialize RawScanResult

**Files:**
- Modify: `containers/scan/src/lib.rs`, `containers/scan/src/main.rs`

**Interfaces:**
- Consumes: `raw::{RawScanResult, clam_fact, heuristic_fact, EngineTimings}`, `yara::{enrich_matches, SideMap}`.
- Produces: `AppState` gains `pub side_map: Arc<yara::SideMap>`. `finish` returns `200 + RawScanResult` JSON; a clamd-`Unavailable` with empty matches AND `HeuristicFact::None`/`Encrypted` is still surfaced as a raw result (the app decides retry), BUT the never-silently-clean contract is preserved by the app: see Task 8. The container’s only 503 stays the **engine panic** isolation (a parser crash), not clamd-unavailable.

> Design note for the implementer: today the container 503s on clamd-unavailable. We move that retry decision app-side (the raw result carries `clam: unavailable`), so the container returns 200 with `ClamFact::Unavailable`. The app's `computeVerdict` throws on `unavailable + no other signal`. Keep the **panic** path as a 503 (an isolated engine crash is a true container fault).

- [ ] **Step 1: Write the failing test** (handler-level, in `lib.rs` tests or `tests/`)

```rust
#[tokio::test]
async fn scan_returns_raw_facts_with_timings() {
    // A clean buffer through the handler yields clam=clean (or unavailable in CI without clamd),
    // empty matches, and timings present. Uses the existing test_state() helper pattern.
    let state = test_state();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { let _ = axum::serve(listener, router(state)).await; });
    let resp = reqwest::Client::new()
        .post(format!("http://{addr}/scan?size=4&type=text/plain"))
        .body("abcd").send().await.unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body.get("matches").is_some() && body.get("timings").is_some() && body.get("clam").is_some());
}
```

- [ ] **Step 2: Run to verify failure** — `cargo test -p magna-carta-scan scan_returns_raw_facts_with_timings` FAILS (handler still returns the old verdict shape / does not compile).

- [ ] **Step 3: Implement**

Rewrite `scan`/`finish` so clamd and yara run concurrently and assemble a `RawScanResult`. Sketch (adapt to the existing spool/buffer split):

```rust
// In finish(...): run clamd (already awaited upstream OR move it here) and yara concurrently.
let clamd_started = std::time::Instant::now();
let clam_future = clamav::scan_file_path(spooled.path(), &state.clamd_address); // returns ClamVerdict
let rules = state.rules.clone();
let side_map = state.side_map.clone();
let bytes = /* mmap or buffer */;
let yara_future = tokio::task::spawn_blocking(move || {
    let started = std::time::Instant::now();
    let out = isolate_engines(|| {
        let ids = yara::yara_scan(&rules, &bytes)?; // Result<Vec<String>, _> -> None on fault via isolate
        let heuristic = heuristics::inspect(&bytes, caps); // existing call
        Some(EngineOutput { matches: yara::enrich_matches(ids.unwrap_or_default(), &side_map), heuristic })
    });
    (out, started.elapsed().as_millis() as u64)
});
let (clam, (engine_out, yara_ms)) = tokio::join!(async { let r = clam_future.await; (r, clamd_started.elapsed().as_millis() as u64) }, yara_future);
let (clam_verdict, clamd_ms) = clam;
let engine_out = match engine_out.ok().flatten() { Some(o) => o, None => return service_unavailable() /* panic isolation only */ };

let raw = RawScanResult {
    engine_version: state.engine_version.to_string(),
    clam: raw::clam_fact(&clam_verdict),
    heuristic: raw::heuristic_fact(engine_out.heuristic),
    matches: engine_out.matches,
    timings: EngineTimings { clamd_ms, yara_ms },
};
Json(raw).into_response()
```

Change `EngineOutput` to `{ matches: Vec<yara::RuleMatch>, heuristic: heuristics::Heuristic }`. In `main.rs`, load the side-map at boot beside the rules blob:

```rust
let side_map = match std::env::var("YARA_SIDEMAP_PATH") {
    Ok(path) => {
        let bytes = std::fs::read(&path).unwrap_or_else(|e| { eprintln!("FATAL: cannot read side map {path}: {e}"); std::process::exit(1); });
        yara::deserialize_side_map(&bytes).unwrap_or_else(|e| { eprintln!("FATAL: {e}"); std::process::exit(1); })
    }
    None => std::collections::HashMap::new(), // rule-free dev/test build
};
// ... AppState { rules: Arc::new(rules), side_map: Arc::new(side_map), clamd_address, caps, engine_version }
```

- [ ] **Step 4: Run** — `cargo test -p magna-carta-scan && cargo clippy -p magna-carta-scan -- -D warnings`. Expected: PASS, no clippy errors. (Existing `scan_fault.rs` / `clamav_eicar.rs` tests updated to assert the raw shape — clamd-unavailable now yields `clam:{state:unavailable}` + 200, not 503; the panic test still asserts 503.)

- [ ] **Step 5: Commit**

```bash
git add containers/scan/src/lib.rs containers/scan/src/main.rs containers/scan/tests
git commit -m "feat(scan): run clamd and yara concurrently; serialize raw facts + timings"
```

---

## Task 7: `scan-port.ts` — RawScanResult contract

**Files:**
- Modify: `packages/file-manager/src/scan-port.ts`
- Test: `packages/file-manager/test/scan-port.test.ts` (create if absent; else colocated)

**Interfaces:**
- Produces:

```typescript
export type Tier = "core" | "extended" | "full";

export interface RuleMatch { ruleId: string; tier: Tier; score: number; isSuspicious: boolean; }

export type RawScanResult = {
  engineVersion: string | null;
  clam: { state: "clean" } | { state: "infected"; signature: string } | { state: "unavailable" };
  heuristic:
    | { kind: "none" }
    | { kind: "structural"; reason: "decompression-bomb" | "archive-nesting" | "archive-entry-count" }
    | { kind: "encrypted" }
    | { kind: "active-content" };
  matches: RuleMatch[];
  timings: { clamdMs: number; yaraMs: number };
};

export interface MalwareScanPort {
  scan(body: ReadableStream<Uint8Array>, meta: { sizeBytes: number; sniffedContentType: string | null }): Promise<RawScanResult>;
}
```

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { unscannedAdapter } from "../src/scan-port.ts";

describe("unscannedAdapter", () => {
  it("returns a no-engine raw result", async () => {
    const body = new ReadableStream<Uint8Array>({ start(c) { c.close(); } });
    const raw = await unscannedAdapter.scan(body, { sizeBytes: 0, sniffedContentType: null });
    expect(raw).toEqual({
      engineVersion: null, clam: { state: "unavailable" }, heuristic: { kind: "none" },
      matches: [], timings: { clamdMs: 0, yaraMs: 0 },
    });
  });
});
```

> Note: `unscannedAdapter` must NOT imply "clean". `clam: unavailable` + the app's `computeVerdict` makes the no-engine launch adapter resolve to `unscanned`/no-engine (see Task 8), preserving today's honest behaviour.

- [ ] **Step 2: Run** — `pnpm --filter @magna-carta/file-manager exec vitest run scan-port` → FAIL.
- [ ] **Step 3: Implement** the types + rewrite `unscannedAdapter` to return the no-engine raw result above.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/file-manager/src/scan-port.ts packages/file-manager/test/scan-port.test.ts
git commit -m "feat(file-manager): MalwareScanPort returns RawScanResult"
```

---

## Task 8: `verdict.ts` — app-side computeVerdict (the old `combine`, exactly)

**Files:**
- Create: `packages/file-manager/src/verdict.ts`
- Test: `packages/file-manager/test/verdict.test.ts`

**Interfaces:**
- Consumes: `RawScanResult`, `RuleMatch`, `Tier` (Task 7).
- Produces:

```typescript
export interface ScanPolicy { tier: Tier; suspiciousScoreFloor: number; }
export const DEFAULT_SCAN_POLICY: ScanPolicy = { tier: "extended", suspiciousScoreFloor: 75 };

export type FileVerdict =
  | { verdict: "clean"; activeContent: boolean }
  | { verdict: "flagged"; reason: string }
  | { verdict: "unscanned"; reason: "encrypted" | "no-engine" };

export class ScanFaultError extends Error {} // thrown → consumer retries; NEVER a clean

export function tierRank(tier: Tier): number { return tier === "core" ? 0 : tier === "extended" ? 1 : 2; }

export function matchCounts(match: RuleMatch, policy: ScanPolicy): boolean {
  if (tierRank(match.tier) > tierRank(policy.tier)) return false;
  return !match.isSuspicious || match.score >= policy.suspiciousScoreFloor;
}

export function computeVerdict(raw: RawScanResult, policy: ScanPolicy): FileVerdict;
```

`computeVerdict` precedence (mirrors the deleted Rust `combine`, generalized to one `flagged` state):
1. `clam.state === "infected"` → `flagged` (reason = `clam.signature`).
2. a counting match → `flagged` (reason = its `ruleId`).
3. `heuristic.kind === "structural"` → `flagged` (reason = its `reason`).
4. `heuristic.kind === "encrypted"` → `unscanned`/`encrypted`.
5. `clam.state === "unavailable"`:
   - if `engineVersion === null` → `unscanned`/`no-engine` (the honest no-engine launch adapter);
   - else **throw `ScanFaultError`** (a deployed engine went unavailable → retry; never clean).
6. else → `clean` (`activeContent = heuristic.kind === "active-content"`).

- [ ] **Step 1: Write the failing test** (the behaviour-preservation truth table)

```typescript
import { describe, expect, it } from "vitest";
import { computeVerdict, DEFAULT_SCAN_POLICY, ScanFaultError } from "../src/verdict.ts";
import type { RawScanResult } from "../src/scan-port.ts";

const base: RawScanResult = {
  engineVersion: "engine/1", clam: { state: "clean" }, heuristic: { kind: "none" },
  matches: [], timings: { clamdMs: 1, yaraMs: 1 },
};

describe("computeVerdict (default policy = extended/75)", () => {
  it("clamd signature -> flagged with the signature", () => {
    expect(computeVerdict({ ...base, clam: { state: "infected", signature: "Eicar" } }, DEFAULT_SCAN_POLICY))
      .toEqual({ verdict: "flagged", reason: "Eicar" });
  });
  it("a high-confidence yara match in-tier -> flagged", () => {
    expect(computeVerdict({ ...base, matches: [{ ruleId: "R", tier: "core", score: 90, isSuspicious: false }] }, DEFAULT_SCAN_POLICY))
      .toEqual({ verdict: "flagged", reason: "R" });
  });
  it("a suspicious match below the floor does NOT count", () => {
    expect(computeVerdict({ ...base, matches: [{ ruleId: "S", tier: "extended", score: 40, isSuspicious: true }] }, DEFAULT_SCAN_POLICY))
      .toEqual({ verdict: "clean", activeContent: false });
  });
  it("a full-only match is out of an extended policy's tier", () => {
    expect(computeVerdict({ ...base, matches: [{ ruleId: "F", tier: "full", score: 90, isSuspicious: false }] }, DEFAULT_SCAN_POLICY))
      .toEqual({ verdict: "clean", activeContent: false });
  });
  it("structural attack -> flagged", () => {
    expect(computeVerdict({ ...base, heuristic: { kind: "structural", reason: "decompression-bomb" } }, DEFAULT_SCAN_POLICY))
      .toEqual({ verdict: "flagged", reason: "decompression-bomb" });
  });
  it("encrypted -> unscanned/encrypted", () => {
    expect(computeVerdict({ ...base, heuristic: { kind: "encrypted" } }, DEFAULT_SCAN_POLICY))
      .toEqual({ verdict: "unscanned", reason: "encrypted" });
  });
  it("no-engine (null version, unavailable) -> unscanned/no-engine", () => {
    expect(computeVerdict({ ...base, engineVersion: null, clam: { state: "unavailable" } }, DEFAULT_SCAN_POLICY))
      .toEqual({ verdict: "unscanned", reason: "no-engine" });
  });
  it("a DEPLOYED engine going unavailable throws (retry, never clean)", () => {
    expect(() => computeVerdict({ ...base, clam: { state: "unavailable" } }, DEFAULT_SCAN_POLICY)).toThrow(ScanFaultError);
  });
  it("active content rides a clean verdict", () => {
    expect(computeVerdict({ ...base, heuristic: { kind: "active-content" } }, DEFAULT_SCAN_POLICY))
      .toEqual({ verdict: "clean", activeContent: true });
  });
});
```

- [ ] **Step 2: Run** → FAIL (`verdict.ts` absent).
- [ ] **Step 3: Implement** `verdict.ts` per the precedence above.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/file-manager/src/verdict.ts packages/file-manager/test/verdict.test.ts
git commit -m "feat(file-manager): app-side computeVerdict from raw scan facts + firm policy"
```

---

## Task 9: `scan-cache.ts` + `ingest-core.ts` — store raw, decide app-side

**Files:**
- Modify: `packages/file-manager/src/scan-cache.ts` (store/read the raw result JSON)
- Modify: `packages/file-manager/src/ingest-core.ts` (use `computeVerdict`)
- Test: existing `ingest-core` tests + a cache round-trip test

**Interfaces:**
- Consumes: `RawScanResult`, `computeVerdict`, `DEFAULT_SCAN_POLICY`, `ScanFaultError`.
- `scan_cache` keeps the `(content_sha256, engine_version)` key; the stored value column becomes the serialized `RawScanResult` (JSON text). `lookupScanCache` returns `RawScanResult | undefined`; `recordScanCache` takes a `RawScanResult`.
- `ingest-core.ts`: replace the `scan.verdict === "infected" | "suspicious" | "clean"` branch (current lines ~171-184) with:

```typescript
let fileVerdict: FileVerdict;
try {
  fileVerdict = computeVerdict(raw, DEFAULT_SCAN_POLICY);
} catch (error) {
  if (error instanceof ScanFaultError) throw error; // retryable — never commit
  throw error;
}
if (fileVerdict.verdict === "flagged")
  return { kind: "quarantine", reason: "scan-flagged", scanDetail: fileVerdict.reason };
return {
  kind: "commit",
  sizeBytes: input.objectSize,
  sniffedContentType,
  contentSha256: hashed.hash,
  scanVerdict: fileVerdict.verdict === "clean" ? "clean" : "unscanned",
  scanEngineVersion: raw.engineVersion,
  scanDetail: fileVerdict.verdict === "clean" ? (fileVerdict.activeContent ? "active-content" : null)
    : fileVerdict.reason,
};
```

The `QuarantineReason` union `"scan-infected" | "scan-suspicious"` collapses to a single `"scan-flagged"` (Slice A keeps quarantine-on-flag — treatment policy is Slice B). Update the migration that seeds quarantine reasons if any enum/CHECK constraint references the old names (check `packages/database` for a `quarantine` reason column constraint; if present, add a per-firm migration mapping old→new — but since this is pre-production with no rows, a forward migration that widens/replaces the CHECK is sufficient).

- [ ] **Step 1: Write the failing tests** — (a) a `scan_cache` round-trip storing/reading a `RawScanResult`; (b) update `ingest-core` tests: an infected raw → `{ kind: "quarantine", reason: "scan-flagged" }`; a clean raw → commit clean; a deployed-unavailable raw → the ingest path throws (retry).

```typescript
it("quarantines a flagged upload with the reason text", async () => {
  const raw = { engineVersion: "engine/1", clam: { state: "infected", signature: "Eicar" },
    heuristic: { kind: "none" }, matches: [], timings: { clamdMs: 1, yaraMs: 1 } } as const;
  const outcome = await runIngestWithRaw(raw); // existing harness, injecting the scan adapter
  expect(outcome).toMatchObject({ kind: "quarantine", reason: "scan-flagged", scanDetail: "Eicar" });
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the cache reshape + ingest branch + reason rename + migration if needed.
- [ ] **Step 4: Run** — `pnpm --filter @magna-carta/file-manager exec vitest run` → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/file-manager/src/scan-cache.ts packages/file-manager/src/ingest-core.ts packages/database
git commit -m "feat(file-manager): cache raw scan facts; decide verdict app-side at ingest"
```

---

## Task 10: Worker adapter + consumer + test stub — integration green

**Files:**
- Modify: `apps/worker/src/files/container-scan-adapter.ts` (parse `RawScanResult`)
- Modify: `apps/worker/src/files/ingest-consumer.ts` (`handleRescanMessage` recomputes from raw)
- Modify: `apps/worker/vitest.config.ts` (the `magna-carta-scan` stub returns a no-engine `RawScanResult`)
- Test: `apps/worker/test/container-scan-adapter.test.ts`, `ingest-consumer.test.ts`

**Interfaces:**
- `container-scan-adapter.ts`: replace the 4-variant `scanResultSchema` with a zod schema for `RawScanResult` (object with `engineVersion`, `clam` discriminated on `state`, `heuristic` discriminated on `kind`, `matches` array, `timings`). Returns `RawScanResult`.
- `handleRescanMessage`: today it maps a cached verdict; now it `lookupScanCache → RawScanResult`, calls `computeVerdict(raw, DEFAULT_SCAN_POLICY)`, and records the resulting verdict (re-scan via the container when the cache misses on the new engineVersion, exactly as today).
- `vitest.config.ts` `SCAN_SERVICE_STUB_SCRIPT`: return `{"engineVersion":null,"clam":{"state":"unavailable"},"heuristic":{"kind":"none"},"matches":[],"timings":{"clamdMs":0,"yaraMs":0}}`.

- [ ] **Step 1: Update the adapter test**

```typescript
it("parses a RawScanResult from the container", async () => {
  const raw = { engineVersion: "engine/1", clam: { state: "infected", signature: "Eicar-Test-Signature" },
    heuristic: { kind: "none" }, matches: [{ ruleId: "R", tier: "core", score: 90, isSuspicious: false }],
    timings: { clamdMs: 3, yaraMs: 1 } };
  const result = await containerScanAdapter(fakeContainer(raw)).scan(emptyBody(), meta);
  expect(result).toEqual(raw);
});
```

- [ ] **Step 2: Run** — `pnpm --filter @magna-carta/worker run test container-scan-adapter` → FAIL.
- [ ] **Step 3: Implement** the new zod schema, the rescan recompute, and the stub.
- [ ] **Step 4: Run the full worker suite** — `pnpm --filter @magna-carta/worker run test`. Expected: all green (the stub's no-engine raw → `unscanned`/no-engine downstream, matching prior behaviour).
- [ ] **Step 5: Run the whole gate** — `pnpm check` (root) and `cargo clippy -p magna-carta-scan -- -D warnings` and `node tooling/lint-process-references.mjs`. Expected: clean.
- [ ] **Step 6: Commit + docs**

```bash
git add apps/worker docs/ STATUS.md ROADMAP.md changelog.d/ docs/decisions/pending/
git commit -m "feat(scan): worker consumes raw scan facts; engine-substrate refactor complete"
```

Docs for this commit (golden rule 5): a `changelog.d/scan-raw-facts.md` fragment; a `docs/decisions/pending/scan-raw-facts.md` ADR fragment (decision: container reports raw facts, verdict computed app-side, full corpus baked + per-firm gating seam); update `STATUS.md` (scan slice row) and `ROADMAP.md`; update `containers/scan/CLAUDE.md` to describe the raw contract + side-map.

---

## Self-Review

**Spec coverage:** forge tagger (T1) ✓; full-corpus bake + side-map + histogram (T3) ✓; fetch all three tiers (T4) ✓; concurrent engines + timing (T6) ✓; container returns enriched raw matches (T2,T5,T6) ✓; MalwareScanPort + cache raw reshape (T7,T9) ✓; app-side verdict reproducing today at default (T8) ✓; ingest decides app-side, quarantine-on-flag retained (T9) ✓; never-silently-clean preserved (T8 ScanFaultError, T6 panic-503) ✓; test stub raw (T10) ✓; per-engine timing → load harness (recorded in T6; the harness assertion is a follow-up within T10's gate). **Gap intentionally deferred to Slice B:** firm-scoped settings, treatment menu, access-path gating, UI — none appear here by design.

**Placeholder scan:** no TBD/TODO; every code step shows real code; commands exact. The one soft spot — the exact `heuristics::inspect` call name in T6 — the implementer confirms against `heuristics/mod.rs` (it is the existing structural-heuristic entry already called in today's `finish`).

**Type consistency:** `RawScanResult`/`RuleMatch`/`Tier`/`ClamFact`/`HeuristicFact` names match across Rust (`raw.rs`, `yara.rs`, `forge.rs`) and TS (`scan-port.ts`, `verdict.ts`); `computeVerdict`/`DEFAULT_SCAN_POLICY`/`ScanFaultError`/`tierRank`/`matchCounts` are consistent T8↔T9↔T10; `scan-flagged` is the single new quarantine reason T9↔consumer.
