---
category: Added
---

**Release channels — backend rails** (spec [`docs/specs/2026-06-25-release-channels-design.md`](docs/specs/2026-06-25-release-channels-design.md)): the complete backend mechanism for a firm to run pre-release behavior, proven end-to-end by a throwaway smoke flag (`release-channels.smoke`).

**Model.** `firm.release_channel TEXT NOT NULL DEFAULT 'stable'` on the control-plane `firm` table — a single additive expand-contract migration. Nesting `alpha ⊇ beta ⊇ stable`: an alpha firm sees everything beta sees. Channel is a firm property; every member of a firm shares one channel.

**Two doors to one column.** The column has two write paths with distinct trust boundaries:

- **Beta firm endpoint** (`PUT /api/v1/firm/release-channel`): accepts only `{ stable, beta }`; backed by the new RBAC permission `firm:manageReleaseChannel` (seeded to Owner/Admin), enforced server-side in the firm-scoped data-access layer. Requires an explicit consent acknowledgment in the request body (who, when, the exact text/version) recorded in the per-firm `audit_log` (event `firm.release_channel_changed`). Leaving beta needs no consent.
- **Alpha secret-guarded platform endpoint**: writes any channel value including `alpha`; same trust lane as `firm:provision`. Audit home is the control-plane `auth_audit` (event `firm.release_channel_set_alpha`, `user_id` null), metadata `{ firmId, oldChannel, newChannel }`.

**`@magna-carta/feature-flags`.** New package: thin wrapper over the Cloudflare Flagship `env.FLAGS` Worker binding. Exports `FLAG_CATALOG` (all declared feature flags, each with a `stage: alpha | beta | stable`), `getBooleanValue(flagKey, default, context)`, `evaluateCatalog(flagKeys, context)`, and evaluation-context builder. The native Flagship binding evaluates flags with no outbound HTTP (off the request hot path). Every evaluation supplies a default equal to stable behavior — a Flagship outage or missing flag is invisible to users. Local Miniflare: the optional binding declaration means the binding is absent in tests; `resolveFlagEvaluator` falls back to `defaultOffEvaluator` (all flags off) automatically.

**Session and `/me`.** Session context reads `release_channel` from the control-plane `firm` row per request and builds the evaluation context `{ firmId, channel, role, userId }`. The `/me` response now delivers the resolved flag set for the current session alongside the existing permissions payload, so the SPA can gate UI without a second round-trip.

**Proof.** One throwaway boolean flag (`release-channels.smoke`) is wired through the full stack — catalog entry, API route that returns its value, worker integration test asserting the channel drives the flag outcome. The flag is retained as the reference example; real features adopt the rails as they ship.

**Decisions recorded** as pending ADR fragments (`docs/decisions/pending/release-channels-flagship.md`, `docs/decisions/pending/release-channels-gate-behavior-not-schema.md`), numbered at merge.

**Deferred (Plan 2).** Beta opt-in Settings UI + explicit consent dialog; one product UI element gated on the throwaway flag; stage-labeled alpha/beta visibility markers + feedback affordance on pre-stable features.
