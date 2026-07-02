# Service Status — design

Status: design (brainstormed 2026-07-02) · Extends ADR-0048 (product-updates surface + live status)

## Purpose

Give users and operators one truthful answer to "is something out of service?" — covering
both the Cloudflare primitives and outside providers this platform depends on — and give the
operators a way to declare disruptions and post rolling updates that everyone can see. The
external surface must stay up **when the app is down**, because that is exactly when people
consult it.

UI is deferred. This slice builds the **systems** — the datastore, the isolated read worker,
the write path, the machine signals, and the read feed — so a UI (in-app and public) can be
dropped on later without rework.

## Scope

**In scope (backend systems only):**

- Three signal sources feeding one status snapshot:
  - **A — upstream providers:** mirror what Cloudflare / GitHub / etc. publish on their own
    status pages (poll, normalize, cache).
  - **B — our components:** exception-based health for our own primitives and engines.
  - **C — service events:** operator-declared disruptions with a rolling update timeline.
- One shared datastore (`STATUS_KV`), an isolated read-only public worker, and operator write
  endpoints gated by a new minimal **platform-operator principal**.
- A machine-readable read feed (`status.json`) that both the public page and the in-app banner
  consume.
- Tests and docs.

**Out of scope (deferred):**

- All rendered UI / styling — public page HTML and in-app banner presentation.
- Subscriber notifications (email/webhook on status change).
- Per-firm-scoped status filtering (all firms see the same platform status for now; ADR-0048
  already reserves an `audience` seam for later).
- The diagnostics-agent *propose* workflow (ADR-0048 mentions agents proposing status) — left
  as a named seam; operators publish directly for now.
- A **self-service** grant UI for platform operators — the `platform_operator` allow-list is
  seeded by hand (see "Authorization"); a management surface is later.
- Migrating firm-provisioning onto the new platform-operator principal — this slice builds the
  principal and uses it for status; provisioning keeps its secret for now (a later cleanup).

## Background — what already exists (and what does not)

- **ADR-0048** already decided the substrate for the *live* status content: it lives in
  **control-plane KV** (not D1), is written by an operator-gated endpoint, and is served as a
  **public Workers surface** deliberately kept off the app's fate so it survives an incident.
  This design **extends** that from a single banner to a full component matrix + upstream
  aggregation + an isolated read worker.
- **No `platform_staff` entity and no support-access framework exist in code.** Support-access
  (accessing *another* firm for remote support) is a different, unbuilt axis and is **not** the
  model for authoring global status.
- **The only global (cross-firm) auth gate that exists** is the `PLATFORM_ADMIN_KEY`
  shared-secret header guarding firm-provisioning (`apps/worker/src/routes/firms.ts`), which is
  self-labeled as a placeholder until a real platform-admin principal model is built. This
  design does **not** reuse it — see "Authorization" for why a shared secret is the wrong fit
  for a repeated, attributed human action, and builds the minimal principal that secret's own
  comment anticipated.
- **RBAC is strictly per-firm** — there is no global role to hang status-authoring on, which is
  why this introduces a platform-level principal rather than a per-firm permission.
- **No KV namespace is bound in the repo yet** — `STATUS_KV` is the first.
- **Naming collision:** `apps/worker/src/routes/incidents.ts` and the per-firm `incident` table
  are **diagnostic bug reports**, unrelated to status. This design uses **"service event"** for
  operator-declared disruptions so nothing conflates.

## Architecture

Three deployables sharing exactly **one** KV namespace and nothing else:

```
   operator ── authenticated writes ──┐   (platform-operator principal)
                                       ▼
                            apps/worker (existing)          ┌──────────────┐
   cron (probe + poll) ─── writes ───────────────────────► │              │
                                                            │   STATUS_KV  │
   public / SPA ── read ── apps/status-worker ── reads ───► │  (first KV)  │
                           (NEW: tiny, read-only)           └──────────────┘
```

- **`apps/status-worker` (new)** — a minimal, **read-only, unauthenticated** worker on its own
  route (`status.<domain>`). Its only job: read `STATUS_KV`, merge, and serve. It has **no app
  binding and no D1 binding**, so it survives the app worker, the control-plane D1, and the
  per-firm databases all being down. This is the fate-isolation guarantee. The one failure it
  does not survive — all of Cloudflare down — is precisely when Cloudflare's own status page
  becomes the authority, which the page links out to.
