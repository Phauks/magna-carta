---
branch: claude/green-main-batch
worktree: .claude/worktrees/agent-a6cb806ebfadb567e
area: gate repair — new dependency advisories, the catalog contract's group registry, whole-repo format debt
status: building
touches: osv-scanner.toml, pnpm-workspace.yaml, pnpm-lock.yaml, crates/discovery-core/Cargo.toml, crates/Cargo.lock, containers/discovery/Cargo.lock, packages/merge-field-catalog-contract/src/types.ts, packages/database/drizzle/per-firm/meta/, docs/specs/2026-08-05-matter-assets-implementation-plan.md, docs/specs/2026-08-06-notifications-delivery-implementation-plan.md, docs/active-work/, changelog.d/
---

The first full gate run on `main` after the budget restore failed three jobs and nothing else.
This stream fixes exactly those three and adds no behaviour.

## Scope

**Governance — the dependency audit.** Three new HIGH advisories after ignores, all remediated by
version rather than accepted:

- `quick-xml` RUSTSEC-2026-0194 (quadratic duplicate-attribute check) and RUSTSEC-2026-0195
  (unbounded namespace-declaration allocation). The carrier is now `crates/discovery-core`, which
  takes quick-xml directly for its OOXML and OpenDocument text walk — a different carrier from the
  `office-crypto` one that the earlier acceptance named and that was already replaced. Both
  advisories are fixed in 0.41.0, so the dependency moves 0.38 to 0.41 and no ignore entry is
  needed. `osv-scanner.toml`'s tracked-advisory note is corrected: it claimed no quick-xml is left
  in the tree, which stopped being true when the discovery core landed.
- `js-yaml` GHSA-5p4m-2wfm-xmqj (quadratic `!!omap` key-uniqueness scan). Both existing
  major-scoped overrides move to the backport releases — 3.15.0 to 3.15.1 and 4.3.0 to 4.3.1.

**test-node shard 1 — the merge-field catalog contract.** The engine's group registry gained an
`assets` heading; the contract's mirror of it did not, and the pinning assertion caught the drift
exactly as designed. One row added to `MERGE_FIELD_GROUPS` in the contract.

**format — whole-repo `fmt`.** Fourteen files. Eight generated Drizzle snapshots under
`packages/database/drizzle/per-firm/meta/` (reformatted, JSON verified semantically identical),
four ordinary markdown files, and two implementation plans whose line-wrapped inline code spans
made the markdown formatter non-idempotent — those two are rewrapped by hand so no inline code
span crosses a line break, which is the stable form.

## Files this stream does not own

`docs/active-work/claude/index-scope-key-widening.md` and
`docs/active-work/claude/passive-dev-orchestrator-m7f9jw.md` belong to other streams and are
touched for formatting only — no prose change. Same for the two implementation plans, whose
rewrapping preserves every word.

## Deliberately not fixed

`containers/discovery/Cargo.lock` is not in the audit job's `-L` list, though every other container
lockfile is. Its quick-xml is upgraded here for hygiene, but adding the lockfile to the scan is a
scope widening that could surface unrelated advisories, so it stays a separate decision.
