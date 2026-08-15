---
branch: claude/stub-masked-wiring
worktree: .claude/worktrees/stub-masked-wiring
area: sweep of every injection seam where a test double stands in for a production placeholder
status: review
touches: apps/worker/src/files/container-scan-adapter.ts, apps/worker/src/routes/scan-diagnose.ts, apps/worker/CLAUDE.md, apps/worker/openapi/openapi.json, packages/api-client, docs/conventions/testing.md
---

# claude/stub-masked-wiring

**Scope.** The class the shipping credential-store defect belonged to, swept: every injection seam
in the worker's composition root, checked for what **production** supplies rather than what a test
supplies. Seventeen seams examined, each exercised against `createApp()` with no overrides. One
further dishonest failure found and fixed (the scan diagnostic answering `500` where the engine is
wired but unreachable), and one rule added to the testing standard so the composition root is a
thing tests are required to have looked at.

**Files expected to touch**

- `apps/worker/src/files/container-scan-adapter.ts` — a 5xx from the scan service throws the typed
  `ScanFaultError` instead of a bare `Error`; a 4xx keeps the plain throw
- `apps/worker/src/routes/scan-diagnose.ts` — maps `ScanFaultError` to a `503`, declares it, and the
  description no longer promises an `unscanned` verdict for a state that cannot produce one
- `apps/worker/test/scan-unreachable-engine-seam.test.ts` (new) — the production wiring with a
  placeholder scan service bound, and the distinct engine-less case beside it
- `apps/worker/test/container-scan-adapter.test.ts` — pins the 5xx/4xx split
- `apps/worker/openapi/openapi.json` + `packages/api-client/src/` — both generated
- `apps/worker/CLAUDE.md` — the scan wiring's three states, and a correction: the test pool binds
  a stub, so `resolveScanPort` does **not** fall back to the engine-less adapter in tests
- `docs/conventions/testing.md` — the injected-dependency rule
- `changelog.d/` — fragment only

**Not touched.** The ingest consumer and its retry behaviour (a queued file with an unreachable
engine must still retry, and does — nothing about the verdict layer changed). The scan policy, the
verdict precedence, the engine itself. No new problem type: the refusal reuses the registered
`service-unavailable` key, which is the same one the sibling file-type route already answers on the
identical condition.

**Overlap watch.** `docs/conventions/testing.md` is the one cross-cutting file; `vp run worktrees`
shows no other stream declaring it. The generated `openapi.json` and `packages/api-client` move
because one route declares a new response. Nothing here edits `CLAUDE.md`, `STATUS.md`,
`ROADMAP.md`, the white paper, or `roadmap.d/`.
