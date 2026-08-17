---
category: Changed
audience: internal
---

**The build register's web page is rendered from the feature ledger instead of hand-authored.** The
register has always had two readers: `docs/now.md` for anyone in the repository, and a self-contained
page for the owner, who reads it as a page rather than as a file. Only the first was generated. The
page was 350 KB of hand-written HTML carrying the same facts, so every merge that flipped a ledger
node left it wrong, refreshing it meant a person re-authoring it, and in practice it ran several
merges behind — one source of truth with one generated rendering and one copy of it.

`tooling/doc-fragments/register-artifact.mjs` now emits that page from the same `areas` structure the
Markdown renderer takes — a pure function, no filesystem, no clock — and `vp run register-build`
writes `docs/now.html` beside `docs/now.md` in the same run, the way `status-build` writes
`STATUS.md` and `STATUS.json`. One command refreshes both, deliberately: two renderings refreshed by
two commands are two renderings that disagree the first time somebody runs one of them.

`pnpm run lint:roadmap` now re-derives and diff-gates the page exactly as it does the document, so
the published page cannot silently fall behind the ledger either. The counts are not recomputed for
it: `roadmap.mjs` exports `countByStatus`, `share` and `STATUSES_WITH_NOTHING_BUILT`, and both
renderings count with those, because a percentage that differs between two views of one ledger is a
defect neither view can be blamed for. Node text is escaped for markup and nothing else — no ledger
value ever reaches an attribute. The design of the page is unchanged from the hand-authored one it
replaces, down to the token names and the two dark-theme definitions.
