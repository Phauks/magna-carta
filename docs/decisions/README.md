# Decisions (ADRs)

One file per ADR — the canonical home for each decision. The register in
[`../Decision-Log.md`](../Decision-Log.md) is generated from these files; do not edit it by hand.

## Adding a decision

1. On your branch, create `pending/<slug>.md` (no number yet) using the frontmatter keys
   `slug`, `status`, `area`, `date`, optional `summary`, then the body. Reference it from other
   docs as `ADR-<slug>` until it is numbered.
2. After your branch merges to `main`, run `vp run decisions-build`. It assigns the next
   contiguous number, renames the file to `NNNN-<slug>.md`, rewrites `ADR-<slug>` references to
   the assigned `ADR-NNNN`, and regenerates the register. Commit the result.