- **`apps/worker` (existing)** — owns everything that **writes**: the operator endpoints
  (gated by the platform-operator principal, see "Authorization") and the cron that
  probes/polls. Reuses the chokepoint's session resolution, telemetry, and the existing cron
  infrastructure (`apps/worker/src/scheduled.ts`).
- **`STATUS_KV`** — the system of record. No new D1, no new migrations lane.

Fate note: if the *write* side (app worker) is down, the status worker keeps serving the last
published snapshot from KV — which is the desired behavior (last known state persists).

## Code placement

- **`packages/status` (new)** — pure, DAL-free core (the ADR-0044 pattern where package
  isolation *is* the confidentiality boundary; no per-firm data crosses it). Single home for:
  - the snapshot **zod schema** and status vocabulary,
  - the **provider registry + adapters** (upstream polling normalization),
  - **health derivation** (probe results + telemetry signal → component status),
  - the **`mergeSnapshot()`** function (derived + authored → published view + overall rollup).
  Both workers import it. Nearly all unit tests live here.
- **`apps/worker`** — write routes + cron, importing `@magna-carta/status`; writes `STATUS_KV`.
  Hosts the `platformOperatorGuard` middleware.
- **`apps/status-worker`** — read/serve, importing `@magna-carta/status`; reads `STATUS_KV`.
- **`packages/database`** (control-plane schema) — the new `platform_operator` table + its
  control-plane migration.
- **`packages/access-control`** — the platform-operator membership check (the resolver the guard
  calls), kept beside the existing per-firm resolver but on the distinct platform axis.

## Data model — two writers, no race

The cron and the operator write **separate keys**, merged **at read time** by the shared
package. This removes any lost-update race without needing a lock or a DO:

- **`status:derived`** — cron-owned: machine component health (B) + upstream provider
  statuses (A).
- **`status:authored`** — operator-owned: service events (C) + any manual component overrides.
- There is **no** `status:published` key. The status worker (and the in-app widget) read both
  keys and compute the published snapshot + `overall` rollup via `mergeSnapshot()`.

### Vocabulary (mirrors Atlassian Statuspage for instant familiarity)

- **Component status:** `operational | degraded | partial_outage | major_outage | maintenance`.
- **Service-event lifecycle:** `investigating | identified | monitoring | resolved`.
- **Upstream provider status:** normalized into the component vocabulary, plus a distinct
  `status_unavailable` when *their* feed cannot be reached (an honest fetch failure, not a
  fabricated verdict about our own components).

### Snapshot shape (informative — schema is the contract, in `packages/status`)

```
DerivedSnapshot   { schemaVersion, generatedAt, components[], providers[] }
  component        { id, name, group, status, source: "probe"|"telemetry", lastChange, note? }
  provider         { id, name, status, upstreamUrl, fetchedAt, reachable }

AuthoredSnapshot  { schemaVersion, updatedAt, events[], overrides[] }
  event            { id, title, impact, lifecycle, affectedComponentIds[], authorUserId,
                     startedAt, resolvedAt?,
                     updates: [ { at, lifecycle, body, authorUserId } ] }
  override         { componentId, status, note, setAt, authorUserId }   // operator manual status

PublishedSnapshot = mergeSnapshot(derived, authored, { audience })
  { schemaVersion, generatedAt, overall, components[], providers[], events[], stale }
```

Merge rules:

- An operator **override** wins over the derived status for a component.
- `overall` is the worst active component/provider status combined with any active
  (non-resolved) event impact — but a provider in `status_unavailable` (their feed unreachable)
  never worsens `overall` (it is not our outage).
