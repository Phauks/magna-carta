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
it: `roadmap.mjs` exports `countByStatus`, `share`, `STATUSES_WITH_NOTHING_BUILT` and
`AWAITING_BOUNDARY`, and both renderings use those. A percentage that differs between two views of
one ledger is a defect neither view can be blamed for, and the page had already drifted to its own
wording of the owner-list boundary — including an assertion that the Actions budget is exhausted,
which is a live operational state `docs/deploy-queue.md` owns and no ledger change could ever make
false again.

Three things the hand-authored page got away with do not survive being generated, because a wart in
one file is a wart and the same wart in a generator is a policy. Where `partial` ranks by size is
derived rather than typed, so the sentence cannot go on asserting "the second largest" after
something overtakes it — and it says "joint" instead of picking a winner when two statuses are level.
Inline code spans in `scope` and `notes` render as `<code>` instead of printing their own backticks.
And the boundary paragraph comes from the shared constant. The renderer handles exactly the two
Markdown constructs the ledger and that constant actually use, code spans and one link, and
deliberately no more: an unused branch is an untested branch, and anything else renders as its own
source characters, which reads as a bug rather than swallowing content silently.

The design of the page is otherwise unchanged from the hand-authored one it replaces, down to the
token names and the two dark-theme definitions.
