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

## Fragment format (validated by the gate)

The register bullet is built entirely from the frontmatter plus one line of text, so the shape is
enforced rather than assumed. Check any time with **`pnpm run lint:decisions`**; the gate's
governance dimension and the pre-push hook run the same check on every change, and
`vp run decisions-build` refuses to number anything while a fragment is malformed.

- The file **opens with the `---` frontmatter fence** — not with a Markdown title. A title where the
  frontmatter belongs is the one shape that used to render a blank register entry.
- Only the keys `slug`, `status`, `area`, `date`, `summary` (and `number`, which the assembler
  writes) are recognized; anything else is an error rather than a silently ignored line.
- `slug`, `status`, and `area` are required. `status` begins with a lifecycle word — `Proposed`,
  `Accepted`, `Superseded`, `Deprecated`, `Rejected` — and may carry a qualifier after it
  (`Superseded by ADR-NNNN`, `Accepted (amended YYYY-MM-DD)`); quote the value if it contains a
  character that reads as punctuation.
- `date`, when given, is `YYYY-MM-DD`.
- The register line ends with `summary` when present, otherwise the body's **first line** — so give
  the fragment a `summary:`, or open the body with the decision itself. A body that opens with a
  Markdown heading is rejected, because the heading would be printed as the decision.
