---
branch: service-status
worktree: C:/dev/magna-carta-worktrees/service-status
area: Platform — Service Status (in-app + public status page systems; extends ADR-0048)
status: design committed 2026-07-02 (brainstormed); plan next. No UI (deferred).
touches: docs/specs/2026-07-02-service-status-design.md, docs/decisions/pending/ (2 ADR fragments — extends ADR-0048 + the new platform-operator principal), changelog.d/, NEW packages/status (snapshot schema + provider registry/adapters + health derivation + audience-scoped mergeSnapshot), NEW apps/status-worker (isolated read-only public worker), apps/worker (platform-operator-guarded /api/v1/platform/status/* write routes + platformOperatorGuard + cron probe/poll additions + OpenAPI regen), packages/database (control-plane platform_operator table + control-plane migration), packages/access-control (platform-operator membership check), wrangler.jsonc (FIRST kv_namespaces binding STATUS_KV, on both workers; new cron trigger; status.<domain> route), ROADMAP.md/STATUS.md rows
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

**Auth:** builds the codebase's **first platform-level authorization axis** — a minimal
`platform_operator` principal (control-plane table + `platformOperatorGuard`, session-based, seeded
by hand). NOT the `PLATFORM_ADMIN_KEY` secret: a shared secret has no identity to attribute a
status timeline to, and suits a rare machine call, not a repeated human incident action. This fills
firm-provisioning's own deferred "real platform-admin principal" seam. Writes stamp the session
`userId` as author; a public/internal audience split strips operator identity from the public feed.

**Cross-cutting contention for other streams:**
- **First platform-level auth axis** (`platform_operator`) — control-plane schema + a new
  control-plane migration + a check in `packages/access-control`. If your stream touches the
  control-plane schema or access-control, coordinate.
- **First `kv_namespaces` binding in the repo** (`STATUS_KV`) lands in `wrangler.jsonc` — if your
  stream also edits wrangler bindings/cron, coordinate + sync `main`.
- New top-level `apps/status-worker` (own wrangler, own route `status.<domain>`) — a second
  deployable; the isolation invariant is **it must never gain an app/D1/per-firm binding**.
- `apps/worker` `scheduled.ts` (new cron branch) and a new `/api/v1/platform/status/*` route group
  + OpenAPI snapshot regen.
- New `packages/status` (DAL-free, ADR-0044 isolation pattern).

Gate cross-cutting edits on `vp run worktrees` + a `main` sync.

## Deploy activation (post-merge — not performed here)

Verification (Task 14) is otherwise clean; before this feature goes live in production, someone
with dashboard/D1 access must:

1. **Create the KV namespace:** `wrangler kv namespace create magna-carta-production-status`, then
   paste the real id into the `STATUS_KV` binding in both `apps/worker/wrangler.jsonc` and
   `apps/status-worker/wrangler.jsonc` (both currently carry the placeholder all-zero id).
2. **Stand up the second deployable:** create the `apps/status-worker` Workers Build connection in
   the Cloudflare dashboard, and bind its `status.<domain>` custom domain/route.
3. **Seed the bootstrap operator:** insert the first `platform_operator` row (by hand, against
   control-plane D1) for the operating owner's `user.id`, and confirm that account has 2FA enabled
   — `platform_operator` select requires it (see `packages/data-access` platform_operator select).
4. **Confirm the cron:** after the `*/10` status cron has run at least once, verify it is publishing
   `status:derived` — check the KV value directly or the status worker's public feed.

Before step 1, also fix the Task 14 blocking finding: `apps/worker/package.json` is missing the
`@magna-carta/status` workspace dependency (breaks its wrangler dry-run and the six
feature-relevant test suites — see `.superpowers/sdd/task-14-report.md`).
