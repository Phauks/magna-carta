# Slice 0·4 — auth, RBAC skeleton & firm provisioning — design

**Status:** Accepted (design) · **Date:** 2026-06-09 · **Owner:** Trevor Goldsmith
**White-paper home:** _Authentication, access control, and encryption_ · _Tenancy and data isolation_
**ADRs:** ADR-0004 (first-party auth) · ADR-0068 (access-control model) · **ADR-0073 (Better Auth integration shape & provisioning model — this slice's new decision)**

This spec is the implementation-grade design for slice 0·4 ([`ROADMAP.md`](../../ROADMAP.md)): Better Auth on control-plane D1, the per-firm `member` mirror, the RBAC skeleton, and the firm-provisioning flow. It does not restate the white paper's model (trusted-insider RBAC, firm-as-tenancy-unit, the member mirror) — it specifies what gets built, where it lives, and how it is tested.

**Scope decision made during design:** this slice is **backend + API only** — no login UI, which would otherwise drag the design-system bootstrap (Tailwind v4 + shadcn-svelte + tokens) into the slice. The auth UI is its own later slice and brings the design system with it.

---

## 1. Membership is invitation-only — no open signup

A law platform has no self-serve registration. Users come into existence exactly two ways:

1. As the **owner**, created during firm provisioning (§5).
2. Via the **admin invite endpoint** (`POST /v1/members`, requires `firm:manageMembers`).

This is load-bearing, not policy garnish: every user creation flows through **our** write path, which is what lets the member-mirror sync (§6) ride the outbox. Better Auth's own signup route is disabled; a fitness function asserts no unauthenticated user-creation route exists (§8).

## 2. Better Auth integration shape (ADR-0073)

- **Mount:** Better Auth in `apps/worker` at `/api/auth/*`, against **control-plane D1** via the Drizzle adapter.
- **No organization plugin.** It would put membership join tables in the control plane, contradicting the settled model (one `firm_id` per user; firm-scoped member data inside the isolation boundary — white paper, _Tenancy and data isolation_). Instead: `firm_id` as a Better Auth **additional field** on the user table, joined to the existing `firm` registry.
- **Identifier discipline:** user ids are `usr_` handles from `@magna-carta/identifiers` via Better Auth's custom-id hook (ADR-0062 — no parallel id scheme in the control plane).
- **Factors this slice:** email + password (Argon2id), email verification, password reset. Email delivery goes through a **`sendEmail` port with a dev stub** (logs the link locally); real transactional email arrives in slice 0·6 and swaps the adapter.
- **TOTP ships now** (Better Auth two-factor plugin): enable endpoint → secret/`otpauth://` URI; verify endpoint checks codes. The full enroll → login flow is exercisable API-only; integration tests generate valid codes from the secret. **Seed encryption:** Better Auth's built-in secret encryption for now (verify the current mechanism against Better Auth docs at build time — golden rule 11); upgraded to a field hook into the `protected()` crypto module when that lands (white paper, _Encryption and key management_, which names TOTP seeds the one exception to the chokepoint).
- **Passkeys are deferred to the auth UI slice — with reasoning recorded:** WebAuthn ceremonies require a browser (`navigator.credentials`); with no UI this slice, the plugin's routes and tables would land dead and unexercisable. Deferral costs one cheap later migration. Optional pull-forward if the slice finishes light: mount the server plugin and cover it with software-authenticator integration tests (synthetic credential signing the challenge in code); browser-faithful coverage (Playwright virtual authenticator) belongs to the UI slice regardless.
- **SMS factor:** out — depends on the unbuilt Communications layer (ADR-0047).
- **Auth audit:** an append-only `auth_audit` table (control-plane) records `login.success` / `login.failure` / `password.reset` / `twofactor.enabled` / `member.invited` / `firm.provisioned` (event, `user_id` nullable, request metadata, UTC instant). Written from Better Auth hooks and our endpoints; no privileged content, redaction discipline per ADR-0017/0038.

## 3. Schemas — both lineages, existing machinery (ADR-0065)

**Control-plane lineage** (`packages/database`, control-plane schema + migration):

- Better Auth's tables (`user`, `session`, `account`, `verification`, two-factor), expressed **in our Drizzle schema** as the source of truth, with a **schema-sync fitness test** asserting our definitions satisfy what the mounted Better Auth config expects (same pattern as data-access's schema-name-sync test). `user.firm_id` references the firm registry.
- `auth_audit` (§2).
- **`outbox` + `idempotency_key`** — same shapes as the per-firm pair (ADR-0063/0064); the control plane gains its own so the user-creating endpoints (§5, §6) ride the established idempotent-effect machinery rather than inventing a second consistency mechanism.
- `firm.status` column: `provisioning → active` (suspension states are a later seam). The existing `per_firm_schema_version` mirror keeps its role.

