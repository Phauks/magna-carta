---
worktree: C:/dev/magna-carta-worktrees/claude/laughing-newton-96fujl
area: Signing out — ending a session from inside the application, and auditing it
status: building
touches: apps/web/src/lib/auth/sign-out.ts, apps/web/src/lib/components/profile-menu.svelte, apps/api-worker/src/auth.ts, apps/api-worker/test/auth-audit.test.ts, docs/user/features/signing-in.md, roadmap.d/auth.md, status.d/0-7b-auth-ui-deferred-surfaces.md, changelog.d
---

The profile menu's `Sign out` was the last inert control left over from before authentication
shipped: a session could be started and never ended from inside the application. This stream makes
it real — `$lib/auth/sign-out.ts` ends the session against Better Auth's own `/api/auth/sign-out`,
drops the state this session put in the browser, and leaves by a document load so nothing survives
into the next one — and gives the control-plane audit trail the `logout` event that was the missing
half of `login.success`.

Do not step on `apps/web/src/lib/components/profile-menu.svelte` (the Sign out item stops being a
Soon seam) or the `databaseHooks.session` block in `apps/api-worker/src/auth.ts` (a `delete` hook
is added beside the existing `create` one).
