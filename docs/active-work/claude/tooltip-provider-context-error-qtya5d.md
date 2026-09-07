---
worktree: C:/dev/magna-carta-worktrees/claude/tooltip-provider-context-error-qtya5d
area: Signed-out screens crashed on the version chip's tooltip; render crashes now draw the failure screen
status: review
touches: apps/web/src/routes/+layout.svelte, apps/web/src/routes/+error.svelte, apps/web/src/hooks.client.ts, apps/web/src/lib/components/app-shell.svelte, apps/web/src/lib/diagnostics/, apps/web/test, apps/web/vitest.config.ts, roadmap.d/observability.md, docs/conventions/error-logging.md, changelog.d
---

Moves the one `Tooltip.Provider` from the app shell to the root layout so the sign-in, password-reset
and joining screens (which mount outside the `(app)` route group) get the context the version chip's
tooltip needs, and removes the shell's duplicate. Adds a render boundary beneath the root layout so
a throw while a route renders draws the failure screen with a client Error ID rather than a blank
page; the hook and the boundary share `crash.ts`. A concurrent stream editing the root layout, the
top of the app shell's markup, or `hooks.client.ts` should expect this.
