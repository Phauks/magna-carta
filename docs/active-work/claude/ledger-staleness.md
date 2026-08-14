# claude/ledger-staleness

**Scope.** Design, and build if the design survives scrutiny, a staleness detector for the
`roadmap.d/` feature ledger: a fitness function that compares the ledger against the **repository**,
where `pnpm run lint:roadmap` today compares only the rendered documents against the ledger.

Prompted by two nodes found stale by a person reading rather than by a check —
`discovery.search` / `discovery.search.keyword` reading `designed` after the search engine shipped
(#234), and the `communications.email.filing.auto-file-rules` notes describing a state that ended
two slices earlier (fixed 2026-08-14).

**Files I expect to touch**

- `docs/specs/2026-08-14-feature-ledger-staleness-detection.md` (new — the design)
- `tooling/lint-ledger-staleness/` (new — the scan and its fixture test)
- `tooling/doc-fragments/roadmap.mjs` (small: surface the `evidence` / `spec` / `adrs` fields the
  parser currently drops; no change to parse or render behaviour)
- `package.json` (one `lint:ledger-staleness` script)
- `.github/workflows/gate.yml` (one line in the existing Governance step)
- `roadmap.d/financial.md`, `roadmap.d/notifications.md` (ledger corrections the scan finds)
- `docs/now.md` (regenerated via `vp run register-build`, never hand-edited)
- `changelog.d/`, `docs/decisions/pending/` (fragments)

**Overlap watch.** `roadmap.d/*` and `docs/now.md` are shared surfaces. I touch two area files and
regenerate the register; anything else editing the ledger should sync before I merge.
