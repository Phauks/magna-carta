# Firm usage diagnostics — design

**Status:** Accepted (design) · **Date:** 2026-06-17 · **Owner:** Trevor Goldsmith
**White-paper home:** _Plugin / Add-on system_ (the Tools area) · _Matters and File Manager_ (storage metering)
**ADRs:** **ADR-0103 (firm usage snapshot — a read-only, per-firm usage view assembled from our own D1; per-firm compute/activity via the Cloudflare analytics API is a deferred credentialed seam — new)** · builds on ADR-0101 (the Tools layer), ADR-0078/0083 (storage metering + load-profile accretion), ADR-0003 (tenancy), ADR-0068 (access control).

A **firm usage snapshot** — a read-only, per-firm view of what a firm is consuming, assembled entirely from our own per-firm D1: storage used and entity counts. It is the first **Diagnostics** tool with real data behind it (after the client-side speed test), surfaced through the Tools area. Firm-facing: a firm sees _its own_ usage.

**Scope discipline (owner, 2026-06-16):** only metrics that need **no API token** are in scope now — everything sourced from our own D1. Per-firm **compute/activity** (Workers CPU time, request volume) is account-level Cloudflare data reachable only through the **Cloudflare GraphQL Analytics API / Analytics Engine with an API-token credential**; it is designed here as a seam and built later. **No UI** in this work — the snapshot is headless (pure reads now; a worker read route next); the widget rides the design-system shell.

**Build gates:** none. Pure reads over existing per-firm tables; the `storage_meter` rollup (ADR-0078, slice 1·1) already exists and is reconciled against R2.

---

## 1. Scope — what the snapshot contains

In scope now (all from per-firm D1, no credential):

- **Storage** — total `bytes` + `object_count`, broken down by storage class (`standard` / `infrequent_access`), summed from the authoritative `storage_meter` rollup.
- **Entity counts** — matters (total + by lifecycle status), non-deleted files, clean file versions, folders, and locations.

Deferred as explicit seams ("eventually more"):

- **Per-firm compute / activity** — Workers CPU time, request volume. Account-level Cloudflare data; needs the Cloudflare Analytics Engine query (our telemetry is already written there, indexed by firm) + an **API-token credential**. Not a D1 read — a credentialed external call. Seam only.
- **The worker read route** that exposes the composed snapshot (the next headless step — §4).
- **The UI widget** — gated on the design-system shell (slice 0·7a), like every tool.

## 2. Data sources (today, all per-firm D1)

- `storage_meter` (`@magna-carta/database` per-firm schema) — keyed `(storage_class, artifact_role, prefix)` → `bytes`, `object_count`. The exact rollup, maintained transactionally with each version commit and reconciled by the scheduled R2 LIST. Summing over `artifact_role` + `prefix`, grouped by `storage_class`, yields the storage figures.
- `matter` — lifecycle `status` (`prospective` / `open` / `closed`) for the matter counts.
- `file` (non-deleted: `deleted_at IS NULL`), `file_version` (`status = 'clean'`), `folder` — the file-side counts.
- `location` — the location count.

Analytics Engine already carries storage _trends_ indexed by firm (the `MeterTelemetry` seam) — advisory; D1 stays authoritative, so the snapshot reads D1, not AE.

## 3. Architecture & module placement

**Each domain package owns the read of its own tables** (golden rule 3 — no query reaches across domains or firms). No new package; no premature aggregator.

- **`@magna-carta/file-manager`** — pure statement builders over the tables it already owns:
  - `storageUsageStatement(database)` → rows summed into `StorageUsage` = `{ totalBytes, totalObjects, byStorageClass: Record<"standard" | "infrequent_access", { bytes, objects }> }` (sum over role + prefix, group by class).
  - `fileCountStatement` (non-deleted), `cleanVersionCountStatement` (`status = 'clean'`), `folderCountStatement`.
  - These live beside `metering-statements.ts` / `queries.ts`, the package's existing read home, and carry the `StorageUsage` type + a pure `summarizeStorageMeterRows(rows)` so the summing is unit-testable without a database.
- **`@magna-carta/matters`** — `matterCountsStatement(database)` → `{ total, prospective, open, closed }` (a grouped count over `matter.status`).
- **`@magna-carta/locations`** — `locationCountStatement(database)` → the location count.

The cross-domain **`FirmUsageSnapshot`** aggregate type and its composer are **not built now** — they land with the worker read route that consumes them (§4), so no aggregator exists before there is a consumer. Until then each read stands alone, owned and tested in its package.

Each statement follows the package's established pattern: a builder returning a prepared `SqlStatement`, executed by the caller; pure summarizers (`summarizeStorageMeterRows`) for the in-memory aggregation. No package holds a D1 binding; the database is injected.

## 4. What is built now (the headless increment)

1. **The pure per-domain reads** in §3 — fully unit-tested against real SQLite (node:sqlite, the package convention), no credential, no I/O beyond the injected database.
2. **Tools catalog wiring** (`@magna-carta/tools`):
   - permission **`tools:firmUsage`** in the `@magna-carta/access-control` registry;
   - a **`firm-usage`** manifest in the **Diagnostics** subject group — `backing: { kind: "library" }` (a view of first-party firm data fetched from our own API — the refined `library` definition), `contextTags: ["none"]`, `matterContext: "none"`, icon `chart-pie`.

**Deferred, flagged, not built:**

- The firm-scoped **worker read route** (`GET /v1/firm-usage`, read-shaped) composing the `FirmUsageSnapshot` and returning it through the slice 0·5 chokepoint, gated by `tools:firmUsage`, audited as a read. **Note:** a route bound to a `tools:`-namespace permission needs a small `tools` → tenancy-resource entry in the route-conformance fitness (`RESOURCE_BY_PERMISSION_NAMESPACE` today knows only `firm` / `matters` / `files`) — resolved when the route is built.
- The **compute/activity** Cloudflare Analytics-API seam (credentialed).
- The **UI widget**.

## 5. Testing

- **`summarizeStorageMeterRows`** — pure: empty → zeros; multiple classes/roles/prefixes sum correctly into the per-class breakdown; an unknown class is surfaced, not dropped.
- **Storage / count statements** — executed against an in-memory SQLite seeded through the package's fixtures: zero-state returns zeros; non-zero returns exact sums/counts; `file` count excludes soft-deleted; version count counts only `clean`.
- **Matter counts** — the status breakdown sums to the total across `prospective` / `open` / `closed`.
- **Catalog** — the existing tool-catalog fitness (unique ids, well-formed manifest, registered permission) now covers `firm-usage`; the access-control registry test covers the `tools:firmUsage` key.

## 6. Decisions recorded & docs to update

New ADR (Decision Log): **ADR-0103** (firm usage snapshot — read-only per-firm from D1; the compute/activity Cloudflare-API path is a deferred credentialed seam). On build: ROADMAP / STATUS / CHANGELOG rows + the `@magna-carta/tools` catalog/permission additions, same commit (golden rule 5). The load-profile accretion rule (ADR-0083) binds the new reads when the matters/files volume profile lands — the usage reads are exactly the kind of aggregate that profile measures.
