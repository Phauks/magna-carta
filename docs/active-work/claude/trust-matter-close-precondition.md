---
branch: claude/trust-matter-close-precondition
worktree: .claude/worktrees/agent-a94789beabcf61ed1
area: Trust — the zero-balance matter-close precondition, the close hook's first consumer
status: building
touches: packages/matters/src/close-preconditions.ts, packages/matters/src/matter-service.ts, packages/matters/test/matter-service.test.ts, packages/trust/src/close-precondition.ts, packages/trust/src/statements.ts, packages/trust/src/fitness.ts, packages/trust/test/, packages/trust/package.json, apps/worker/src/routes/matters.ts, apps/worker/src/contracts/problem-types.ts, apps/worker/test/contracts/problem.test.ts, apps/worker/test/matter-close-trust.test.ts, apps/worker/openapi/openapi.json, packages/api-client/src/ (regenerated), changelog.d/trust-matter-close-precondition.md, docs/decisions/pending/trust-matter-close-precondition.md, status.d/3-2-trust-accounting-jurisdiction-compliance.md
---

The matter shell's close hook has been in place, and empty, since the matter lifecycle landed; the
movement surface a close gate would have to read landed with the trust movements. This stream fills
it: a matter whose client trust ledger still holds money, or carries an active disputed-funds hold,
does not close.

Scope: the hook becomes an object with a `check` and an optional `commitGuard`, and the rules are
supplied by the composition root rather than imported by the matter shell — `@magna-carta/matters`
still knows nothing about money. `@magna-carta/trust` gains the rule itself: the read that names the
balance, where it sits, and the movements that clear it, and the guard statement that re-asks the
same question inside the close batch so a deposit landing between the check and the commit aborts
the close rather than slipping under it. No migration, no new permission, no override path.

Contract: the close operation's description and its 409 description change, so the OpenAPI snapshot
and `@magna-carta/api-client` are regenerated. `claude/email-add-in-client-api` also moves the
contract — whichever merges second needs a regeneration, nothing more.
