---
slug: release-channels-gate-behavior-not-schema
status: Accepted
area: Platform / Delivery
date: 2026-06-25
summary: Release channels gate behavior only, never schema; feature code ships dark to the single fleet; the one-fleet-one-schema model is a correctness invariant that channels must not break; beta is a firm self-serve door (RBAC + explicit recorded consent, rejects alpha); alpha is a secret-guarded platform door.
---

**Channels gate behavior, never schema.** The platform runs a single fleet: `fleet-rollout.ts` marches every firm's database to the _latest_ migration, and the control plane mirrors a single `per_firm_schema_version`. That is a correctness invariant — a firm's trust ledger must never run unvetted code against real money. Any feature-exposure mechanism must preserve it.

The answer this decision settles: **schema stays the single additive fleet union**. New features' columns and tables land in the one fleet schema up front — additive, nullable, unused until lit. Feature code ships dark to the entire fleet, gated off by a flag. A channel is one firm attribute (`firm.release_channel ∈ { stable, beta, alpha }`, stored on the control-plane `firm` table) plus flag-targeting rules. Changing a firm's channel changes which flags evaluate to `on`; it does not fork the schema, diverge migrations, or route to a different Worker build.

A change that genuinely cannot hide behind an additive flag — a destructive migration, a breaking API-contract change — does not get a channel. It goes through the normal, careful fleet rollout. Genuine pre-merge backend experimentation (unmerged, possibly-destructive code) lives in a separate staging deployment with throwaway firms, not in a tenant-facing channel.

**Nesting: alpha is a superset.** Alpha firms see everything beta sees: `alpha ⊇ beta ⊇ stable`. Channel is a firm property, not a per-user property — every member of a firm shares one channel. Per-user channel overrides are explicitly rejected: mixed channels inside one firm would let an alpha user write data — including audit and ledger entries — through in-progress code that stable colleagues then see with no UI, which is an integrity and audit hazard in a legal platform.

**Two doors to one column, with different trust boundaries.**

The `firm.release_channel` column has two write paths:

- **Beta door — firm self-serve.** A dedicated firm endpoint (`PUT /api/v1/firm/release-channel`) writes the control-plane `firm.release_channel` column directly — not the per-firm scoped-setting registry, which lives in each firm's own database. The endpoint accepts only `{ stable, beta }` and rejects `alpha`, so the alpha boundary is enforced by which door is used. A new RBAC permission `firm:manageReleaseChannel` (seeded to Owner / firm admin) is enforced server-side in the firm-scoped data-access layer. Opting into beta requires an **explicit recorded consent acknowledgment** — who, when, and the exact text/version — written to the per-firm `audit_log` alongside the channel change, event `firm.release_channel_changed`. Leaving beta (back to stable) requires no consent.

- **Alpha door — developer-only.** A secret-guarded platform endpoint writes `alpha` (or clears it). The same trust lane as `firm:provision` — no firm-facing surface can reach it. Dedicated internal firms are pinned to alpha for dogfooding; a real client firm reaches alpha only by deliberate developer grant. The audit home is the control-plane `auth_audit`, event `firm.release_channel_set_alpha`, `user_id` null (the same pattern as `firm.provisioned`), metadata `{ firmId, oldChannel, newChannel }`.

**Per-feature convention.** Each gated feature is one boolean flag in Flagship with a standard targeting rule: serve `on` when `channel in [beta, alpha]` (or `[alpha]` for alpha-only), optionally with a `% rollout` to ramp within a channel for staged de-risking. Flipping exposure is a Flagship dashboard change — no deploy. The `stage` field on each `FLAG_CATALOG` entry mirrors the targeting rule and drives the in-app alpha/beta stage-labeled visibility markers (the UI treatment is deferred to the frontend release-channels slice).

**Considered and rejected.** Per-channel SPA bundles (forked static assets per cohort) — deferred as a seam only for a future genuinely-incompatible UI rewrite; unnecessary once flags gate UI within a single bundle. Full-stack channels (forked backend code + ahead-of-stable migrations per cohort) — rejected: breaks the single-fleet model; ahead-of-stable migrations on live financial data are near-irreversible if the design changes before stabilizing. Per-user alpha — rejected: see the integrity hazard above; a champion-at-a-client-firm need is served by a single-`userId` allowlist on one specific flag, explicitly out of v1. Relates to _Tenancy and data isolation_ (the single-fleet constraint) and _Release channels_ (white paper) for the full rationale.
