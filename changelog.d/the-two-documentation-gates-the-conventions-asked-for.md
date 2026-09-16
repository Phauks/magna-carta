---
category: Added
audience: internal
---

**`lint:doc-links`, `lint:changelog-coverage` and `lint:active-work` — two gaps `documentation.md` named itself, and one rule held up by memory.**

**Dead links.** 1,734 relative links across 1,051 documents; every one now has to resolve, and an anchored link has to name a heading that exists (GitHub's real slug rules — punctuation deleted rather than replaced, emphasis unwrapped, duplicate numbering). External links stay out of scope: a gate must not depend on the network. Building it was mostly learning what a false positive looks like here — a decision fragment's prose is authored at three depths, because the same body lives at `docs/decisions/pending/`, at `docs/decisions/NNNN-`, and rendered into `docs/Decision-Log.md`, so a link is sound if it resolves from any home the prose actually has. That removed 65 of the first pass's 102 findings.

**The 37 that were real say something worth acting on.** Thirty are in numbered decision records and all have one cause: a link that was correct in the pending fragment climbs one directory too many when the assembler numbers the file, so `../conventions/invariants.md` lands at the repository root. The repair belongs in the assembler as a link rewrite on promotion, not in thirty files. Three more are in `CHANGELOG.md` and genuinely dead — `apps/worker` became `apps/api-worker`, `ci.yml` became `gate.yml`, a fixture baseline is gone. One spec points at a design that was deleted rather than moved. One was unambiguous and is fixed in place; the rest are a register that only shrinks.

**Changelog coverage.** A change touching `apps/`, `packages/`, `crates/` or `containers/` source brings a fragment. The carve-outs are a positive list, not a negative one, so a new directory is silent by default and must be added deliberately. Tests are deliberately in scope — they are the largest class of small change, and carving them out would leave the floor holding almost nothing. `tooling/` and `.github/` are out: the custom of changelogging them is worth keeping, but a gate firing on every lint tweak gets routed around in a week. **The gate holds the floor; the custom holds the ceiling.** Manifests and lockfiles are named in the source as the real remaining hole rather than hidden. On `main` and in the merge queue it stands down and prints why, rather than passing silently.

The escape hatch is `changelog.d/exemptions/<slug>.md` with a `reason:` in words — in the diff, where a reviewer reads the claim beside the change it excuses, and counted only as part of that change.

**The stream registry.** Every note under `docs/active-work/` has to sit at a branch-shaped path and carry the four keys the registry reads, with a status from the documented set. `vp run worktrees` only warned, and the root `CLAUDE.md` compensated by telling people to remember to run it. One note declared a status the registry does not document, which is exactly the shape that makes a note invisible.
