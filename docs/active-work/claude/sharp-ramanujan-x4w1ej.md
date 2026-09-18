---
worktree: (none — remote session checkout)
area: Research only — an assessment of Cloudflare quick tunnels (`cloudflared tunnel --url`, `trycloudflare.com`) as a development tool for this platform
status: review
touches: docs/research/
---

Adds [`docs/research/2026-09-18-cloudflare-quick-tunnels-assessment.md`](../../research/2026-09-18-cloudflare-quick-tunnels-assessment.md)
and nothing else. It is research, not a decision: no ADR, no spec, no code, no roadmap or status change,
and it explicitly leaves the pre-merge interface-review gap open rather than proposing an answer to it.

Nothing here is contended. The one adjacent document is the 2026-08-11 network-access assessment, which
settled the product-side tunnel question; this one is scoped to the developer-machine use and links to
that finding instead of restating it. A concurrent stream touching the payments design or the interface
review loop should know only that this document names both as context — it changes neither.
