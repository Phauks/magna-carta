# claude/discovery-5-1-1

**Scope.** Build sub-slice 5·1·1 of the discovery 5·1 plan — **the Rust discovery core and nothing
else**. Buildable and fully testable with no Cloudflare, no database, and no worker, and first
because everything downstream consumes it and it carries the most unknowns. Six tasks: the crate
scaffold on the engine-host seam, format identification from bytes, the determinism boundary
(normalization + the moved passage chunker + the five-algorithm digest + the near-duplicate
fingerprint), the native extractors with their hostile-input pass, guarded archive enumeration and
expansion, and the container host.

Plus one small reconciliation carried by this stream: the pending decision record's key-shape wording
for the corpus index scope key, which shipped without the kind segment.

**Owner-flag accounting.** 5·1·1 depends on **D2** (expand archives inside the discovery load path,
under five guards) and on nothing else — every other owner flag gates a later sub-slice. D2 is built
to its recommendation. D1, D5, D7, and D8 are the review-set model's, and land with 5·1·2 and 5·1·3.

**What this stream does NOT touch,** because the plan puts it in a later sub-slice: no per-firm
migration, no schema, no identifier prefixes, no permissions, no OpenAPI route, no api-client
regeneration, no user guide. There is no user-facing surface in a Rust engine.

**Files this stream expects to touch.**

- `crates/discovery-core/` (new crate, its `CLAUDE.md`, and `crates/Cargo.toml` + `crates/Cargo.lock`)
- `containers/discovery/` (new container host and its `CLAUDE.md`)
- `apps/discovery-worker/` (new standalone container worker)
- `tooling/lint-custodian-vocabulary.mjs` (new), `package.json` (one script line)
- `vite.config.ts` (the new vitest project), `.github/workflows/gate.yml` +
  `tooling/lint-test-collection.mjs` (the new project in the test-node job, kept byte-identical)
- `tsconfig.build.json` and `apps/discovery-worker/tsconfig.build.json` (regenerated)
- `docs/decisions/pending/discovery-review-set-model-and-processing-pipeline.md` (wording only)
- `roadmap.d/discovery.md`, `status.d/5-1-discovery-ingest-and-processing.md`,
  `status.d/_sections.md` (the phase-5 heading), `changelog.d/discovery-5-1-1.md`

**Overlaps to watch.** `vite.config.ts`, `.github/workflows/gate.yml`, `package.json`, and
`status.d/_sections.md` are cross-cutting; each edit here is one line or one block, appended rather
than restructured. `.github/workflows/gate.yml` is also declared by `claude/gate-collection-audit`
and `claude/lint-dependency-fanout` — this stream adds one project to the `test-node` job's path list
(and the byte-identical copy of that command in `tooling/lint-test-collection.mjs`) plus one line to
the governance step, so a conflict there resolves by keeping both edits. `claude/composite-text-extraction`
declares `apps/worker/src/search/`, which is where the composite extraction port that will call this
engine lands; this stream touches nothing under `apps/worker`. An assets stream is in flight taking
the next migration tag — this stream takes no migration tag at all, so there is nothing to retag.
