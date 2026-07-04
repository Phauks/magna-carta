# Decryption Slice 2, Plan 1 of 2 — recovery engine + container

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the recovery _muscle_: extend `crates/decryption-core` with a best64 rule engine, keyspace-shard helpers, a per-shard recovery runner, and a format→tier classifier; then a `recovery` Rust container (HTTP server over the baked wordlists) and its `apps/recovery-worker` Cloudflare Container app. After this plan, a single shard can be cracked end-to-end; Plan 2 adds the DO coordinator + Queue + routes that fan out across shards.

**Architecture:** `decryption-core` gains pure, testable recovery primitives (rules, sharding, `recover_shard`, `recovery_tier`). A standalone `recovery` bin crate depends on `decryption-core`, bakes the clean-license wordlists (NCSC-100k, 10k-common, best64) into its image, and exposes `POST /recover-shard` (loads its wordlist range, runs `recover_shard`, returns found/exhausted + count) + `GET /ready`. `apps/recovery-worker` wraps it as a Container (mirrors `apps/scan-worker`). The document never reaches the container — only the extracted hash string does.

**Tech Stack:** Rust (`decryption-core` + a new `recovery` bin crate), `axum` for the container HTTP server (match `containers/scan`), `rayon` (native), a multi-stage Dockerfile (mirror `containers/scan/Dockerfile`), `@cloudflare/containers` (`Container` class) for the worker app.

## Global Constraints

