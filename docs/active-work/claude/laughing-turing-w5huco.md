---
worktree: /home/user/magna-carta (remote session)
area: Safe website viewer — whether this deployment can hold a browser session, answered rather than assumed
status: review
touches: apps/api-worker/src/routes/safe-browse-session-probe.ts, apps/api-worker/src/app.ts, pnpm-workspace.yaml
---

Interactive remote browsing needs a browser that survives between requests, which is a different API
against the same binding than the quick actions the static capture uses, and nothing here had ever
exercised it. This is the probe that exercises it: acquire, navigate, disconnect, reconnect to the
same session, navigate again, attach CDP — reporting each step.

It exists in this shape because the previous round spent weeks attributing every failed capture to an
account entitlement that had been serving the whole time. The design for interactive browsing waits
on what this returns.

The probe navigates only to a constant held in its own file. It accepts no target and must never be
extended into one — a route that drives a real browser to a caller's address is the SSRF surface the
whole subsystem exists to contain.
