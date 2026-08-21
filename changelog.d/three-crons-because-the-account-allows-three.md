---
category: Fixed
audience: internal
---

**The app Worker declares three Cron Triggers, not five, and that is what let it deploy at all.**
Cloudflare refused the fourth and fifth on `POST .../workers/scripts/magna-carta/schedules` with an
empty error body, deterministically, on every build. The Worker script itself uploads successfully
and only the schedule step fails, which reads as a transient fault and is not one.

The two dropped triggers — `0 * * * *` (hourly notification digest) and `0 4 * * 0` (weekly
natural-language search keep-alive) — were added 2026-08-16, and **neither has ever fired in
production**: the last successful deploy was 2026-07-04 and carried the three that remain. So this
removes nothing that was running. Both branches stay in `apps/api-worker/src/index.ts`; a trigger is a
schedule and never an action, so restoring a line is the whole of turning one back on.

`*/5 * * * *` is non-negotiable among the three: it is the only applier of control-plane migrations.

Revisit when the account's trigger ceiling is raised, or when either dropped pass has a reason to run
(the digest needs outbound-mail provisioning; the keep-alive needs a managed search instance that can
go stale).
