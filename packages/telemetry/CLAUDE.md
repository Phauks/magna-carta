# @magna-carta/telemetry — local notes

**Purpose.** The platform's event-emission and observability foundation — allowlist event builders, scrubbing backstop, correlation/error IDs, the Logger seam, and the `usage.feature` product-usage analytics path. No Svelte, no Hono routes; depends only on `@magna-carta/identifiers` and the `env` binding types.

**White paper:** _Observability and diagnostics_ — [`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). Design and rationale live there; cross-cutting error-logging standards live in [`docs/conventions/error-logging.md`](../../docs/conventions/error-logging.md).

## Key files / entry points

- `src/` — allowlist event builders, the scrubbing backstop, correlation/error-ID generators, the Logger seam, and the `usage.feature` event category with its feature taxonomy.

## Local conventions

- Every event goes through the allowlist — no ad-hoc telemetry writes. The console-ban fitness function (`test/`) rejects `console.*` calls outside the Logger seam.
- The `usage.feature` event carries `{ feature, phase, surface }` only — no content, no matter IDs, no party names. The event body must stay content-free.
- Feature strings come from the taxonomy in `src/` (e.g. `@magna-carta/telemetry/usage-features`). Unknown feature strings fail at build time via the allowlist; do not inline literals.

## Invariants that apply here

- **Opt-out, not opt-in.** Usage analytics is always-on per firm (`usage_analytics.enabled` default `true`) with a per-user escape hatch (`member.opted_out_of_usage_analytics`). Both flags are resolved at emit time, off the hot path (cached consent resolver); a missing or erroring resolver suppresses the event (fail-closed), never emits it.
- **HMAC pseudonymization, fail-closed on a missing pepper.** `firmId` and `userId` are HMAC-pseudonymized under `USAGE_ANALYTICS_PEPPER` before emission. If the pepper secret is absent, the event is **dropped entirely** — no plaintext identifiers ever reach the Analytics Engine dataset. Wiring a new environment requires the pepper secret; verify it is in the secrets inventory before deploying.
- **Cross-firm aggregate only.** The Analytics Engine `usage` dataset carries no per-firm or per-user cardinality. Queries over it are aggregate totals; per-firm/per-user analytics run only over the Iceberg tier (the deferred Logpush→Pipelines path) with small-n suppression (`k = 5`). Never filter the Analytics Engine dataset to a single firm.
- **Redact by default.** The same redaction discipline as every other telemetry event applies here — see [`docs/conventions/error-logging.md`](../../docs/conventions/error-logging.md). Privileged content (matter IDs, party names, document titles) must never appear in a usage event.

## Dependencies & contracts

- Emits to Cloudflare **Analytics Engine** (`env.ANALYTICS`). The `usage` dataset name and the blob-slot layout (`blob1="usage"`, `blob2=feature`, `blob3=phase`, `blob4=surface`, `double1=1`) are the stable contract — changing them breaks the canonical queries in [`docs/analytics/usage-queries.md`](../../docs/analytics/usage-queries.md).
- The consent resolver reads `usage_analytics.enabled` (per-firm D1 `setting`) and `member.opted_out_of_usage_analytics` (per-firm D1 `member` row) via the firm-scoped data-access layer.
- The server-side `reached` emitter is wired in the route→feature middleware; `completed` is emitted from the outbox sweep (topic→feature, firm-level). The client beacon for pure-client surfaces is a **documented seam** — not yet built (deferred until there is client traffic).

## Gotchas

- The pepper (`USAGE_ANALYTICS_PEPPER`) must be present in every environment that should emit usage events. A missing pepper is a silent drop (fail-closed by design), so missing events in a new environment almost always mean a missing secret.
- The `completed` event is firm-level (attributed via the outbox sweep), not user-level. Do not attempt to carry a `userId` on `completed`.
- Analytics Engine retention is ~90 days (verify current with Cloudflare docs before relying on a specific figure). For longer-horizon or exact-count queries, use the Iceberg tier once the Logpush→Pipelines step is provisioned.
