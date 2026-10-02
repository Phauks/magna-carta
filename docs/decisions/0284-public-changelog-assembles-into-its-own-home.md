---
number: 284
slug: public-changelog-assembles-into-its-own-home
status: Accepted
date: 2026-08-12
area: Product updates / Changelog
summary: "The customer-facing prose of a public changelog fragment is folded into `docs/public-changelog.md` in the SAME pass that folds its developer half into `CHANGELOG.md`, because the fragment is deleted when it is consumed and the `## Public` block lives nowhere else — a publish step deferred to later would silently destroy the prose it deferred. That gives the public changelog one assembled home, the exact sibling of `CHANGELOG.md`: never hand-edited on a branch, but unlike `CHANGELOG.md` it is CURATED on `main`, where a dated section that starts as one bullet per fragment may be edited into the thematic roll-up a reader wants. Curation is editing what was published, never authoring a change with no fragment behind it. The surface holds NO firm data of any kind and therefore sits outside the firm-scoped data-access rule by having no business data in play rather than by taking an exception to it — a distinction worth recording, because the two community surfaces that follow are cross-firm and will need a real exception argued on its own terms. A committed generated artifact was rejected: consumers build it from the document at their own build time, so it cannot drift and needs no gate."
---

**The public changelog gets one assembled Markdown home, written in the same pass as the developer
changelog, and no committed generated artifact.**

**Context:** The community-surfaces design settles that the public changelog renders from
`changelog.d/` rather than becoming a second thing to maintain, that a fragment declares a required
`audience`, and that a `public` fragment carries its customer-facing prose in a `## Public` block. It
also says public entries are curated roll-ups "authored at publish time from the accumulated public
blocks." What it does not say is **where the blocks accumulate** — and that turns out to be forced
rather than open, because of how the existing assembler works: `vp run changelog-build` folds a
fragment and then **deletes** it. The `## Public` block has no other store. Any design in which
publishing happens later than folding destroys the prose it means to publish.

**Decision:**

1. **One pass, two documents.** `vp run changelog-build` folds the developer entry into
   `CHANGELOG.md` and the `## Public` block into **`docs/public-changelog.md`** before deleting the
   fragment. The assembler validates the whole fragment set before consuming any of it, for the same
   reason the decisions assembler does: folding is destructive, so a bad fragment must be a clean
   no-op rather than a half-consumed assembly.

2. **`docs/public-changelog.md` is a build output, with one difference from `CHANGELOG.md`.** Both
   are assembled on `main` and neither is hand-edited on a branch. But the public document is
   **curated on `main`**: a dated section arrives as one bullet per published fragment and may be
   edited into a thematic roll-up, which is what a customer changelog should read like and what the
   reference product does. The line that keeps curation honest is that it edits what was published —
   it never authors a change with no fragment behind it.

3. **Dated sections, one per day, newest first.** A second assembly on the same day appends to that
   day's section rather than opening a duplicate. The parser refuses two sections for one date,
   because a reader shown the same day twice cannot tell which is current.

4. **No committed generated artifact, and deliberately no drift gate.** `@magna-carta/product-updates`
   exports the schema and a strict parser; a consumer builds the artifact from the document at its
   own build time. A checked-in `public-changelog.json` would be a second home for the same fact and
   would need a gate to hold it there — the cost of the gate buys nothing that calling a pure
   function does not already give.

5. **The parser is strict and reports every problem at once.** A mistyped category heading, a bullet
   above the first dated heading, an unparseable release heading, or a duplicate date fails the
   build. The failure being guarded is **silent omission** — a shipped change dropping out of the
   published changelog with nothing raised — which is the same failure mode the decision register was
   hardened against, and it is worse here because the audience is outside the firm.

**On tenancy, recorded deliberately.** This surface holds **no firm data of any kind**: one document,
read identically by every reader, with no firm identifier anywhere in the schema and no binding in
the package. It therefore sits outside the firm-scoped data-access rule **by having no business data
in play, not by taking an exception to it.** The distinction is worth writing down rather than
leaving to be inferred, because the two community surfaces that follow this one — the request board
and the question board — are genuinely cross-firm, and they will need an exception argued on its own
terms against the tenancy invariants. Nothing about the ease of this slice should be read as a
precedent for those.

**Considered & rejected:** **A `changelog.d/public/` accumulation directory** (two directories to keep
in step, and the fragment's two halves would live in two files with two review surfaces — the thing
the one-file `## Public` block exists to avoid); **publishing at a later, separate step** (there is
nothing left to publish: the fragment is gone); **one dated entry file per published fragment** (a
directory of hundreds of one-bullet files, and curation into roll-ups would mean merging files rather
than editing prose); **a committed `public-changelog.json` with a drift gate** (a second home and a
gate to hold it, buying nothing over a pure function); **making the parser lenient** (a shorter
artifact that omits a shipped change is exactly the failure this surface cannot have); **putting the
artifact schema in `@magna-carta/community`** (that package is the board — control-plane data,
cross-firm, its own worker; the changelog shares none of that and would inherit a boundary it does
not need). Extends the product-updates decision (the bundled artifact and version-accuracy by
construction are unchanged) and implements the public-changelog audience-and-source decision. Spec:
[`docs/specs/2026-08-11-community-surfaces-design.md`](../../specs/2026-08-11-community-surfaces-design.md).
