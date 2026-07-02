---
branch: service-status
worktree: C:/dev/magna-carta-worktrees/service-status
area: Platform — Service Status (in-app + public status page systems; extends ADR-0048)
status: design committed 2026-07-02 (brainstormed); plan next. No UI (deferred).
touches: docs/specs/2026-07-02-service-status-design.md, docs/decisions/pending/ (1 ADR fragment — extends ADR-0048), changelog.d/, NEW packages/status (snapshot schema + provider registry/adapters + health derivation + mergeSnapshot), NEW apps/status-worker (isolated read-only public worker), apps/worker (secret-guarded /api/v1/platform/status/* write routes + cron probe/poll additions + OpenAPI regen), wrangler.jsonc (FIRST kv_namespaces binding STATUS_KV, on both workers; new cron trigger; status.<domain> route), ROADMAP.md/STATUS.md rows
---

Platform **Service Status** — one truthful "is anything out of service?" surface covering
Cloudflare primitives + outside providers, plus operator-declared disruptions with rolling
updates. **Design committed** (2026-07-02); implementation plan next. **No UI** (deferred) — this
stream builds the *systems*: datastore, isolated read worker, write path, machine signals, read feed.

**Extends ADR-0048** (which already put the live status banner in control-plane KV, operator-gated,
served as a public Workers surface off the app's fate). This grows it to a full component matrix +
upstream aggregation + a dedicated isolated read worker.

**Shape:** three signals into one snapshot — (A) upstream providers mirrored from their own
Statuspage feeds via one adapter (cron poll), (B) our components on an **exception-based** model
(default `operational`; leave green only on positive evidence — operator, telemetry error-signal,
or a failed active probe of the cheap always-on core; **containers are never booted to check**),
(C) operator "service events." Two KV keys (`status:derived` cron-owned, `status:authored`
operator-owned) merged **at read time** — no lost-update race. `STATUS_KV` is the system of record;
**no new D1**.

**Naming:** operator disruptions are called **"service event"**, NOT "incident" — the per-firm
`incident` table / `incidents.ts` are diagnostic bug reports, unrelated. Don't conflate.

**Auth:** writes ride the existing `PLATFORM_ADMIN_KEY` secret-header gate (same as
firm-provisioning) — there is no global RBAC role, and no `platform_staff`/support-access model in
code to reuse. Inherits firm-provisioning's "real platform-admin principal is a later seam" TODO.

**Cross-cutting contention for other streams:**
- **First `kv_namespaces` binding in the repo** (`STATUS_KV`) lands in `wrangler.jsonc` — if your
  stream also edits wrangler bindings/cron, coordinate + sync `main`.
- New top-level `apps/status-worker` (own wrangler, own route `status.<domain>`) — a second
  deployable; the isolation invariant is **it must never gain an app/D1/per-firm binding**.
- `apps/worker` `scheduled.ts` (new cron branch) and a new `/api/v1/platform/status/*` route group
  + OpenAPI snapshot regen.
- New `packages/status` (DAL-free, ADR-0044 isolation pattern).

Gate cross-cutting edits on `vp run worktrees` + a `main` sync.