**Per-firm lineage:**

- `member` — keyed by the **global `user_id`** (white paper: the join key), carrying display name and (later) location/rate columns; location waits for the Locations entity.
- `role` (editable data, not enums), `role_permission` (role → permission key), `member_role`, `direct_grant` (member → permission key, optional `expires_at`, `granted_by`).
- The initial migration **seeds the five default roles** — Owner/Admin, Attorney, Paralegal, Billing, Read-only — with minimal permission sets that grow as subsystems register namespaces (ADR-0068).

## 4. `@magna-carta/access-control` — new package, pure

- The **permission registry**: the static, declarative list of `<subsystem>:<action>` keys, one namespace per subsystem. Starts tiny (`firm:manageMembers`, `firm:provision`) and grows with each subsystem slice.
- The **resolver**: `effectivePermissions(memberRoles, rolePermissions, directGrants, now)` — pure function over rows (expired grants excluded), no D1 dependency.
- Branded `Permission` type so an arbitrary string is not a permission without registry validation (the identifiers brand pattern).
- Consumed by `data-access` (which supplies the rows firm-scoped) now, and by the ADR-0067 chokepoint middleware in slice 0·5.
- Fitness function: every permission key referenced by seeds, grants, or (later) route metadata **exists in the registry**, and its namespace matches its module.

Dependency direction: `data-access → access-control` (pure, leaf-adjacent); `access-control` depends on nothing but `identifiers` types if needed. Package layout consistent with ADR-0071's structure-vs-access seam.

## 5. Firm provisioning behind a port

**`FirmProvisioner`** (in `apps/worker`, orchestration only — steps delegate to existing packages):

1. Insert `firm` row — `status: provisioning` (`frm_` handle, name).
2. `port.createDatabase(firmId)` → `database_identifier` recorded.
3. Migrate the new database to head via the **existing fleet runner** (`@magna-carta/database`) — mirror column updates as designed in ADR-0065.
4. `port.createBucket(firmId)` → bucket name recorded.
5. Create the **owner user** (Better Auth server API: email, name, `firm_id`) + send the verification/reset email through the `sendEmail` port.
6. Enqueue the member-mirror outbox row (§6) — owner gets the Owner/Admin role.
7. `firm.status → active`.

**Idempotent and resumable:** every step is a guarded, re-runnable write (UNIQUE constraints + status checks — the fleet-rollout discipline). A crashed provisioning resumes by re-invoking; completed steps no-op.

**`FirmResourceProvider` port, two adapters:**

- **Dev adapter** (Miniflare): "creation" claims a pre-declared local binding from `wrangler.jsonc` — local D1/R2 cannot be created at runtime.
- **Cloudflare REST adapter:** real D1-create + R2-create API calls using an account API token held as a **Worker secret**. The new database's **binding** still requires a config commit + deploy — acceptable for a fleet of one and **documented as the known manual step**; revisit (dynamic dispatch / Workers for Platforms) only when firm #2+ makes it real.

**Endpoint:** `POST /v1/firms`, guarded by a **platform-admin secret** (Worker secret header check) — the single-operator reality of Phase 0; a real platform-admin principal model is a named later seam. `idempotency: required`.

## 6. Member sync — the control-plane outbox

