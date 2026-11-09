# Product-usage analytics — design

**Status:** Accepted (design) · **Date:** 2026-06-18 · **Owner:** Trevor Goldsmith
**White-paper home:** _Observability and diagnostics_ (the telemetry pillar — new subsection _Product-usage analytics_; amends _Telemetry analytics tier_)
**ADRs:** **ADR-0106 (product-usage analytics — always-on redacted reached/completed events on the telemetry path; firm-enable + per-user opt-out; cross-firm aggregate-only with small-n suppression; Analytics Engine for live counts + R2 Data Catalog Iceberg, via Logpush→Pipelines, for full-fidelity retention/BI — new)** · realizes **ADR-0056** (telemetry analytics / Iceberg tier — moves from _deferred_ to _adopted_, path updated to Logpush→Pipelines→R2 Data Catalog) · builds on ADR-0038/0017 (observability pillar, the one logging path), ADR-0003 (tenancy), ADR-0068 (access control), ADR-0078/0083 (storage metering + load-profile accretion).

A **product-usage analytics** capability that answers, for **us the builders**, cross-firm: **which features are reached, which are completed, and — later — which retain**, so investment and cut decisions rest on data rather than intuition. It rides the **one logging path** built in slice 0·6 (`@magna-carta/telemetry`), carries **no privileged content** (the same structural allowlist as every other event), and reports **only cross-firm aggregates with small-n suppression**.

It is deliberately **not**:

