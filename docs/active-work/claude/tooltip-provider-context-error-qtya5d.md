---
worktree: C:/dev/magna-carta-worktrees/claude/tooltip-provider-context-error-qtya5d
area: Production source maps for the web app, following the sign-in tooltip crash
status: review
touches: apps/web/vite.config.ts, changelog.d
---

Follow-up to the sign-in crash fix (landed as #543): the web app's production build now emits source
maps, so a stack frame in a member's browser names the file and line. One config key and a fragment;
nothing else in flight should collide.
