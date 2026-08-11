---
category: Fixed
---

**The public status page no longer reports Cloudflare as degraded on days Cloudflare reports itself
operational.** Cloudflare's Statuspage publishes around 470 components and most of them are
individual edge locations; several dozen are re-routed or under maintenance at any given moment, so
its whole-page rollup indicator sits at "minor" more or less permanently even with no open incidents
and every service healthy. Reading that one field made our upstream row contradict the provider it
was quoting. A provider entry can now name the component groups this platform actually depends on —
for Cloudflare, the single group holding Workers, D1, R2, Queues, Durable Objects, Vectorize,
Workers KV and Containers — and the severity is the worst of those components plus any unresolved
incident that touches them. A named group that no longer exists falls back to the whole-page
indicator rather than to "operational", so a rename upstream can never manufacture a green. The
verdict band was never affected by any of this: an upstream provider does not set this platform's
status, and an unreachable provider feed still reads as "Status unavailable" in neutral ink rather
than as an outage.

Links out to Cloudflare's status now point at `new.cloudflarestatus.com`, including the standalone
fallback page served when the status store itself cannot be read. Provider rows carry their human
status page explicitly, so the link a reader follows no longer has to be the origin of the machine
feed being polled.

The 90-day uptime bar beneath each component now speaks its record to a screen reader. The ticks
themselves stay decorative — ninety announcements per component would be unusable — but the state
they encode arrives as text: consecutive days sharing a state collapse into one phrase ("2 June 2026
to 4 August 2026 — No data"), every day in the window falls in exactly one phrase, and the uptime
percentage was already plain visible text. Days before recording began are still named as no data,
never as operational.
