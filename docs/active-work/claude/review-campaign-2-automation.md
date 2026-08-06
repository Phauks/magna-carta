# claude/review-campaign-2-automation

**Type:** review stream (read-only over source; docs-only deliverable).

**Scope.** Adversarial review of the automation / email / extraction code merged since the
first review campaign:

- `packages/document-assembly/` — expression language + aggregates, custom-field bindings,
  directory role sources, protected-value bindings, letterhead image emission, and the
  subject-by-facet catalog registry.
- The email add-in client API routes — matter suggestions, capture status, filing context.
- `packages/email-filing/src/auto-file-rules.ts`, its statements, and consumer wiring.
- The DKIM verifier.
- Composite text extraction — the worker adapter and the pdf-core textextract seam
  (TypeScript side reviewed; the Rust file reviewed by reading, not by running cargo).
- The load-profile fixtures covering these areas.

**Files this stream writes.** Only two, both new:

- `docs/reviews/2026-08-06-campaign-2-automation.md`
- `changelog.d/review-campaign-2-automation.md`

No source file is edited by this stream, so it cannot collide with a builder worktree.

**Not run.** No test suites — sibling builder worktrees own the CPU. Only
`pnpm run lint:process-refs`.