- `stale` is set when `generatedAt` is older than the staleness threshold.
- **Attribution is audience-scoped.** `mergeSnapshot` takes an `audience`
  (`"public" | "internal"`). For `"public"`, `authorUserId` is **stripped** from every event,
  update, and override (the public feed carries at most a generic "Operations" label, never an
  operator's identity). For `"internal"`, attribution is preserved so the in-app operator view
  can show who posted what. The status worker's public endpoints always request `"public"`;
  attribution never reaches the public KV read path by construction.

## The three signal pipelines

### A — upstream providers (cron poll)

- A **static provider registry** in `packages/status`: each entry `{ id, name, kind, url }`.
- **One Statuspage adapter** covers all Atlassian-Statuspage-based providers (Cloudflare,
  GitHub, …): fetch `/api/v2/summary.json`, normalize `status.indicator`
  (`none|minor|major|critical`) into our vocabulary.
- Providers with **no public feed** (e.g. Helcim, Pangram) are `kind: "manual"` — operator-set
  only, never polled.
- Fetch failure → that provider row is `status_unavailable`; it must **not** poison the
  `overall` rollup as if it were our outage.
- Outbound fetches honor the existing SSRF/outbound-fetch guards (the provider URLs are a fixed
  allow-list in the registry, so this is low-risk, but goes through the same safe path).

### B — our components (exception-based; default Operational)

The resting state of every component is **operational** ("no known problem"), matching how real
status pages behave — a green dot means "no known problem," not "just tested passing." A
component leaves operational **only on positive problem-evidence**, from three sources:

1. **Operator declaration** (an override or an event) — see C.
2. **Telemetry error-signal** (passive) — the error rate on jobs *already flowing through* a
   component crosses a threshold. **No traffic → no error signal → stays operational.** An idle
   container reads the same green as everything else; there is no "unknown/idle" state.
3. **A failed active probe** — but **only for the cheap, always-on core primitives**: the
   status-worker health endpoint, a control-plane D1 `SELECT 1`, an R2 head on the canonical
   bucket, and a `STATUS_KV` read. A probe failure there is genuine positive evidence.

We **never boot a container** (Collabora, LibreOffice, Tantivy, OCR, scan) merely to check it is
alive — that would burn per-second cost and defeat scale-to-zero (golden rule 10). Their health
comes only from operator declaration or telemetry signal.

The telemetry-derived half is the part with the most unknowns. It is defined as a clean
interface `deriveFromTelemetry()` with a **conservative v1**: a bounded error-rate counter that
the standard error-logging pipeline increments per component, read by the derivation. Richer
Analytics-Engine querying is a **later refinement**, not a blocker for this slice.

### C — service events (operator-authored writes)

Operator actions, all writing `status:authored` and stamped with the acting operator's
`authorUserId` (from the session) for audit:

- Declare a service event (title, impact, affected components).
- Post a rolling update (advances/annotates the lifecycle).
- Change lifecycle / resolve.
- Set or clear a **manual component override**.
- Schedule a **maintenance** window on a component.

## Authorization — a minimal platform-operator principal

Status authoring is a **repeated, attributed, human** action performed *during incidents*. A
shared secret (the `PLATFORM_ADMIN_KEY` used by firm-provisioning) is the wrong fit for it:

- it authenticates a **request, not a person**, so it has no identity to record as the author —
  yet an event timeline's whole value is "who said what, when";
- it suits a rare machine-ish call (minting a firm), not a repeated human one under stress —
  handing operators a shared secret to paste means secret sprawl, no per-person revocation, and
  painful rotation;
- it conflates "platform automation gate" with "which humans may speak for the platform."

So this slice builds the small, real thing that firm-provisioning's own comment already
anticipated ("a real platform-admin principal model is a later seam"):

- **`platform_operator` table** in the **control-plane** D1 — `{ user_id, granted_at,
  granted_by, expires_at (nullable), note }`. It is a distinct **platform** authorization axis,
  separate from per-firm RBAC (which stays per-firm). `expires_at` mirrors the per-firm
  `direct_grant` time-boxing pattern: `NULL` = standing membership, a timestamp = a grant that
  lapses automatically. Membership is **seeded by hand** (SQL) for the operating firm's owner —
  no self-service grant UI in this slice.
- **`platformOperatorGuard`** middleware in `apps/worker` — reuses the Better Auth session the
  chokepoint already resolves, and requires the session `userId` to be an **active, unexpired**
  `platform_operator` (`expires_at IS NULL OR expires_at > now`). Non-members and lapsed grants
  get `403`; unauthenticated get `401`. It runs as a route-level guard on the status write
  group, on the **platform** axis (not the per-firm RBAC chokepoint permission check).
- Every write is **stamped with the session `userId`** as `authorUserId` → attribution and
  audit fall out for free. (Public exposure of that identity is prevented by the
  audience-scoped merge, above.)
- Endpoints under `/api/v1/platform/status/*`. The isolated status worker exposes **no write
  surface at all** — minimal attack surface.

The `PLATFORM_ADMIN_KEY` secret is **not** reused here; it remains firm-provisioning's gate.
Migrating provisioning onto this principal later is a natural cleanup but out of scope.

## Read surfaces (UI deferred — endpoints are the deliverable)

- **External (status worker):**
  - `GET /api/status.json` — the canonical machine-readable feed (also what ADR-0048's future
    forum mirrors, and what external monitors can consume).
  - `GET /` — the public page. HTML is deferred; for now this returns the JSON (or a minimal
    placeholder). Unauthenticated.
- **Internal (in-app):** the SPA **consumes the same `status.json`** to drive an in-app banner.
  No separate internal datastore, endpoint, or auth — the internal surface routes to the same
  source. (This confirms the "we may not need a special internal page" intuition.)

## Failure modes

- **Status worker can't reach KV** → serve the last value from the Cache API; failing that, a
  minimal static "status system unavailable — see Cloudflare status" fallback with an outbound
  link. Never 500 the public page.
- **Cron stalls** → KV retains the last snapshot; `generatedAt` ages; `mergeSnapshot` sets
  `stale`, and the read surface can surface a subtle "data may be stale" note past the
  threshold (a staleness watchdog). No fabricated greenness.
- **Upstream provider unreachable** → single provider row `status_unavailable`; `overall`
  unaffected.
- **Operator write during a cron run** → separate keys + read-time merge → no lost update.

## Testing

- **Unit (`packages/status`):**
  - Statuspage `indicator` → vocabulary normalization (all four indicators + malformed input).
  - `mergeSnapshot` + `overall` rollup, including override-wins-over-derived.
  - **Exception-based default:** an idle component with no signal → `operational` (never
    `unknown`).
  - Staleness computation from `generatedAt`.
  - **Audience-scoped attribution:** `mergeSnapshot(..., { audience: "public" })` strips every
    `authorUserId`; `"internal"` preserves it. A public snapshot carrying an operator identity
    is a test failure.
- **Integration (Miniflare):**
  - Cron writes `status:derived`.
  - Write endpoints via `platformOperatorGuard`: **`401`** unauthenticated, **`403`** for an
    authenticated non-operator session **and for a lapsed (`expires_at` past) grant**, **`200`**/
    effect for an active `platform_operator` — and the resulting event is stamped with that
    operator's `userId`.
  - Status-worker read is unauthenticated, merges both keys, and its public feed contains no
    `authorUserId`.
  - **Isolation assertion:** the status worker binding set contains `STATUS_KV` and **not** any
    app D1 / R2 / per-firm binding.
- **Fixtures:** a sample provider `summary.json`; a seeded `platform_operator` row.

## Docs / decisions (golden rules 5, 8)

- New **ADR** (pending fragment) recording this as an **extension of ADR-0048**: component
  matrix + upstream aggregation + isolated read worker + exception-based health model + the
  first KV namespace.
- A second **ADR** (pending fragment) recording the **minimal platform-operator principal** —
  the first platform-level (non-per-firm) authorization axis, why it exists rather than reusing
  the provisioning secret, and that it deliberately fills firm-provisioning's deferred seam.
- **Changelog fragment** (`changelog.d/`).
- **ROADMAP** narrative row + **STATUS** stage row.
- **`docs/active-work/service-status.md`** stream note.
- Regenerate the OpenAPI contract for the new write routes.
- A per-area `CLAUDE.md` for `apps/status-worker` and/or `packages/status` capturing the local
  invariant: **the status worker must never gain an app/D1/per-firm binding** (the isolation is
  the whole point).

## Open questions / seams left deliberately

- Exact telemetry error-rate threshold and window (tunable knob; conservative default in v1).
- Whether Helcim / Pangram publish a consumable status feed (registry marks them `manual` until
  confirmed).
- Self-service management of `platform_operator` membership (seeded by hand this slice).
- Whether firm-provisioning migrates off its secret onto this principal (later cleanup).
- Diagnostics-agent propose-then-publish workflow (ADR-0048 seam).
