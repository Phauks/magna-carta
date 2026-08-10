# claude/self-serve-tier-design

**Scope:** Design only — self-serve firm registration, a free evaluation tier, entitlement enforcement,
and the reaping of abandoned tenants. Spec plus a decision fragment and a changelog fragment.
**No product code, no migrations, no schema edits in this stream.**

Owner ask (2026-08-10, verbatim): _"firm creation can happen through here, but not in this current model.
i don't mind allowing a small free tier to allow usage in order to showcase. in that way, we could have a
small file usage and lock out certain functionality. so firm registration can happen here, but firm
escalation to a full fledged tier would happen after an account is created."_

This moves tenancy from invite-only (a secret-gated platform endpoint on a fleet of ~1) to self-serve,
which is why it is a design rather than a build.

## Files this stream touches

Created, all new — no shared or generated file is edited:

- `docs/specs/2026-08-10-self-serve-firm-provisioning-and-entitlements.md`
- `docs/decisions/pending/self-serve-tier-and-entitlement-mask.md`
- `changelog.d/self-serve-tier-design.md`
- this note

Explicitly **not** touched: `CHANGELOG.md`, `STATUS.md`, `STATUS.json`, `ROADMAP.md`, the white paper,
`docs/conventions/`, `docs/Decision-Log.md`, `docs/operating-costs.md`, `roadmap.d/`, and every package
under `packages/` and `apps/`.

## Overlap watch

The design **reads** these surfaces and proposes additions to them in a later build stream. A concurrent
stream editing them should know what is coming; no edit is made here.

- `packages/database/src/control-plane-schema.ts` — proposes additive columns on `firm`
  (`display_name`, `entitlement_tier`, `verification_status`, `entitlement_paid_through`, the two opaque
  billing references, `last_activity_at`) and one new table (`firm_entitlement_override`). All additive,
  all defaulted so the existing fleet is unchanged. **It also proposes retiring the reliance on
  `UNIQUE(firm.name)` as the provisioner's resume identity** — the column keeps its constraint (dropping
  it would be a destructive rebuild); the human-facing name moves to `display_name`. Anyone changing the
  firm row should read section 2 of the spec first.
- `apps/worker/src/firm-provisioner.ts` — proposes changing the resume identity from the firm **name** to
  the firm **id** (the module's own comment already flags this: "revisit if firm creation ever becomes
  self-serve"). The orchestration itself is reused unchanged.
- `apps/worker/src/routes/firms.ts` — proposes a second, Turnstile-gated registration route beside the
  existing secret-gated `POST /v1/firms`, which is kept.
- `apps/worker/src/chokepoint/` — proposes that entitlement resolution ride the existing
  `loadPermissions` port and that the chokepoint gain one denial branch (402 beside the existing 403).
  **No new gate and no new ordering.** Anyone touching the chokepoint order should read section 4.
- `apps/worker/src/contracts/route-meta.ts` — proposes that the reserved `planTier` field be left
  permanently unpopulated (and argues for retiring it). This contradicts a reserved seam and is called
  out as such.
- `packages/access-control/` — proposes a new entitlement catalog module beside `registry.ts`, keyed by
  the **existing** permission strings. Nothing in the registry is renamed or removed.
- `apps/worker/src/scheduled.ts` — the fleet-wide per-firm cron loop is the real scaling constraint the
  spec identifies; the design proposes dormant firms drop out of `listReachableActiveFirms`. Read only
  here.
- `apps/worker/src/firm-key-shred.ts` — named as the destruction mechanism reaping uses. Unchanged.
- The parallel sign-in mockup stream — this design supplies the tier catalog its free-tier panel
  placeholders read from. The mockup owns its own files; nothing in `apps/web` is touched here.
