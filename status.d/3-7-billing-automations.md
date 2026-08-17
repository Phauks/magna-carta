---
slice: 3·7 — Billing automations
group: phase-3
order: 7
research: n/a
spec: done by="Opus 5"
plan: done by="Opus 5"
built: todo
ui: todo
load-profile: todo
tested: todo
branch: claude/billing-automations-design
active-work:
next: Owner flags M1, M2 and M3 — they decide whether a schedule may finalize, whether reminders ship on or off, and whether a payment plan may charge anything
link-spec: docs/specs/2026-08-16-billing-automations-design.md
link-plan: docs/specs/2026-08-16-billing-automations-implementation-plan.md
adrs:
blocked-by:
---

**Design and plan written; the build waits on three owner flags.** The scheduled no-client-present layer over 3·4 — recurring and batch bills, payment reminders, payment plans, and evergreen below-floor replenishment — riding the per-firm cron fan-out and the transactional outbox, with Notifications as the only delivery path. Three absences found during the design reshaped it: there is **no channel to a client** (every notification audience resolves to a member and the portal is not started), there is **no `invoice_delivery` record and no invoice renderer** (the table the billing design specified was never built, though its identifier prefix is registered), and **a cron pass has no actor** — `resolveTrustAuthorizationDisposition` takes a `UserId` and the seeded posture routes a non-holder to a holder, so nothing scheduled can take an earned fee, held by a source scan rather than by discipline. So a reminder is a prompt to the firm rather than a letter to the client, a payment plan is a record and a derived standing rather than a charge, and every automation is tiered by consequence: a draft and a record are free, finalizing and telling a client sit behind a firm setting defaulting off and a still-standing human authorization, and money moving is unreachable. Each automation converges on a UNIQUE index in **billing's own tables** rather than on the notification dedupe key, because the retention sweep deletes the row that key lives on and a once-per-invoice reminder would re-raise the day it aged out. Every run writes one row per target including the skips, with a closed outcome label and never a sentence — and a run row records a decision about the world, never a failure to read it, or one bad afternoon becomes a permanent skip. Thirteen owner flags (series `M`), each with a recommendation.
