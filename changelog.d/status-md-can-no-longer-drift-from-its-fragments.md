---
category: Fixed
audience: internal
---

`STATUS.md` had drifted from the fragments it is rendered from, and nothing could tell. `pnpm run lint:status` validated the `status.d/` fragments — malformed frontmatter, two slices claiming one slot, a link pointing nowhere — and then never re-derived the document. Valid fragments and a current render are different claims, and only the first was being checked.

The gap has a specific shape. The assembler runs on `main` after a merge, so a branch that lands a fragment change without it leaves the rendered table stating the stage a slice was at **before** the work, indefinitely. The financial-reporting slice was sitting at `built: todo` in `STATUS.md` while its own fragment said the build was under way and the pack had already merged.

`lint:status` now re-derives `STATUS.md` and `STATUS.json` from the fragments and diffs them against what is committed — the same gate `lint:roadmap` has always held over `docs/now.md`, over the other generated tracker. It runs only once every fragment has parsed and the set has validated, because a partial set renders a shorter document and would be reported as drift rather than as the parse failure it is.

The drift it caught on the way in was thirty lines of `STATUS.md` and forty-one of `STATUS.json`.
