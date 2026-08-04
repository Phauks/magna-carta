---
branch: claude/telemetry-sweep-ledger
worktree: .claude/worktrees/agent-ab8f929b299416a02
area: Record the fix campaign against the whole-program-review verification ledger, and sweep the telemetry/fitness and doc-lint hygiene items
status: review
touches: docs/research/2026-07-01-fable-whole-program-review-verification.md, packages/telemetry, packages/identifiers/test/registry.test.ts, packages/directory/CLAUDE.md, packages/directory/src/normalize-name.ts, apps/magna-carta-edit/src/document-editor-container.ts
---

# claude/telemetry-sweep-ledger

**Scope:** Two-part hygiene pass, no behaviour change.

1. **Ledger bookkeeping.** The verification ledger
   (`docs/research/2026-07-01-fable-whole-program-review-verification.md`) is the living status file
   for the 173 review findings, and every row still read `unverified` even though a full day of fix
   work had landed. 64 rows now carry a verdict and evidence naming the pull request, the merge
   commit, and the date. The frozen snapshot beside it is untouched. The ledger's own status
   vocabulary is kept: a partly-remediated finding stays `still-open` with its evidence opening
   `PARTIAL —`, so the `still-open` set remains exactly the backlog.

2. **Telemetry / fitness / doc-lint sweep.** The console ban now enumerates every `apps/*/src` root
   instead of naming `apps/worker`, so the extracted workers are inside the one-logging-path rule;
   four telemetry comments, one test name, one edit-worker comment, and the Directory area guide were
   corrected where they cited a process artifact or a symbol that does not exist.

**Status:** Built and tested. `packages/telemetry`, `packages/identifiers`, `packages/directory`,
`apps/magna-carta-edit`, and `apps/bundle-worker` suites green; `pnpm run lint:process-refs` green.
Awaiting review.

**Note for concurrent streams:** the ledger file is append-in-place per row keyed by finding id — if
another stream verifies rows, merge by row rather than by hunk. The console-ban widening changes what
CI enforces for every app: a worker app that reaches for `console.*` now fails the telemetry package's
suite, and the fix is the telemetry Logger, not a new allowlist entry.
