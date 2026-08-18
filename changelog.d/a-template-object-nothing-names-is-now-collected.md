---
category: Fixed
audience: internal
---

**A template object nothing names is now collected.** Registering a template writes the prepared
bytes to R2 inside the idempotent effect and ahead of the scan, deliberately — a committed row
pointing at bytes that were never written is a template that fails at 4:55pm on a filing deadline,
where a written object with no row is only wasted storage. The ordering is unchanged; what was
missing was anything that reclaimed the second case. A registration that threw after the write (an
unreachable scan engine answering `503` is the common one) left a full copy under `templates/` that
no row pointed at, under a freshly minted key on every retry, and nothing reached it: the storage
reconciliation pass lists `files/` and `bulk/` and corrects a meter rather than deleting anything.

`apps/worker/src/assemblies/template-orphan-sweep.ts` runs on the existing daily storage cron, beside
the search-split retirement it is shaped after. Per firm it resolves the bucket through
`files/firm-bucket.ts`, pages the `templates/` listing, and deletes an object only when three things
hold: no version row anywhere in the fleet names its key, it is not under the staging prefix, and it
has been sitting unnamed for longer than a 24-hour grace period. The grace period is the safety
argument — it is the registration window itself that must never be swept into, since between the
object write and the row commit the bytes are real and no row names them.

**The retention set spans the fleet rather than one firm, and that is deliberate.** A template key
carries no firm and every firm resolves to the same bound R2 handle today, so "not in THIS firm's
version set" is equally true of every other firm's live templates. The set is therefore built as one
read per firm through that firm's own firm-scoped handle — `listTemplateVersionR2Keys` in
`@magna-carta/document-assembly/template-statements`, with no status filter, because a pending or
quarantined version still names bytes that are the firm's. If any of those reads fails the pass
disarms and deletes nothing: a complement is only as safe as the set it complements, and skipping a
night costs storage where deleting a live template costs a firm its letterhead.

Deletions are capped per firm per pass and the truncation is counted
(`storage.template_orphan.cap_reached`), so a firm with a large backlog drains over nights instead of
consuming the cron budget, and a truncated pass cannot read as "there was nothing left". Collections
ride `storage.template_orphan.collected`. `TEMPLATE_STAGING_PREFIX` moved to
`@magna-carta/document-assembly/template-service` beside the prefix it nests in, since the route and
the sweep now both need it. Reaping abandoned staged uploads stays out of scope — it wants an R2
lifecycle rule, queued in `docs/deploy-queue.md`.
