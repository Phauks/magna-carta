---
worktree: /home/user/magna-carta/.claude/worktrees/notifications-4
area: Notifications slice 4 — the email digest, and the content boundary
status: review
touches: packages/notifications/, packages/telemetry/src/metrics.ts, apps/worker/src/scheduled.ts, apps/worker/src/index.ts, apps/worker/src/app.ts, apps/worker/wrangler.jsonc, docs/deploy-queue.md, docs/user/features/, roadmap.d/, status.d/, changelog.d/, docs/decisions/pending/
---

The first time anything in this subsystem leaves the platform. Slices 1–3 built rows a member reads
inside the product, behind their session and the visible-matter predicate; a digest is a copy handed
to a mailbox the firm may not administer, cannot recall, and — decisively — cannot re-filter when
access changes.

Built: the digest reader on the one shared read (`selectDigestWindowStatement`, keyset watermark, the
wall composed in SQL before the `LIMIT`); the renderer and its content boundary
(`src/digest-render.ts` — a category label, an integer, and one link, and nothing a person typed);
the hourly per-firm run anchored to the firm's own morning; and the first consumer of slice 3's email
cadence.

Outbound mail is an unprovisioned seam. `resolveNotificationDigestSendPort` selects on the presence
of the Email Service binding, a verified sender, and a public origin, and reports a typed
not-configured reason rather than falling through to the dev logging adapter — which would have
returned successfully having mailed nobody while the run recorded `sent` rows and advanced
watermarks. Owner steps are in `docs/deploy-queue.md`.

No `apps/web` change: an email template is not a screen, and the notification-centre and preference
surfaces stay deferred.
