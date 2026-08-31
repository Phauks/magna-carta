---
worktree: C:/dev/magna-carta-worktrees/claude/unified-error-screen-8pam6s
area: Unified failure surface — one problem model and one failure surface across apps/web
status: review
touches: apps/web/src/lib/api/, apps/web/src/lib/diagnostics/, packages/design-system/, roadmap.d/observability.md, status.d/0-6-telemetry-baseline-platform-closeout.md, docs/conventions/error-logging.md, docs/user/features/
---

Built. One problem model over the whole app, the `failure-state`/`failure-band`/`failure-details`
family in the design system, the client crash boundary, the breadcrumb ring, a Report a Problem that
files, the platform notice, and the adoption across every surface that used to flatten a problem into
a sentence. `pnpm run lint:failure-surface` is the fitness function that keeps it that way.

A concurrent stream should not edit `apps/web/src/lib/api/request.ts`, anything under
`apps/web/src/lib/diagnostics/`, or add a new per-surface failure rendering while this is open — the
whole point of the branch is that there is one of each. A new surface that needs to render a failure
should reach for `FailureNotice` or `FailureScreen` rather than an `Alert`.
