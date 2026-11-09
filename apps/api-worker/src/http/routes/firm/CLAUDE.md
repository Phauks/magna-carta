# api-worker routes/firm — CLAUDE.md

**Purpose.** The firm's settings tier — profile, the per-domain policies (notification, report, time, AI, scan, editing, auto-file, download), numbering, custom fields, the classification types, and the beta release-channel door. One domain module of the Worker's route tree: `index.ts` mounts every file here as one sub-app, `operations.ts` is the committed list of what it registers, and the rules below are this surface's own. The Worker-wide rules (the chokepoint, the seam, the fitness tests) are in [`../../../CLAUDE.md`](../../../../CLAUDE.md); the design is [`docs/specs/2026-09-18-api-worker-domain-modules-design.md`](../../../../../../docs/specs/2026-09-18-api-worker-domain-modules-design.md).

## Firm scan-policy settings API

`src/http/routes/firm/scan-policy.ts` exposes `GET /api/v1/firm/scan-policy` (returns the resolved `{scanPolicy, flaggedTreatment, stepUpReauthOnFlagged}`) and `PATCH /api/v1/firm/scan-policy` (writes any subset). Both require `firm:manageScanPolicy` (Owner + Admin). The route reads/writes via the `scan-policy-settings.ts` helpers in `@magna-carta/file-manager`; the ingest consumer (`src/files/`) calls those same helpers at queue-consume time, so ingest and the API always agree on defaults. The `downloads.ts` route reads `flaggedTreatment` at access time — a policy change takes effect on the next request without re-ingest.

## Release channels — the two doors and the flag catalog

A firm's `release_channel` (`stable | beta | alpha`) is stored on the control-plane `firm` row and is read into every session. Two routes write it:

- **Beta door:** `PUT /api/v1/firm/release-channel` — accepts only `{ stable, beta }`; backed by `firm:manageReleaseChannel` enforced at the chokepoint; requires an explicit consent payload recorded in the per-firm `audit_log`.
- **Alpha door:** a secret-guarded platform endpoint (same lane as `POST /v1/firms`); writes any channel value; no firm-session required; audit goes to the control-plane `auth_audit`.

**Adding a feature flag.** To gate a new feature behind a release channel:

1. Add an entry to `FLAG_CATALOG` in `@magna-carta/feature-flags` — keyed by the flag key, with `defaultValue` (the safe default = stable behavior), `stage: "alpha" | "beta" | "stable"`, and a `description`.
2. Add a matching boolean flag in the Flagship dashboard with a targeting rule: `channel in [beta, alpha]` (or `[alpha]` for alpha-only), optionally with a `%` rollout.
3. Call `getBooleanValue(flagKey, false, context)` (or `evaluateCatalog`) in the route or session handler. Stable behavior is always the default — the second argument must equal what a `stable` firm would see.

**The `FLAGS` binding is a production deploy-time wiring step.** The local Miniflare test pool does not support the Flagship binding shape. The `env.FLAGS` binding is declared **optional** in `wrangler.jsonc`; when absent, `resolveFlagEvaluator` returns the `defaultOffEvaluator` (all flags off, the safe stable default). Tests that need a specific flag on inject a `FlagEvaluator` fake directly — no Flagship account required. This means the fail-safe is structural: any test environment or local dev session silently sees stable behavior for every flag unless a fake is injected.