- **per-firm customer reporting** — that is the firm usage snapshot (ADR-0103), a firm seeing _its own_ consumption;
- **error / incident reporting** — that is the diagnostics pipeline (the white paper's _Observability and diagnostics_ incident layers);
- **opt-in.** For content-free, pseudonymous usage events, opt-in biases the dataset exactly when it is most valuable (early invest/cut decisions) and fragments the telemetry path into two consent regimes. The posture is **always-on, opt-out** (§2).

**Build gates:** none hard. The Iceberg/Pipelines tier (§6) uses Cloudflare Pipelines, available on Workers **Free (1 GB/month) and Paid (50 GB/month)** — at beta volume the Free allowance is expected to suffice; confirm the volume budget before release. Everything else builds on existing per-firm tables and the slice 0·6 telemetry path.

---

## 1. Scope — what is built now

Decided with the owner (2026-06-18): build **Reached + Completed** now; **seam** Retention; **dimension** Performance; **build** the full Iceberg/BI tier now (Cloudflare has since automated its maintenance — §6, so this is now light).

| Insight                                                                                                             | Disposition            | Why                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Feature reached** — an API route mapped to a feature was served to an authorized user (§4 defines this precisely) | **Build now**          | The "what's used vs not" question; a dead-feature detector. Cheapest event, lowest risk.                                                                                                                                                           |
| **Feature completed** — an authoritative domain mutation for a feature occurred                                     | **Build now**          | "Reached but not completed" is a stronger signal than "never reached" — it finds present-but-broken features. Cheap here because completion is derived from outbox events the domains **already emit** (§4).                                       |
| **Frequency & retention** — distinct users returning over time                                                      | **Seam only**          | Premature at a handful of beta firms (retention curves are noise). The only expensive-to-retrofit part — a stable pseudonymous **`userIdHash`** on every user-attributed event — is included now (§3); the rollups are a later query over Iceberg. |
| **Performance-in-context** — p50/p95 of real actions, by feature                                                    | **Dimension existing** | Operational telemetry already times requests (`request.completed`, `durationMs`); add the **`feature`** dimension so latency is sliceable by feature. No parallel system.                                                                          |

**Out of scope (explicit):** per-firm customer-facing usage dashboards; opt-in consent; any per-firm Iceberg tables (this tier is cross-firm aggregate only — the tenancy boundary is preserved exactly as the white paper's pillar already permits: "only non-sensitive technical aggregates roll up globally").

## 2. Consent — always-on, opt-out

The white paper's diagnostics setting (the _User-configurable diagnostics_ section) is already specified as "per firm, with per-user override." Usage analytics reuses that **shape** (not its three detail levels — those govern incident payload depth, an unrelated axis):

- **`usage_analytics.enabled`** — a **per-firm** setting, **default `true`**, in the per-firm `setting` key/value table (`packages/database/src/per-firm-schema.ts`; read via `readFirmSetting` in `packages/data-access/src/setting-statements.ts`). A firm admin (the data controller) can disable it for the whole firm.
- **`usage_analytics.optedOut`** — a **per-user** override, **default `false`**, stored **on the member row** (`member` table, `packages/database/src/per-firm-schema.ts`), per the white paper's _Settings & configuration_ decision that per-user firm-scoped settings live on the member row — **not** a separate key/value table. A migration adds the field; it is read through the member read path. An individual can opt themselves out.
- **Effective consent = `firm.enabled && !member.optedOut`.** Either "off" suppresses that user's events. A user **cannot** opt in above a firm that has disabled it — the firm sets the ceiling.

**Resolution is off the hot path, and ordered correctly.** The telemetry middleware is installed outermost (`app.use("*")`, `apps/worker/src/app.ts`) and runs **before** the chokepoint; `firmId` / `userId` / the firm D1 handle are stashed by the chokepoint **per route, on the inbound pass**. Therefore consent resolution and the `reached` emit happen on the **outbound pass** (after `await next()`), reading `requireChokepointFirmContext` (which yields the firm D1 handle for `readFirmSetting` and the `userId` for the member-row read).

- **Caching.** The resolver caches the **effective** consent (`firm.enabled && !member.optedOut`) isolate-locally per `(firmId, userId)`, TTL **60 s**. The first request for a `(firm, user)` pair in a TTL window does the two reads (firm setting + member row); subsequent requests in the window are a memory hit (no D1 read — keeping resolution off the hot path, golden rule 10). Both a firm **disabling** the setting and a user **opting out** therefore take effect within **one TTL (≤ 60 s)** — an acceptable latency for an analytics consent control.
- **No context → no event.** Public / unauthenticated routes and error responses (401/404) never populate chokepoint context; on those, usage analytics emits **nothing**.
- **Opted-out → nothing.** There is no event to filter downstream; already-emitted events are never retroactively deleted.

## 3. Event model — the `usage.feature` builder

One new allowlist builder on `@magna-carta/telemetry` (`packages/telemetry/src/events.ts`), added to the `EVENT_NAMES` catalog so the uniqueness fitness covers it. Structural redaction is inherited unchanged: an undeclared field has no slot, and `FieldValue` is `string | number | boolean | null` only. **Every declared field is always passed; fields a given emit site cannot supply are passed as `null`** (the builder requires each key be present, and `null` is a valid `FieldValue`).

```
usageFeature = defineEvent("usage.feature", [
  "feature",     // a stable key from the feature taxonomy (§5), e.g. "matters.list"
  "phase",       // "reached" | "completed"
  "surface",     // "web" | "desktop" | "portal" | null (server-derived events that cannot tell)
  "firmIdHash",  // pseudonymous, stable (HMAC — see below)
  "userIdHash",  // pseudonymous, stable — the retention seam; null when no acting user is known
  "appVersion",  // client-supplied only (beacon); null for server-derived reached/completed
] as const)
```

Every event also carries the implicit `correlationId` + `at` (ISO-8601) the builder context already supplies. **No entity IDs, no route-with-IDs, no free text, no content** — the `feature` key is the semantic dimension, not a path. The scrubbing backstop (`scrub.ts`) still runs as the second line of defense; a trip means the allowlist was mis-declared, and is itself counted.

**Per-emit-site field sourcing** (resolves what each site supplies — see §4):

| Field        | `reached` (request middleware) | `completed` (outbox relay)                        | beacon (`POST /v1/usage`)           |
| ------------ | ------------------------------ | ------------------------------------------------- | ----------------------------------- |
| `feature`    | route→feature map              | topic→feature map                                 | client payload (taxonomy-validated) |
| `phase`      | `"reached"`                    | `"completed"`                                     | from payload                        |
| `surface`    | `null`                         | `null`                                            | client payload                      |
| `firmIdHash` | from chokepoint `firmId`       | from the swept firm's `firmId`                    | from chokepoint `firmId`            |
| `userIdHash` | from chokepoint `userId`       | `null` unless the outbox payload carries an actor | from chokepoint `userId`            |
| `appVersion` | `null`                         | `null`                                            | client payload                      |

**Pseudonymous hashes — HMAC, fail-closed.** `firmIdHash` / `userIdHash` are `HMAC-SHA-256(pepper, id)` rendered as a hex handle, where `pepper` is a long-lived server secret bound as `USAGE_ANALYTICS_PEPPER` (Secrets Store / wrangler secret). Plain SHA-256 of a `firm_…` identifier is reversible by enumerating the (small, knowable) firm-id space; the keyed pepper closes that. The hash helper is **pure** (pepper injected, not read from a binding inside it); the **pepper binding is read at each emit site and injected**, identically on the request path and the relay/cron path so hashes **join across both**. **Missing/empty pepper fails closed** — the event is suppressed entirely; an unhashed or unsalted identifier is never emitted (this deliberately does **not** follow the Analytics Engine binding's silent-degrade precedent, because the hash is the only privacy control on the Iceberg rows). The pepper is **stable** (rotating it breaks longitudinal/retention continuity), documented as no-rotate, and never logged.

**Two sinks, one emission.** The same call site feeds both:

- **`logger.count("usage", { feature, phase, surface })`** → the `TELEMETRY` Analytics Engine dataset (binding `TELEMETRY`, `apps/worker/wrangler.jsonc`). Live, fast, **aggregate-only** counts — the MVP query path. **No hashes in counters** (dimensions only); see the small-n note in §6 for why this layer cannot carry per-firm/per-user cardinality.
- **`logger.log(usageFeature(ctx, { … }))`** → structured JSON via the sole `console.log` site (`workers-logger.ts`) → Workers Logs → Logpush → Pipelines → R2 Iceberg (§6). The **full-fidelity row**, carrying the pseudonymous hashes that make retention computable later.

This keeps the **one logging path** intact: Iceberg is a downstream sink of the same logs ADR-0056 always pointed at, not a second emission path.

## 4. Where events originate

- **Reached — server-side, on the outbound pass.** Most features load data through the API, so the per-request telemetry middleware (`apps/worker/src/telemetry-middleware.ts`, which already tags `route` = `c.req.routePath`, the template) is the emit point, **after `await next()`** so chokepoint context exists and the request authorized. A **route→feature map** (§5) turns the matched route template into a `feature` key; the map is **many-routes→one-feature** (several routes can back one feature). **Definition:** a `reached` event means "an API route mapped to feature X was served to an authorized user" — it is **raw per-request**, so one feature-open that fetches several routes yields several `reached` events. Consumers therefore measure adoption as **distinct `userIdHash` per feature per window**, never raw event counts (§6). Pure client-side navigation that fetches no API route is covered by the beacon below.
- **Completed — in the outbox relay, keyed by topic.** Authoritative "it actually happened" signals already exist as outbox topics: `matter.closed`, `file.version_committed`, `ledger.entry.posted`, `location.*`, `incident.created` (`packages/*/src/*-service.ts`). `apps/worker/src/scheduled.ts` is the outbox **relay publisher** (it publishes per-firm outbox rows to the queue; **no per-firm topic consumer exists yet this slice**). The `completed` event is emitted **inside the relay's publish path, branching on `row.topic`** via a **topic→feature map** (§5), for the firm currently being swept. This adds **no new domain instrumentation** and does not import domain logic (golden rule 3 — it reads the durable topic only). Properties:
  - **Firm-level by default:** `firmIdHash` from the swept firm; `userIdHash = null` (the outbox payload does not generally carry the acting user). User-level funnels are a later refinement requiring an actor field in specific payloads — a forward-looking seam, not built now.
  - **At-least-once:** the relay re-publishes on retry, so `completed` is **analytics-approximate** (a completion may be double-counted on a retry). This is acceptable for adoption/funnel signals; if exactness is ever needed, dedupe in the query by `(feature, firmIdHash, correlationId)`. The cleaner long-term home is a per-firm topic-dispatching consumer (a later slice); when that exists, `completed` emission moves there for exactness.
  - Features whose completion has **no outbox topic today** (e.g. folder operations, which emit none) are taxonomy entries with **completion = unmapped**; their completion lands when/if that domain gains a topic.
- **Client beacon — `POST /v1/usage`.** A consent-gated, rate-limited, fire-and-forget endpoint modelled on `POST /v1/incidents` (`apps/worker/src/routes/platform/incidents.ts`): `operationId` `usage.beacon`, `authenticated: true`, `permission: firm:recordUsage` (a new `firm:`-namespace key — `firm` is already mapped in `RESOURCE_BY_PERMISSION_NAMESPACE`, so this avoids any `tools`-namespace cross-slice dependency), `resource: "firm"`, `audited: false`, `idempotency: optional`, `rateLimit: "usage-beacon"`. The client batches `{ feature, phase }[]` via `navigator.sendBeacon`; the handler resolves consent from context (at **receipt time** — a user who opted out before the beacon lands emits nothing, even for already-queued client events) and emits server-side through the same `usage.feature` path. **Failure behavior:** returns **202 Accepted** (empty body — `sendBeacon` ignores the response); **reject-all on any unknown `feature`** (422 in dev for symmetry with the taxonomy fitness; the client cannot react regardless); a documented **max batch size** (within the `sendBeacon` payload cap); over-rate or rejected beacons are **silently dropped**. Registering the route adds the `firm:recordUsage` permission, the OpenAPI snapshot + client regen, and (if not already added by the firm-usage route slice) leaves `RESOURCE_BY_PERMISSION_NAMESPACE` untouched since `firm` is present.

## 5. Feature taxonomy — one home, fitness-guarded, client-synced

A central registry of **stable feature keys** (dot-separated, e.g. `matters.list`, `billing.invoice`, `discovery.review`, `tools.firmUsage`) lives beside the event catalog in `@magna-carta/telemetry` (string literals only — telemetry takes no domain dependency). Three consumers:

- **route → feature** (in the worker, near route registration) — drives server-side `reached`.
- **topic → feature** (in the outbox relay) — drives `completed`.
- **the beacon request schema** — its `feature` field is a **zod enum derived from the taxonomy**, so the OpenAPI snapshot carries it and the generated client stays in sync; the client never hard-codes feature strings, and validation **is** the schema (no drift between client and server taxonomies).

A **fitness test** asserts every `feature` value the maps/enum reference resolves to a registered key (mirroring the existing `EVENT_NAMES` uniqueness test in `packages/telemetry/test/events.test.ts`), so the taxonomy cannot drift from what code emits.

## 6. Storage, query & the Iceberg/Pipelines tier

Three layers, in increasing power and decreasing immediacy:

1. **Analytics Engine (`usage` counters)** — the **live MVP query path**, queryable today via the Analytics Engine SQL API. Retention **~90 days** (current; treat as verify-at-build, not a fixed guarantee); adaptive (ABR) sampling engages only at high index volume — irrelevant at beta scale, and the `_sample_interval` column lets queries weight correctly when it does. This layer holds **aggregate totals only** (`feature × phase × surface`, all bounded low-cardinality) and carries **no hashes**, so it has **no per-firm or per-user cardinality** — small-n suppression is therefore **not computable here and does not apply**; instead the rule is that **AE counts must never be exposed at single-firm granularity** (never filter an AE query down to one firm). Per-firm/per-user analysis comes from layer 2 only.

2. **Full-fidelity rows in R2 Iceberg, via Logpush → Pipelines.** The path ADR-0056 anticipated, updated to current Cloudflare reality:
   - **Logpush (Workers trace events)** carries the structured `console.log` output (including `usage.feature` rows) to **Cloudflare Pipelines**.
   - **Pipelines** runs **in-flight SQL** to filter to `name = 'usage.feature'` and project the allowlisted columns, writing **Apache Iceberg tables in Parquet** (Parquet is required for automatic compaction — do not use the JSON sink) managed by **R2 Data Catalog**, partitioned by **date** (and `feature`). Pipelines is available on Free/Paid (see Build gates).
   - **Query** with **DuckDB / PyIceberg / Spark / Trino** over the R2 Data Catalog REST URI, authenticated by an R2 API token holding **both R2 and catalog permissions**, at **zero R2 egress**.

3. **Maintenance — automated by Cloudflare.** Since ADR-0056 was written, Cloudflare automated the parts that were manual:
   - **Compaction** — automatic when enabled (combines small Parquet files; ~2 GB **per table** per hour during beta — ample at our volume).
   - **Snapshot expiration** — automatic against a configured retention policy (`--older-than-days`, `--retain-last`), and **as of April 2026 it also removes the data files no longer referenced by retained snapshots**, so routine data-file cleanup is automatic. True orphan files (never referenced by any snapshot, e.g. from a failed write) are still not garbage-collected, but are negligible at beta volume — **no manual orphan-cleanup Workflow is built** (deferred indefinitely; revisit only if R2 Data Catalog metrics, exposed via the GraphQL Analytics API, show meaningful waste).

**Reporting now = canonical builder queries + small-n suppression.** A documented set of DuckDB-over-the-catalog queries is the builder-facing surface (no dashboard yet), operating on layer 2:

- **Dead-feature** — `feature`s with zero distinct `userIdHash` over a window.
- **Funnel drop-off** — `reached` vs `completed` per `feature` (firm-level, since `completed` is firm-attributed).
- **Retention** — distinct `userIdHash` per `feature` per week.

Every layer-2 query applies **small-n suppression** (k-anonymity): drop any cell computed from fewer than **k = 5** distinct firms (and, for user-level metrics, fewer than 5 distinct `userIdHash`), so a metric can never re-identify a tiny firm. The threshold is a documented constant in the canonical-query definitions; suppression is logged (the rule against silent caps).

## 7. Module placement & files

| Concern                                                                                                            | Home                                                                                   | Note                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `usage.feature` builder + `EVENT_NAMES` entry                                                                      | `packages/telemetry/src/events.ts`                                                     | One new `defineEvent`; uniqueness fitness auto-covers it.                                                     |
| Feature taxonomy registry                                                                                          | `packages/telemetry/src/` (new module)                                                 | String literals only; no domain dependency.                                                                   |
| Pseudonymous-hash helper (HMAC)                                                                                    | `packages/telemetry/src/` (new)                                                        | Pure; pepper injected; fail-closed on missing pepper.                                                         |
| `usage_analytics.enabled` firm setting                                                                             | `packages/data-access/src/setting-statements.ts` (definition)                          | Default `true`; read via `readFirmSetting`.                                                                   |
| `usage_analytics.optedOut` member-row field + migration                                                            | `packages/database` (schema + migration)                                               | A member-row field, per the white paper's member-row settings home — **not** a new table.                     |
| `firm:recordUsage` permission                                                                                      | `packages/access-control/src/registry.ts`                                              | New literal in `PERMISSIONS`; `assertPermission` validates. `firm` namespace already maps to `firm` resource. |
| Consent-resolution + `reached` emit (outbound pass) + isolate-local firm cache                                     | `apps/worker/src/telemetry-middleware.ts`                                              | After `await next()`, reading `requireChokepointFirmContext`; emit nothing when absent.                       |
| `completed` emit (topic→feature)                                                                                   | `apps/worker/src/scheduled.ts` (outbox relay publish path)                             | Branch on `row.topic`; firm-level; at-least-once.                                                             |
| `POST /v1/usage` beacon                                                                                            | `apps/worker/src/routes/usage.ts` (new) + `app.ts` registration + OpenAPI/client regen | Modelled on `routes/platform/incidents.ts`; `feature` is a taxonomy-derived zod enum.                         |
| Pepper secret                                                                                                      | `apps/worker` (`USAGE_ANALYTICS_PEPPER` via Secrets Store/wrangler secret)             | Read at each emit site.                                                                                       |
| Logpush job, Pipeline (SQL + Iceberg/Parquet sink), Data Catalog table, automated compaction + snapshot expiration | `apps/worker/wrangler.jsonc` + Cloudflare config                                       | No Container/Cron maintenance Workflow needed.                                                                |

## 8. Fitness functions & testing

- **No new console-ban work** — `usage.feature` emits through `logger.log`/`logger.count`; the existing console-ban fitness already covers it.
- **Taxonomy fitness** — every `feature` the route map, topic map, and beacon enum reference resolves to a registered key (no orphan mappings).
- **Consent tests** — emit suppressed when `firm.enabled = false` OR `member.optedOut = true`; emitted only when both allow; no event on public/unauthenticated routes; the effective consent is resolved at most once per `(firm, user)` pair per TTL (cache-hit asserted); both firm disable and per-user opt-out take effect within one TTL (≤ 60 s).
- **Builder tests** — `usage.feature` carries exactly its allowlist; forced-in fields are stripped at runtime (the existing `event.test.ts` pattern); server-derived events pass `null` for `appVersion`/`surface` and (for `completed`) `userIdHash`, and still type-check.
- **Hash helper** — deterministic, pepper-dependent; **missing pepper suppresses the event** (fail-closed assertion).
- **Beacon tests** — taxonomy enum rejects unknown `feature` (reject-all); consent gate respected at receipt; 202 response; OpenAPI snapshot updated; rate-limit bucket present.
- **Small-n suppression** — pure unit test: layer-2 cells below `k` are dropped and the drop is reported; an AE query is never shaped to a single firm.
- **Load-profile accretion (ADR-0083)** — the `reached`-on-every-request emission and the outbound-pass consent resolution are bound by the matters/files volume profile when it lands (this is exactly the kind of hot-path accretion that profile measures).

## 9. Cost (operating-costs additions)

- **Cloudflare Pipelines** — Free includes **1 GB/month** ingest+processing; Paid includes **50 GB/month**; usage-priced beyond. Beta volume is expected within Free.
- **R2 Data Catalog** — no base charge in beta; **compaction** priced at **$0.005/GB processed + $2.00/million objects processed**.
- **R2 storage** for the Iceberg tables (small; redacted aggregate rows) + Analytics Engine writes (counters, existing dataset).

These land as rows in `docs/operating-costs.md` (the Pipelines free/paid allowance under active/committed; the per-GB compaction under usage rates).

## 10. Decisions recorded & docs to update (same commit — golden rule 5)

- **New decision fragment** `docs/decisions/pending/usage-analytics.md` (referenced as `ADR-0106`; numbered at merge by `vp run decisions-build`) — product-usage analytics tier (the scope, opt-out posture, event model, AE + Iceberg split).
- **Amend ADR-0056** in its per-file record — _deferred_ → _adopted (realized by `ADR-0106`)_; path updated to **Logpush → Pipelines → R2 Data Catalog**; note the maturity update (compaction + snapshot expiration, incl. data-file cleanup, now automated; AE retention ~90 days as of 2026-06). The register regenerates from the per-file records.
- **White paper** — add a subsection **_Product-usage analytics_** under _Observability and diagnostics_ (the usage event category, opt-out consent, aggregate-only + small-n, shared path/Iceberg tier); amend the **_Telemetry analytics tier_** subsection from "deferred / designed-but-unbuilt" to "built," correcting the stale facts (Parquet-only → Parquet via Pipelines, JSON also available; "~92-day" → "~90-day, verify current"; compaction + data-file cleanup now automated).
- **ROADMAP.md / STATUS.md / changelog fragment** — the usual rows (a new slice row in STATUS; an `Added` changelog fragment in `changelog.d/`; a ROADMAP narrative entry under the appropriate phase).
- **`docs/operating-costs.md`** — the cost rows in §9.
- **User-facing docs** — scaffold `docs/user/admin/` "what we measure" + the usage-analytics opt-out setting, authored when the settings UI ships (deferred with the diagnostics-settings UI to slice 0·7b; placeholder noted now).
- **Per-area `CLAUDE.md`** — note in `packages/telemetry` that usage analytics is opt-out, per-firm + per-user override, resolved at emit time, hashes fail-closed on missing pepper.

## 11. Build sequencing — ordered sub-slices

The work decomposes into independent sub-slices; **A–E deliver a working MVP on the Analytics Engine query path**, and **F (the Iceberg/Pipelines tier) ships later without blocking them**. The migration in B runs before any code reads the new setting/field.

- **A — Event foundation:** the `usage.feature` builder + `EVENT_NAMES` entry, the feature taxonomy registry, the HMAC hash helper (fail-closed) + `USAGE_ANALYTICS_PEPPER`, and their fitness/unit tests.
- **B — Consent (migration first):** the `usage_analytics.enabled` firm-setting definition, the `usage_analytics.optedOut` member-row field + migration, and the cached outbound-pass resolver.
- **C — Emit sites:** server-side `reached` (route→feature, outbound pass) and outbox-relay `completed` (topic→feature).
- **D — Beacon:** `POST /v1/usage` + the `firm:recordUsage` permission + taxonomy-derived zod enum + OpenAPI/client regen.
- **E — Live reporting:** the AE `usage` counters + the canonical DuckDB query set + small-n suppression (queries run against layer 2 once F lands; against AE for aggregate totals immediately).
- **F — Iceberg/Pipelines tier:** Logpush → Pipelines (SQL filter, Parquet/Iceberg sink) → R2 Data Catalog, with automated compaction + snapshot expiration. Gated only on confirming the Pipelines volume budget; buildable after A–E.

**Seam now, build later:** retention rollups (the `userIdHash` is emitted now; the curves are a later Iceberg query); user-level `completed` attribution (needs an actor field in specific outbox payloads); per-firm compute/activity dimensions (the credentialed Cloudflare Analytics-API seam shared with ADR-0103); a per-firm topic-dispatching consumer (moves `completed` off the at-least-once relay path for exactness); a builder-facing dashboard UI; the diagnostics-settings UI that surfaces the opt-out toggle (slice 0·7b).

## 12. Open risks (verify-before-build — open-beta posture)

- **Pipelines + R2 Data Catalog are in open beta.** Compaction throughput (~2 GB per table per hour), snapshot-expiration cleanup behavior, and the Parquet-for-compaction constraint are current-as-of-2026-06 facts; re-verify at build time, the same provisional posture as the in-house PDF services design.
- **Pipelines volume budget** — confirm beta volume fits the Free 1 GB/month allowance (or that the account is on Paid) before wiring the Logpush→Pipelines leg.
- **Analytics Engine retention** — stated as ~90 days; verify the exact current value before enshrining it in the white-paper amendment (word the amendment as "~90 days as of 2026-06").
- **Pepper management** — the HMAC pepper must be stable for retention continuity and secret; losing or rotating it breaks longitudinal joins, and a missing pepper fails closed (no events). Treat as a long-lived no-rotate secret (or a versioned-pepper scheme if rotation is ever forced).
- **Hot-path accretion** — `reached`-on-every-request adds one cached consent check + one counter write per request on the outbound pass; bind it under the load-profile harness when the volume profile lands before assuming it is free.
- **Completion exactness** — `completed` is at-least-once and firm-level by design; if a feature ever needs exact or user-attributed completion, it requires the per-firm consumer and/or an actor field (both seamed above), not a change to this tier.