Creating or deactivating a user must write two databases (control-plane user, per-firm `member`) with no cross-database transaction. Slice 0·2 already solved this class: **the outbox** (ADR-0064).

- Our user-creating endpoints (provisioning §5, invite) write the Better Auth user **and** a control-plane outbox row (`member.provision` with `user_id`, `firm_id`, role) in one batch through the data-access idempotency path.
- The **relay sweep** (existing data-access machinery, pointed at the control-plane DB) applies the `member` row + role assignment to the firm's per-firm D1 — idempotent consumer, at-least-once.
- **This slice wires the scheduled plumbing** slice 0·2 explicitly deferred: the worker's cron handler runs the relay sweeps (both outbox lineages) and the idempotency-record TTL purge.
- **Reconciliation backstop:** a check (test + sweep-able query) that finds control-plane users with no per-firm member row.

## 7. API surface — dogfooding the contract conventions

All routes are `createRoute` contracts with `x-mc-*` metadata per [`docs/conventions/api.md`](../conventions/api.md) (incl. the spike finding: OpenAPI-native `operationId` set from the metadata):

| Route              | Permission            | Notes                                                                             |
| ------------------ | --------------------- | --------------------------------------------------------------------------------- |
| `POST /v1/firms`   | platform-admin secret | provision a firm (§5); `idempotency: required`; `audited`                         |
| `POST /v1/members` | `firm:manageMembers`  | invite a member (§1); `idempotency: required`; `audited`                          |
| `GET /v1/me`       | authenticated         | session user + firm + **effective permissions** — the SPA's future bootstrap call |
| `/api/auth/*`      | —                     | Better Auth's own routes (login, logout, verify, reset, TOTP)                     |

Plus the **`resolveSession` middleware primitive**: session cookie → control-plane lookup → `{ userId, firmId }` → the firm-scoped data-access handle. This is the first link of the ADR-0067 chokepoint chain; the full ordered middleware (RBAC enforcement per route metadata, rate limits) is slice 0·5 — this slice enforces permissions **in the two handlers that need it**, through the §4 resolver, so the resolver is exercised end-to-end without pre-building the chokepoint.

**Error shapes** follow the RFC 9457 problem-details model (api.md): within-firm action denial → **403**; cross-firm anything → **404** (ADR-0052/0068); validation → 422.

## 8. Testing

- **Unit:** permission registry + resolver (incl. expiry); provisioner state machine against fake ports (happy path, crash-resume at every step, double-invoke idempotency).
- **Integration (Miniflare):** full provision → firm row active, per-firm D1 migrated to head, owner member row exists after relay sweep; login → session cookie → `GET /v1/me` returns firm + permissions; TOTP enroll → verify with generated codes → login requires the second factor; invite flow end-to-end; permission denial → 403 problem shape; deactivated/foreign context → 404.
- **Fitness functions:** every referenced permission key ∈ registry; auth tables exist only in the control-plane lineage; no unauthenticated user-creation route in the emitted OpenAPI document; `member` keys reference the global `user_id` shape (`usr_` handle); both new migrations pass the expand-contract guard.

## 9. Out of scope — named seams (documented, not designed)

Passkeys & SMS factors (§2) · login/auth UI + design-system bootstrap (own slice) · role-editor UI (roles are already data) · ethical walls (ADR-0068 deferral stands) · the access-request **flow** (403 semantics land now; request→grant workflow later) · real platform-admin principal model (§5) · `protected()` crypto module + TOTP-seed migration onto it · firm suspension/offboarding states · dynamic D1 binding dispatch (fleet-of-one accepts config-commit + deploy).

## 10. Definition of done (golden rule 5)

Code + migrations + tests green, **and**: ADR-0073 appended to the Decision-Log; `ROADMAP.md` (slice status) + `CHANGELOG.md` updated; auth conventions documented where they live (`docs/conventions/` — security/auth touchpoints); this spec linked from the roadmap entry. User-facing docs (`docs/user/`) start with the auth **UI** slice — there is nothing for an end user to operate yet.
