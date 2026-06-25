# Release Channels — design

**Date:** 2026-06-25
**Status:** Design (approved in brainstorming; not yet planned or built).
**Scope (single home for):** how a firm runs pre-release behavior — the `stable / beta / alpha` channel model, who may change it, how the channel resolves into feature exposure via Cloudflare Flagship behind an OpenFeature-shaped port, and how the resolved flag set reaches the SPA.
**Authoritative context:** the white paper's _Delivery model_ and _Tenancy & data isolation_; the settings framework (`docs/conventions/settings.md`); the fleet-migration model (`packages/database/src/fleet-rollout.ts`).

## Why

The firm wants a way to expose unfinished work to willing audiences before it reaches everyone — to de-risk releases (catch defects in the wild), reward engaged firms with early access, dogfood internally, and gather feedback on intentionally-rough features. The same mechanism serves all four.

The platform is deliberately built as **one fleet, one schema**: `fleet-rollout.ts` marches every firm's database to the *latest* migration, and the control plane mirrors a single `per_firm_schema_version`. That is a correctness property — it keeps a firm's trust ledger from ever running unvetted code against real money. Any channel system must respect it.

## Core principle — channels gate behavior, never schema

A channel changes **which behavior is lit**, never which backend code paths exist and never the database schema.

- **Schema stays the single additive fleet union.** New features' columns and tables land in the one fleet schema up front — additive, nullable, unused until lit. No per-firm schema divergence, ever.
- **Backend feature code ships dark to the whole fleet** — deployed everywhere, gated off by a flag. (Already this team's habit: build seams and schema columns up front, ADR-0078.)
- **A channel is one firm attribute plus a set of targeting rules.** The channel decides which flags evaluate "on"; the flags gate behavior on both the API and the UI.

The rare change that genuinely cannot hide behind an additive flag — a destructive migration, a breaking API-contract change — does **not** get a channel. It goes through the normal careful fleet rollout. Genuine backend experimentation (unmerged, possibly-destructive code) lives in a separate staging deployment with throwaway firms, which is ordinary CI/CD, not a tenant-facing channel.

## Model

One firm-level attribute: `firm.release_channel ∈ { stable, beta, alpha }`, with nesting **alpha ⊇ beta ⊇ stable** — an alpha firm also sees everything beta sees. Channel is a property of the **firm**, not the user: every member of a firm shares one channel. (Per-user channels are rejected — see _Alternatives_.)

Default is `stable`. The column is `release_channel TEXT NOT NULL DEFAULT 'stable'` on the control-plane `firm` table — the single source of truth, alongside `status`, `per_firm_schema_version`, and `owner_user_id`. Added by an expand-contract control-plane migration.

## Two doors to one column

The channel value has two distinct write paths with different trust boundaries; both write `firm.release_channel`.

### Beta — firm self-serve

- A new RBAC permission `firm:manageReleaseChannel` (seeded to Owner / firm admin), enforced **server-side in the firm-scoped data-access layer** — never the UI alone.
- Surfaced through the existing Settings registry as a firm-scoped, **audited** setting whose allowed values are restricted to `{ stable, beta }`. The firm-facing write path **rejects `alpha`**, so the alpha boundary is enforced by *which door is used*, not by per-value RBAC (which the settings framework's per-setting `editRole` cannot express).
- **Explicit recorded consent gate.** Opting a legal firm's live data onto pre-release software is not a silent toggle: the admin must acknowledge an explicit "I understand this firm will run pre-release features on live data" statement, and that acknowledgment (who, when, the exact text/version) is recorded in the audit trail alongside the channel change. Leaving beta (back to stable) needs no consent.

### Alpha — developer-only

- Set or cleared only through a **secret-guarded platform endpoint**, the same trust lane as `firm:provision` (the platform has no staff-RBAC identity today; platform actions are secret-guarded). Not reachable from any firm-facing surface.
- The firm's own team dogfoods by pinning **dedicated internal firms** to alpha. Real client firms reach alpha only by a deliberate developer grant.

Both writes are audited: old → new channel, actor, timestamp, and (for beta) the consent acknowledgment.

## Resolution & Flagship

### The port

A new package `@magna-carta/feature-flags` exposes an **OpenFeature-shaped port** — a thin interface (`getBooleanValue(flagKey, default, context)` and typed siblings) that call sites use without knowing the provider.

- **Adapter 1 (v1 provider): Cloudflare Flagship**, via the `env.FLAGS` Worker binding. Flags evaluate inside the Worker against KV + Durable Objects with **no outbound HTTP** — off the request hot path by construction (golden rule 10). Flagship supports custom targeting attributes, nested AND/OR rules, percentage rollout with consistent hashing, typed variants, and audit history.
- **Adapter 2 (seam): in-house D1-backed** fallback. Not built in v1, but the port exists so the provider is swappable. This neutralizes both Flagship's public-beta maturity risk and any vendor lock-in (OpenFeature is a portable standard).

### Evaluation context

Session context already loads the firm per request. We read `release_channel` and build the evaluation context:

```
{ firmId, channel, role, userId }
```

Only non-privileged identifiers travel to the flag provider — never firm content. (Flagship's own guidance: keep sensitive data out of evaluation context.)

### Safe defaults — fail-safe

**Every evaluation supplies a default equal to stable behavior (feature off).** If Flagship is unreachable or a flag is missing, the default wins and the firm transparently sees stable. A flag service outage can never expose unfinished behavior or break a firm.

### Per-feature convention

Each gated feature is one boolean flag in Flagship with a standard targeting rule: *serve `on` when `channel in [beta, alpha]`* (or `[alpha]` for alpha-only), optionally with a `% rollout` to ramp within a channel for staged de-risking. Flipping exposure is a dashboard change — no deploy.

## Frontend

One SPA bundle for all channels. The resolved flag set for the current session is delivered to the client through the existing `/me` bootstrap response; UI gates on it. **No per-channel static bundles in v1** — kept as a seam for a future genuinely-incompatible UI rewrite.

## v1 scope — the rails, not the features

v1 ships the **complete mechanism with zero product features gated**, proven end-to-end by one trivial throwaway flag:

1. `firm.release_channel` column + control-plane migration.
2. `firm:manageReleaseChannel` permission + the beta firm-setting door (DAL + route + consent gate + audit).
3. The alpha secret-guarded platform door + audit.
4. `@magna-carta/feature-flags` port + Flagship adapter (+ `env.FLAGS` binding); in-house fallback adapter is a stubbed seam.
5. Session-context channel read; `/me` resolved-flag delivery.
6. One throwaway boolean flag wired through API + UI to prove the path, removed or left as the reference example.

Real features adopt the rails as they ship. This is the YAGNI-correct first slice: build the expensive-to-retrofit seam now, gate nothing speculative.

## Audit & docs

- Channel changes audited through both doors (actor, old → new, timestamp; beta carries the consent acknowledgment).
- New ADR(s): (a) adopt Cloudflare Flagship behind an OpenFeature-shaped port; (b) release channels gate behavior, not schema.
- New white-paper topic _Release channels_.
- User-facing help for the beta opt-in (its consequences and how to leave).
- ROADMAP / CHANGELOG fragments per the documentation golden rule.

## Alternatives considered

- **Full-stack channels** (forked backend code + ahead-of-stable migrations per cohort). Rejected: breaks the single-fleet model; ahead-of-stable migrations on live financial data are near-irreversible if the design changes before stabilizing; needs a hand-rolled cohort router because Cloudflare gradual deployments are percentage-based, not cohort-pinned. Disproportionate, permanent ops weight for a benefit flags already deliver.
- **In-house feature-flag engine from scratch.** Rejected for v1: targeting, gradual rollout, audit, and a management dashboard are real work; Flagship-behind-a-port delivers them at near-zero cost and stays portable. Kept as the fallback adapter so the dependency is never load-bearing.
- **Per-user alpha** (a user-level channel overriding the firm's). Rejected: mixed channels inside one firm let an alpha user write data — including audit and ledger entries — through in-progress code that stable colleagues then see with no UI, an integrity and audit hazard in a legal platform. "Invite one person" is served instead by internal alpha firms, or (if ever needed) a single-`userId` allowlist on one specific flag — explicitly out of v1.
- **Per-channel SPA bundles.** Deferred to a seam: unnecessary once flags gate UI within a single bundle.

## Open questions / deferred seams

- In-house D1-backed flag adapter — built only if Flagship maturity or terms ever require leaving it.
- Per-feature single-user early-access (Flagship `userId` allowlist) — out of v1; revisit if a real champion-at-a-client-firm need appears.
- Per-channel SPA bundle — only for a future incompatible UI rewrite.
- Whether a real platform-staff RBAC identity should eventually replace the secret-guarded alpha door (tracks with any broader platform-admin-identity work).