- **Pure Rust, no new C dependency** (golden rule 14). The container is native Rust (not wasm — rayon is fine here). Reuse `decryption-core`'s existing crypto.
- **Full names, no shorthand** (golden rule 12): `recover_shard`, `recovery_tier`, `RecoveryTier`, `best64`, `apply_rule`. No `rec`/`wl`/`kw`.
- **No process-doc references in source** (golden rule 13): explain _why_ inline; no "slice/plan/ADR" in `.rs`/config (a forward-looking "the GPU rung adapter plugs in here" note is allowed).
- **Confidentiality:** the container receives only the **hash string + params** (a `RecoveryJob`), never the file. `enableInternet = false` on the container (no egress; untrusted hash in, no data out except the result).
- **Wordlist policy** (parent design §8): bundle only clean-license assets — **NCSC-100k (OGL v3.0, with a NOTICES attribution file), `10k-most-common` (MIT), `best64.rule` (MIT, ships with hashcat)**. No breach dumps. Check the files into `containers/recovery/wordlists/` (≈1 MB total) — deterministic, no build-time network.
- **Gate per task:** Rust → `cargo test -p decryption-core` (or `-p recovery`) + `cargo clippy … -D warnings` + `cargo fmt … --check`. Container/worker config → `pnpm check` for the new package (ignore pre-existing local-prettier churn on files you didn't touch — never stage it; never `git add -A`).
- **Commit hygiene:** `git add` only the files a task changes.

---

### Task 1: `decryption-core` — best64 rule engine

**Files:** Create `crates/decryption-core/src/rules.rs`; create `crates/decryption-core/tests/fixtures/best64.rule` (the canonical hashcat best64 rule file, MIT — copy verbatim from hashcat's `rules/best64.rule`); modify `src/lib.rs` (`mod rules; pub use`).

**Interfaces:**

- Produces: `struct RuleSet(Vec<Rule>)`; `fn parse_rules(text: &str) -> Result<RuleSet, RuleError>`; `fn apply_rule(rule: &Rule, word: &str) -> Option<String>`; `fn expand(word: &str, rules: &RuleSet) -> impl Iterator<Item = String>` (the word transformed by each rule, skipping rules that don't apply). Supports the hashcat rule ops used in best64: `:` (noop), `l u c C t r d f {` `}` `[` `]`, `$X` (append), `^X` (prepend), `sXY` (substitute), `T N` (toggle-case at N), `p`/`pN` (dup), `z`/`Z` (dup first/last), and the numeric-position ops best64 uses. (Read best64.rule and support exactly the ops it contains.)

- [ ] **Step 1: write failing tests** — known hashcat rule→word vectors (verify against the hashcat rule-syntax reference):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn applies_core_ops() {
        assert_eq!(apply_rule(&Rule::parse(":").unwrap(), "Pass"), Some("Pass".into()));   // noop
        assert_eq!(apply_rule(&Rule::parse("l").unwrap(), "Pass"), Some("pass".into()));    // lowercase
        assert_eq!(apply_rule(&Rule::parse("u").unwrap(), "Pass"), Some("PASS".into()));    // uppercase
        assert_eq!(apply_rule(&Rule::parse("c").unwrap(), "pass"), Some("Pass".into()));    // capitalize
        assert_eq!(apply_rule(&Rule::parse("$1").unwrap(), "pass"), Some("pass1".into()));  // append '1'
        assert_eq!(apply_rule(&Rule::parse("^!").unwrap(), "pass"), Some("!pass".into()));  // prepend '!'
        assert_eq!(apply_rule(&Rule::parse("r").unwrap(), "pass"), Some("ssap".into()));    // reverse
        assert_eq!(apply_rule(&Rule::parse("d").unwrap(), "pa"), Some("papa".into()));      // duplicate
        assert_eq!(apply_rule(&Rule::parse("$1$2$3").unwrap(), "p"), Some("p123".into()));  // chained
    }
    #[test]
    fn parses_best64_file_fully() {
        let text = include_str!("../tests/fixtures/best64.rule");
        let set = parse_rules(text).expect("best64 parses");
        assert!(set.0.len() >= 60, "best64 has ~64 rules");   // comments/blanks skipped
        // every rule applies to a sample word without panicking
        for r in &set.0 { let _ = apply_rule(r, "Password1"); }
    }
}
```

- [ ] **Step 2: run → fail.** `cd crates && cargo test -p decryption-core rules`
- [ ] **Step 3: implement `rules.rs`** — a `Rule` is a sequence of ops; `parse_rules` splits on lines (skip `#` comments + blanks), tokenizes each line into ops; `apply_rule` folds the ops over the word (each op a small pure string transform; an op that can't apply — e.g. a position past end — makes the rule yield `None` per hashcat "rejected" semantics). Implement exactly the ops present in best64.rule. Guard all indexing (never panic on any input/word).
- [ ] **Step 4: run → pass.** Wire `mod rules; pub use rules::{RuleSet, parse_rules, apply_rule, expand, RuleError};` into `lib.rs` (cfg-gate to non-wasm if rules pulls anything wasm-incompatible — it shouldn't; it's pure string ops, so it can stay unconditional).
- [ ] **Step 5: gate + commit** (`rules.rs`, `best64.rule`, `lib.rs`): `feat(decryption): best64 hashcat rule engine`

---

### Task 2: `decryption-core` — keyspace sharding helper

**Files:** Create `crates/decryption-core/src/shard.rs`; modify `src/lib.rs`.

**Interfaces:**

- Consumes: `RuleSet` (Task 1).
- Produces: `struct ShardSpec { pub word_start: usize, pub word_end: usize }` (a half-open wordlist range); `fn split_keyspace(word_count: usize, shard_count: usize) -> Vec<ShardSpec>` (contiguous, near-even, covering `0..word_count` with no gaps/overlap); `fn shard_candidate_count(spec: &ShardSpec, rules: &RuleSet) -> usize` (= `(word_end - word_start) * rules.len()`).

- [ ] **Step 1: failing test**

```rust
#[test]
fn split_is_complete_and_disjoint() {
    let shards = split_keyspace(100, 8);
    assert_eq!(shards.first().unwrap().word_start, 0);
    assert_eq!(shards.last().unwrap().word_end, 100);
    // contiguous, no gap/overlap
    for pair in shards.windows(2) { assert_eq!(pair[0].word_end, pair[1].word_start); }
    let total: usize = shards.iter().map(|s| s.word_end - s.word_start).sum();
    assert_eq!(total, 100);
}
#[test]
fn handles_fewer_words_than_shards() {
    let shards = split_keyspace(3, 8); // never an empty middle shard that breaks coverage
    let total: usize = shards.iter().map(|s| s.word_end - s.word_start).sum();
    assert_eq!(total, 3);
}
```

- [ ] **Step 2: run → fail.** **Step 3: implement** even contiguous split (handle `word_count < shard_count` and `shard_count == 0` → one shard). **Step 4: run → pass** + wire into lib.rs. **Step 5: commit** `feat(decryption): keyspace shard split helper`

---

### Task 3: `decryption-core` — `recover_shard`

**Files:** Modify `crates/decryption-core/src/dictionary.rs` (or a new `src/recover.rs`); modify `src/lib.rs`.

**Interfaces:**

- Consumes: `RecoveryJob`, `verify` (the format dispatch, Plan-1 Task 10), `RuleSet`/`expand` (Task 1), `ShardSpec` (Task 2).
- Produces: `fn recover_shard(job: &RecoveryJob, words: &[String], spec: &ShardSpec, rules: &RuleSet) -> ShardOutcome` where `struct ShardOutcome { pub found: Option<String>, pub candidates_tried: usize }`. It iterates `words[spec.word_start..spec.word_end]`, expands each by `rules`, runs `verify(job, candidate)` (rayon-parallel, `find_any` to short-circuit on first hit), and returns the hit (or `None`) plus the count tried.

- [ ] **Step 1: failing test** (reuse a Plan-1 example-hash vector, password `"hashcat"`):

```rust
#[test]
fn finds_password_in_shard_via_rules() {
    let job = /* OOXML 9600 example-hash RecoveryJob, pw "hashcat" */;
    let words = vec!["foo".into(), "hashcat".into(), "bar".into()];
    let rules = parse_rules(":").unwrap(); // noop rule → words verbatim
    let out = recover_shard(&job, &words, &ShardSpec{word_start:0, word_end:3}, &rules);
    assert_eq!(out.found.as_deref(), Some("hashcat"));
    assert!(out.candidates_tried >= 1);
}
#[test]
fn shard_range_is_respected() {
    let job = /* same */;
    let words = vec!["hashcat".into(), "foo".into()];
    let rules = parse_rules(":").unwrap();
    // shard covering only index 1..2 must NOT find "hashcat" at index 0
    let out = recover_shard(&job, &words, &ShardSpec{word_start:1, word_end:2}, &rules);
    assert_eq!(out.found, None);
}
```

- [ ] **Step 2: run → fail. Step 3: implement** (rayon over the word range; for each word, `expand` then `verify`; `find_any`; count). Keep it `#[cfg(not(target_arch="wasm32"))]` (rayon, native-only — same gate as `dictionary`). **Step 4: run → pass** + lib.rs export. **Step 5: commit** `feat(decryption): recover_shard (wordlist-range × rules verify loop)`

---

### Task 4: `decryption-core` — `recovery_tier` classifier

**Files:** Create `crates/decryption-core/src/tier.rs`; modify `src/lib.rs`; modify `src/wasm.rs` (expose `recoveryTier`); modify `packages/decryption/src/index.ts` (+ a wrapper test).

**Interfaces:**

- Produces: `enum RecoveryTier { CfCapable, GpuRequired }`; `fn recovery_tier(format: Format, hashcat_mode: u32) -> RecoveryTier`. CfCapable = fast/medium modes (legacy PDF RC4 10400/10500, ZipCrypto 17200-range, old Office 9700/9800, WinZip-AES 13600). GpuRequired = slow KDFs (PDF R6 10700, OOXML agile 9400/9500/9600, 7-Zip 11600). Wasm/TS: `recoveryTier(format: string, hashcatMode: number): "cfCapable" | "gpuRequired"`.

- [ ] **Step 1: failing tests** (Rust + the wrapper):

```rust
#[test]
fn classifies_by_mode() {
    assert_eq!(recovery_tier(Format::Pdf, 10500), RecoveryTier::CfCapable);   // RC4
    assert_eq!(recovery_tier(Format::Pdf, 10700), RecoveryTier::GpuRequired); // R6
    assert_eq!(recovery_tier(Format::Zip, 13600), RecoveryTier::CfCapable);   // WinZip-AES
    assert_eq!(recovery_tier(Format::Ooxml, 9600), RecoveryTier::GpuRequired);// agile
}
```

- [ ] **Step 2-4:** implement (a match on mode/format), expose via `wasm.rs` (`#[wasm_bindgen(js_name = recoveryTier)]` returning the camelCase string), add `recoveryTier(...)` to `packages/decryption/src/index.ts` with a wrapper test asserting PDF-R6→`gpuRequired`, ZipCrypto→`cfCapable`. Rebuild wasm (`wasm-pack build …`) so the wrapper sees the new export. **Step 5: commit** `feat(decryption): recovery_tier format classifier (+ wasm/TS)`

---

### Task 5: `recovery` bin crate — engine + HTTP server

**Files:** Create `containers/recovery/Cargo.toml` (a bin crate, `decryption-core` as a `path` dep), `containers/recovery/src/main.rs`, `containers/recovery/src/server.rs`. (Model on `containers/scan`'s crate layout — read it.)

**Interfaces:**

- HTTP: `GET /ready` → 200 `"ok"`. `POST /recover-shard` body `{ hash: string, format: string, hashcatMode: number, wordStart: number, wordEnd: number, ruleSet: "best64" | "none" }` → `{ found: string | null, candidatesTried: number }`. It loads the baked wordlist (path from an env var, default `/app/wordlists/ncsc-100k.txt`), reconstructs the `RecoveryJob` via `decryption-core` `parse_hash`(by format), selects the `RuleSet` (best64 from `/app/wordlists/best64.rule`, or noop), and calls `recover_shard`.

- [ ] **Step 1: failing test** (`containers/recovery/tests/shard.rs`, or a `#[cfg(test)]` over the server handler): a request with a small in-test wordlist file + a Plan-1 example hash whose password is in-list → `found` set; absent → null. (Use `axum`'s test harness like `containers/scan`.)
- [ ] **Step 2: run → fail. Step 3: implement** the axum server + the handler (parse body → load wordlist slice `[wordStart..wordEnd]` → `recover_shard` → JSON). Guard malformed body → 400; never panic on the untrusted hash. **Step 4: run → pass.** **Step 5: commit** `feat(recovery): recovery engine container HTTP server`

---

### Task 6: `containers/recovery` Dockerfile + bundled wordlists

**Files:** Create `containers/recovery/Dockerfile`, `containers/recovery/wordlists/ncsc-100k.txt`, `…/10k-most-common.txt`, `…/best64.rule`, `containers/recovery/wordlists/NOTICES.md` (OGL v3.0 attribution for NCSC; MIT for SecLists/best64).

- [ ] **Step 1:** obtain + check in the wordlists (NCSC Top-100k under OGL — record source + attribution in NOTICES.md; `10k-most-common` from SecLists MIT; `best64.rule` from hashcat MIT). Confirm sizes (~836KB / 73KB / few KB).
- [ ] **Step 2: write the Dockerfile** (multi-stage, mirror `containers/scan/Dockerfile`): build stage `cargo build --release` the `recovery` bin (with `decryption-core` via path — COPY the needed crates), runtime `debian:bookworm-slim`, `COPY --from=build … /usr/local/bin/recovery`, `COPY wordlists/ /app/wordlists/`, `EXPOSE 8080`, entrypoint runs `recovery`.
- [ ] **Step 3: verify** the image builds locally IF docker is available (`docker build containers/recovery` — note in the report if docker is absent in this env, like the scan/bundling containers; the build gate is then CI). At minimum `cargo build --release -p recovery` from the crate to prove the binary compiles.
- [ ] **Step 4: commit** (Dockerfile, wordlists, NOTICES): `feat(recovery): container image + bundled clean-license wordlists`

---

### Task 7: `apps/recovery-worker` Cloudflare Container app

**Files:** Create `apps/recovery-worker/wrangler.jsonc`, `apps/recovery-worker/src/index.ts`, `apps/recovery-worker/src/recovery-engine-container.ts`, `apps/recovery-worker/package.json`, `apps/recovery-worker/tsconfig.json`, `apps/recovery-worker/worker-env.d.ts`. (Mirror `apps/scan-worker` exactly — read it.)

**Interfaces:**

- Produces: a `RecoveryEngineContainer extends Container` (`defaultPort = 8080`, `requiredPorts=[8080]`, `pingEndpoint="ready"`, `enableInternet=false`, a `sleepAfter`); `wrangler.jsonc` declaring the container (`class_name: "RecoveryEngineContainer"`, `image: "../../containers/recovery/Dockerfile"`, `instance_type`, `max_instances`), the matching `durable_objects` binding + `migrations` `new_sqlite_classes`; `src/index.ts` forwarding `POST /recover-shard` to `getContainer(env.RECOVERY_ENGINE, "recovery")` and `GET /ready`.

- [ ] **Step 1:** scaffold the app mirroring `apps/scan-worker` (package.json, tsconfig, worker-env). **Step 2:** write `recovery-engine-container.ts` (the `Container` subclass) + `index.ts` (forward `/recover-shard` + `/ready` to the container; reject other routes 404; internal-only — no public route, the Plan-2 main worker reaches it via service binding). **Step 3:** `wrangler.jsonc` (container + DO + migrations + the service-binding name `RECOVERY_ENGINE`). **Step 4: verify** `pnpm check` for the new package typechecks; a vitest that `/ready` routes and `/recover-shard` forwards (mock the container, mirror scan-worker's test). **Step 5: commit** `feat(recovery): apps/recovery-worker Cloudflare Container app`

---

## Self-Review

**Spec coverage (Slice-2 design §3 CF pass, §4 coordinator backend, §5 container):**

- best64 rule engine (the "amplified by best64" depth) → Task 1. ✓
- keyspace sharding (the coordinator splits; this provides the split + per-shard run) → Tasks 2–3. ✓
- format→tier router classifier → Task 4. ✓
- `apps/recovery-worker` Container + bundled wordlists (hash-only, no file, no egress) → Tasks 5–7. ✓
- The DO coordinator + Queue + recover/status/cancel routes + fan-out + first-hit-cancel + OpenAPI/conformance + e2e are **Plan 2** (this plan builds the shard-level muscle they orchestrate). Stated, not a gap.

**Placeholder scan:** Task 3/5 test bodies reference "a Plan-1 example-hash `RecoveryJob`" — the implementer reuses the real hashcat example-hash consts already committed in `pdf.rs`/`zip_adapter.rs`/`ooxml.rs` tests (password `hashcat`); pull the exact string from there. The best64 rule ops list (Task 1) is the concrete op set to implement, verified against the checked-in `best64.rule` + the rule→word vectors. No "TODO"s.

**Type consistency:** `RecoveryJob`/`Format`/`verify`/`parse_hash` are Plan-1 types; `RuleSet`/`ShardSpec`/`ShardOutcome`/`RecoveryTier` are introduced here and used consistently across Tasks 1–5 and (Plan 2) the coordinator.

## Execution Handoff

Plan 1 of 2 for Slice 2. After it lands green, Plan 2 wires the `RecoveryJob` DO coordinator (keyspace-split via `split_keyspace`, fan-out to `apps/recovery-worker` via a recovery Queue, first-hit-cancel), the `recover`/status/`cancel` routes (with `recovery_tier` routing to CF vs `needs_gpu`), and OpenAPI/conformance/e2e.
