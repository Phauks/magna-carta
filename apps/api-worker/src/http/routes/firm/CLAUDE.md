# api-worker routes/firm — CLAUDE.md

**Purpose.** The firm's settings tier — profile, the per-domain policies (notification, report, time, AI, scan, editing, auto-file, download), numbering, custom fields, the classification types, and the beta release-channel door. One domain module of the Worker's route tree: `index.ts` mounts every file here as one sub-app, `operations.ts` is the committed list of what it registers, and the rules below are this surface's own. The Worker-wide rules (the chokepoint, the seam, the fitness tests) are in [`../../../CLAUDE.md`](../../../../CLAUDE.md); the design is [`docs/specs/2026-09-18-api-worker-domain-modules-design.md`](../../../../../../docs/specs/2026-09-18-api-worker-domain-modules-design.md).

## Firm scan-policy settings API

`src/http/routes/firm/scan-policy.ts` exposes `GET /api/v1/firm/scan-policy` (returns the resolved `{scanPolicy, flaggedTreatment, stepUpReauthOnFlagged}`) and `PATCH /api/v1/firm/scan-policy` (writes any subset). Both require `firm:manageScanPolicy` (Admin). The route reads/writes via the `scan-policy-settings.ts` helpers in `@magna-carta/file-manager`; the ingest consumer (`src/files/`) calls those same helpers at queue-consume time, so ingest and the API always agree on defaults. The `downloads.ts` route reads `flaggedTreatment` at access time — a policy change takes effect on the next request without re-ingest.

## Release channels — the two doors and the flag catalog

A firm's `release_channel` (`stable | beta | alpha`) is stored on the control-plane `firm` row and is read into every session. Two routes write it:

- **Beta door:** `PUT /api/v1/firm/release-channel` — accepts only `{ stable, beta }`; backed by `firm:manageReleaseChannel` enforced at the chokepoint; requires an explicit consent payload recorded in the per-firm `audit_log`.
- **Alpha door:** a secret-guarded platform endpoint (same lane as `POST /v1/firms`); writes any channel value; no firm-session required; audit goes to the control-plane `auth_audit`.

**Adding a feature flag.** To gate a new feature behind a release channel:

1. Add an entry to `FLAG_CATALOG` in `@magna-carta/feature-flags` — keyed by the flag key, with `defaultValue` (the safe default = stable behavior), `stage: "alpha" | "beta" | "stable"`, and a `description`.
2. Add a matching boolean flag in the Flagship dashboard with a targeting rule: `channel in [beta, alpha]` (or `[alpha]` for alpha-only), optionally with a `%` rollout.
3. Call `getBooleanValue(flagKey, false, context)` (or `evaluateCatalog`) in the route or session handler. Stable behavior is always the default — the second argument must equal what a `stable` firm would see.

**The `FLAGS` binding is a production deploy-time wiring step.** The local Miniflare test pool does not support the Flagship binding shape. The `env.FLAGS` binding is declared **optional** in `wrangler.jsonc`; when absent, `resolveFlagEvaluator` returns the `defaultOffEvaluator` (all flags off, the safe stable default). Tests that need a specific flag on inject a `FlagEvaluator` fake directly — no Flagship account required. This means the fail-safe is structural: any test environment or local dev session silently sees stable behavior for every flag unless a fake is injected.

## Firm search settings — the one writer of the file indexing switch

`src/http/routes/firm/search-settings.ts` exposes `GET` and `PATCH /api/v1/firm/search-settings`, both behind `firm:manageSearchSettings` (Owner/Admin by seed). The body is `{ fileContentsIndexed, searchServiceConnected }`. The first is the firm's `search.indexing_enabled` setting (`@magna-carta/search/settings`), which the ingest path reads before it enqueues a file and a matter's search reads before it asks the index; this route is its only writer. The second is read-only and is whether `SEARCH_SERVICE` is bound in this deployment, so the settings page can say that nothing inside a file is searchable yet.

- **Off to on starts a bounded walk of the firm's existing files**, off the response path through `runInBackground`, using `src/search/index-backlog.ts` (the same walk the daily re-extraction sweep runs with a larger budget). It is a latency improvement only: the sweep remains what draws in a back catalogue. Keep its budget small — it runs on the tail of one request.
- **The idempotency record holds the whole answer.** The chokepoint replays the stored body itself, so a body composed after the effect would be missing from a replay.

## Firm search status — what the indexes hold, counted when asked

`src/http/routes/firm/search-status.ts` exposes `GET /api/v1/firm/search-status` behind the same `firm:manageSearchSettings`. It answers the plates beneath the switch on the settings page: for each record index source, the rows the index holds and the records that belong in it (`readRecordIndexPlaces`, `@magna-carta/search/record-index-statements`); the files the file contents index holds out of those that belong in it (`readSearchIndexCoverage`, `@magna-carta/file-manager/queries`); the two firm switches; and whether each service is bound.

- **Nothing is stored and nothing is estimated.** Every figure is a count made during the request. Do not add a cached or remembered figure: a status that reports a stored number reports the last time something updated it.
- **It reads every indexed record and every live file once**, so it is for a page a person opened. Do not call it from a poll, a sweep or another route.
- **No review-set figure, on purpose.** Each review set's index is its own corpus behind that set's access list (`packages/discovery/test/review-set-visibility-fitness.test.ts`); a firm-wide total here would be a read across it by a settings permission.
- **No write.** A rebuild is work in proportion to the place rebuilt and belongs on a queue; this route only shows when one is needed.
