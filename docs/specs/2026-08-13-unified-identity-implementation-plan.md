# Unified identity and authentication methods — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Design:** [`2026-08-13-unified-identity-design.md`](2026-08-13-unified-identity-design.md)
**Goal:** Make every way into the platform the same way in — one principal model, one method register,
one assurance lattice — so adding a method is a row rather than a branch in every gate, and so losing
one is a designed path rather than an incident.

**Architecture:** No new deployable. `apps/worker` grows a `src/identity/` area (the method register,
the assurance stamp, home-realm discovery, the recovery hold) and one chokepoint gate;
`packages/database` grows six control-plane tables and two constraints; `packages/access-control` grows
the platform method floor beside the permission registry; `apps/web/src/lib/auth/` gains the wiring the
existing screens are already shaped for. Four Better Auth plugins are mounted; one separate MIT package
(`@better-auth/sso`) is added.

**Tech Stack:** TypeScript, Better Auth 1.6.x on control-plane D1, Drizzle, Hono +
`@hono/zod-openapi`, Cloudflare Workers / KV / Durable Objects / Queues, Svelte 5 runes, Vitest +
`@cloudflare/vitest-pool-workers`.

---

## Global constraints

- **Golden rule 12 — no shorthand.** `authenticationMethod`, not `authMethod`; `identityProvider`, not
  `idp`; `principalKind`, not `kind` where the noun is ambiguous; "the data-access layer", never "the DAL".
- **Golden rule 13 — no process references in source.** No ADR numbers, no "spec section N", no
  "slice N" as a citation, in code, tests, config, or OpenAPI `description`s. A forward-looking
  "slice 5 replaces this with the real provider" is allowed.
- **Golden rule 2 — no emojis**, anywhere, and all UI through `@magna-carta/design-system`.
- **Golden rule 11 — verify the library before using it.** Every plugin option named in this plan was
  read from Better Auth's current documentation on 2026-08-13. Re-read before mounting; an option that
  has been renamed is a deviation note, not a guess.
- **Golden rule 10 — nothing heavy in a request handler.** Notifications on enrolment and recovery go
  through the transactional outbox. Discovery is one indexed read behind a short KV cache.
- **Fifteen owner flags (F1-F15) are open.** Every one has a recommended default named in the design's
  flag table. Build the mechanism, ship the default **as a configurable value** — a firm setting where
  the design says firm-narrowable, a platform constant beside the permission registry where it is a
  floor. Do not hard-code a flagged value in a handler.
- **The platform floor is code, not a setting.** A floor that can be written is not a floor.
- **Nothing weakens the shipped enumeration posture.** Any new anonymous surface passes the four checks
  in the design's _The enumeration posture, generalised_ before it is registered.
- **D1 has no interactive transactions.** Read everything, then compose one batch.
- **Migration ids are monotonic**; take the next timestamped id above the current head at the time of
  the task. Control-plane migrations run through the control-plane applier.
- **Every mutation writes an `auth_audit` row** in the same batch, ids only — never an address, never a
  credential, never a domain a firm has not verified.

---

## Slice ordering, and why slice 1 is useful alone

| Slice | Ships                                                                                                                                                                                                                        | Useful alone because                                                                                                                                                                                                                                                                                          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | The identity spine: `principal_kind` and its immutability, the firm-tenancy CHECK, the method register, session assurance, surface admission at the chokepoint, the refusal fitness function, the ladder as a Durable Object | It closes a live confidentiality gap with no new method at all. The community board's invitation-counting subquery becomes one session field; a firm-scoped surface that forgets a portal principal now fails **closed**; and every later slice has one place to record what it enrolled. Ships no new way in |
| **2** | Passkeys: the plugin, the register rows, enrolment in settings, discoverable sign-in, `phishingResistant` assurance                                                                                                          | The strongest method becomes the fastest one, and the recovery work in slice 3 has something worth recovering. It is also the only method that makes `exclusive` SSO safe in slice 5                                                                                                                          |
| **3** | Recovery and step-up: the recovery hold, firm-administered recovery, the address-of-record invariants, `stepUp` on `RouteMeta`                                                                                               | The first two slices add a credential people can lose. This is the slice that makes losing one survivable, and it lights up the `stepUpRequired` seam the flagged-download path has been carrying alone                                                                                                       |
| **4** | One-time sign-in links and typeable codes: `magicLink` + `emailOTP` with the inverted defaults, `mailbox` assurance, Turnstile                                                                                               | Closes three unbuilt-capability entries (`one-time-link`, `reset-code`, `human-verification`) and gives the portal in slice 6 its lowest-ceremony door. Deliberately after recovery, so a link can never be the recovery path                                                                                 |
| **5** | Firm identity providers: `@better-auth/sso`, domain claim and DNS verification, discovery on submit, the three enforcement modes, the federated session cap                                                                  | The firm's own revocation point. Last of the firm-member work because `exclusive` mode is only safe once the Owner can hold a passkey (slice 2) and once break-glass recovery exists (slice 3)                                                                                                                |
| **6** | Client-portal identity: `portal_membership`, the firm-less portal session, per-grant assurance escalation, the aggregated portal surface                                                                                     | Turns slice 1's structural separation into a working external surface. Last because it consumes every earlier piece — the principal kind, the assurance lattice, links, and passkeys                                                                                                                          |

Slices 4 and 5 are independent of each other and may run in parallel by different owners, provided
slice 4 owns `apps/worker/src/identity/one-time-link.ts` and slice 5 owns
`apps/worker/src/identity/home-realm.ts` exclusively. Slice 6 needs both.

---

## Slice 1 — The identity spine

**Ships:** the principal model, the method register, assurance on the session, admission at the
chokepoint, and the enumeration fitness function. No new authentication method.

### Task 1.1 — Principal kind on the account row

- [ ] Add `principal_kind` to the control-plane `user` table: text, `NOT NULL`, enum
      `firmMember | portalClient`, no default.
- [ ] Backfill: every existing row is `firmMember` except those whose id appears as
      `invitation.redeemed_user_id` on an invitation of kind `clientOfFirm`. This is the **last** time
      the invitation table is read for this fact; the migration comment says so.
- [ ] Add a `BEFORE UPDATE` trigger raising `ABORT` when `NEW.principal_kind <> OLD.principal_kind`.
- [ ] Add `CHECK ((principal_kind = 'portalClient') = (firm_id IS NULL))`.
- [ ] Make `firmId` nullable on the Better Auth user model (`additionalFields`, `required: false`,
      `input: false` unchanged) and let the compiler find every reader. Each reader either narrows on
      `principalKind` or resolves no firm; **none** defaults to a firm.
- [ ] Tests: the trigger refuses a kind change; the CHECK refuses a portal client with a firm and a firm
      member without one; the backfill is exercised against a seeded pair.

### Task 1.2 — The authentication-method register

- [ ] Create `authentication_method` (design section _Method_) with indexes on `principal_id` and on
      `(principal_id, kind) WHERE revoked_at IS NULL`.
- [ ] Maintain it from `databaseHooks` on `account`, `passkey` and `twoFactor`, plus explicit writes on
      our own paths. Credential material stays in the library's tables; this row is a projection.
- [ ] Add `lint:method-register-reconciliation` as a Miniflare test, not a source scan: seed each library
      table and assert exactly one live register row per credential and no orphans in either direction.
- [ ] Register `authenticationMethod` in `@magna-carta/identifiers` and add the model to
      `ENTITY_TYPE_BY_MODEL` in `auth.ts` if Better Auth ever owns it (it does not today — note why).

### Task 1.3 — The platform method floor

- [ ] `packages/access-control/src/authentication-floor.ts`: a declarative module beside the permission
      registry stating what no firm may narrow past — a portal client holds no firm identity provider; the
      last live method cannot be removed; a recovery method must exist before a second factor is the only
      thing past a password.
- [ ] The firm-narrowable half goes in the existing settings registry with the scoped resolver, one
      setting per flag F3/F4/F6/F11, each defaulting to the design's recommendation.
- [ ] A fitness function asserts no firm setting can resolve to a value below the floor.

### Task 1.4 — Assurance and the authentication instant on the session

- [ ] Add `assurance` and `authenticated_at` to the control-plane `session` table via Better Auth
      `session.additionalFields`.
- [ ] Stamp them in `databaseHooks.session.create.after`, alongside the existing `login.success` audit.
      Derive assurance from which endpoint established the session; a password alone is `credential`, a
      completed second factor is `multiFactor`.
- [ ] `authenticated_at` moves on a step-up re-verification **without** minting a session (slice 3 uses
      this); it does not move on activity extension.
- [ ] Publish both on `GET /api/v1/me` so a surface can render honestly what it is allowed to do.
- [ ] Test: a password-only session reads `credential`; completing two-factor reads `multiFactor`; a
      session rotation on mid-session 2FA enablement does not silently downgrade.

### Task 1.5 — Surface admission at the chokepoint

- [ ] `RouteMeta` gains `principals: readonly PrincipalKind[]`, defaulting to `["firmMember"]`.
- [ ] A new ordered chokepoint gate, **before** tenancy: a session whose `principalKind` is not listed is
      refused with the reserved absent answer (404), never a 403 that confirms the principal exists.
- [ ] Startup validation rejects a route registered without `principals`, exactly as an unregistered
      permission does.
- [ ] Re-emit the OpenAPI snapshot and regenerate `@magna-carta/api-client` in the same commit.
- [ ] Conformance test: every registered route declares `principals`; no `/api/v1` app-surface route
      admits `portalClient`.

### Task 1.6 — The refusal fitness function

- [ ] `tooling/lint-refusal-neutrality.mjs`, modelled on `lint-custodian-vocabulary.mjs`: for every
      handler reachable from a `surface: "public"` route, assert at most one refusal-constructing call
      site and that no refusal constructor takes an argument derived from a database read.
- [ ] Wire into `package.json` and the governance job.
- [ ] Assert the two shipped references pass unchanged: `neutralRedemptionRefusal` and the registration
      address-in-use branch.

### Task 1.7 — The shared attempt ladder becomes durable (F15)

- [ ] Move `createAttemptLadder` behind a Durable Object keyed by the ladder key, preserving the exact
      interface (`read` / `spend` / `clear`) so no caller changes.
- [ ] Keep the per-isolate implementation as the injectable test double; the honest under-report note in
      the module header is replaced by the real guarantee.
- [ ] Test: two isolates share one budget.

### Task 1.8 — Repair the two stale facts, and the two-lockout collision

- [ ] `attempt-ladder.ts`'s header still says the server publishes no budget. It does. Rewrite.
- [ ] `auth.ts` and `docs/conventions/security.md` pin reasoning to Better Auth 1.6.16; the catalog
      resolves 1.6.22. Re-verify the `secrets` option name against the pinned source and correct both.
- [ ] Configure the `twoFactor` plugin's own lockout strictly larger than the platform ladder, and add a
      test that exhausts our ladder and asserts the answer carries our headers and our problem type, not
      `ACCOUNT_TEMPORARILY_LOCKED`.

### Task 1.9 — Retire the community board's subquery

- [ ] Coordinate with the community stream (`vp run worktrees`). Once slice 1 lands, `isPortalPrincipal`
      reads `session.principalKind` and the correlated invitation count is deleted, along with the
      comment that asked for exactly this.

### Task 1.10 — Docs

- [ ] `apps/worker/src/identity/CLAUDE.md` from the area template: the three nouns, the floor-is-code
      rule, and the projection-not-source-of-truth rule.
- [ ] Update `unbuilt-capabilities.ts` — `workspace-selection` is answered by the design (there is
      nothing to select) and its entry is deleted rather than left declaring a gap that no longer exists.
- [ ] A `changelog.d/` fragment and a `status.d/` fragment update.

---

## Slice 2 — Passkeys

### Task 2.1 — Mount the plugin

- [ ] Add `passkey` to `plugins` in `auth.ts` with `rpID`, `rpName`, `origin` from bindings — never a
      literal, because the per-firm branded subdomains make the relying-party id a deployment fact.
- [ ] `authenticatorSelection`: `userVerification: "preferred"`, `residentKey: "preferred"`. Record the
      user-verification result on the register row; F1 turns on whether a non-verifying key may stand alone.
- [ ] Control-plane migration for the `passkey` table; add its model to `ENTITY_TYPE_BY_MODEL`.
- [ ] Cookie note: the WebAuthn challenge cookie inherits the host-only posture; assert it in
      `auth-cookie-isolation.test.ts`.

### Task 2.2 — Enrolment

- [ ] Settings surface: list, add, rename, remove. Removal is refused when it would leave no live method
      (the floor), and the refusal names what to enrol first.
- [ ] Every enrolment and removal writes `method.enrolled` / `method.removed` and enqueues the notification
      through the outbox.
- [ ] Enrolment is a step-up act once slice 3 lands; until then it requires a `multiFactor` session and
      the code says which slice replaces the check.

### Task 2.3 — Sign-in

- [ ] Discoverable assertion only: empty `allowCredentials`, no address taken by the passkey control.
- [ ] Wire `passkey-ceremony.ts` (already written) to the client; the ceremony script is unchanged.
- [ ] Conditional-UI autofill on the email field (`autocomplete="username webauthn"`), and the passkey
      entry in `unbuilt-capabilities.ts` is deleted.
- [ ] A failed assertion produces the shipped neutral sentence and spends one rung of the shared ladder.
- [ ] Stamp `phishingResistant` on the session when user verification was performed.

### Task 2.4 — Tests

- [ ] Enumeration: an assertion request for a non-existent address is byte-identical to one for a real
      address with no passkeys.
- [ ] The floor refuses removing the last method.
- [ ] The register gains and loses a row in step with the `passkey` table.

---

## Slice 3 — Recovery and step-up

### Task 3.1 — `stepUp` on `RouteMeta`

- [ ] `stepUp: { assurance, maxAge } | null` on `RouteMeta`; a chokepoint gate after RBAC, before
      idempotency; unmet answers 403 carrying the existing `stepUpRequired` field.
- [ ] Compare against `session.authenticated_at`, not `createdAt`. `session.freshAge` stays configured as
      the coarse backstop.
- [ ] A re-verification endpoint that moves `authenticated_at` and re-stamps `assurance` without minting a
      session.
- [ ] Apply the design's ten acts (F12) as declared metadata; the flagged-download path stops setting
      `stepUpRequired` by hand and declares it instead.
- [ ] Re-emit OpenAPI + client.

### Task 3.2 — The recovery record and the hold

- [ ] `account_recovery(id, principal_id, requested_via, requested_at, effective_at, status, administered_by, cancelled_by, cancelled_at)`.
- [ ] On request: notify **every** channel of record plus the firm's Owners and Admins, through the
      outbox. Never one channel.
- [ ] A cron sweep effects a recovery whose `effective_at` has passed and which is still `pending`.
- [ ] On effect: revoke every session, and revoke every register row enrolled after `requested_at`.
- [ ] Any valid session, or a signed cancel link from any notified channel, cancels and locks the account
      into administered-recovery-only.
- [ ] Hold windows come from settings, defaulting per F7.

### Task 3.3 — Firm-administered recovery

- [ ] An Owner or Admin (`firm:manageMembers`) issues a recovery invitation reusing the shipped three-fact
      machinery, aimed at an existing account rather than creating one.
- [ ] Redemption follows the shipped neutral-refusal path unchanged, then opens a recovery with a zero
      hold (F7) because an attributable human at the firm administered it.
- [ ] Audit names the administering member.

### Task 3.4 — The address of record

- [ ] Changing it is `stepUp` at the account's **highest enrolled** assurance, plus a hold, plus
      notification to both the old and the new address.
- [ ] A structural refusal: the change endpoint rejects any session whose `assurance` is `mailbox`,
      whatever its age. A link may start a recovery; it may not complete one.

### Task 3.5 — Recovery codes

- [ ] Spending one drops the session to `credential` and sets a "must enrol a replacement" state that
      blocks every step-up-gated act until satisfied (F9).
- [ ] Re-issue regenerates the whole set and revokes the old; the register keeps only the count remaining,
      readable by the authenticated principal alone.

### Task 3.6 — Platform-administered recovery (F8)

- [ ] Permitted only where the firm has no other Owner or Admin — the route computes that itself rather
      than trusting a caller's assertion.
- [ ] Two named `platform_staff` principals, the full hold, an audit row naming both, and a notification
      to the firm's billing contact of record.
- [ ] Explicitly **not** routed through the support-grant framework, and a comment says why: that
      framework is consent-anchored, and a person who cannot authenticate cannot consent.

---

## Slice 4 — One-time sign-in links and typeable codes

### Task 4.1 — Mount, with the defaults inverted

- [ ] `magicLink({ disableSignUp: true, storeToken: "hashed", expiresIn: ... })` and
      `emailOTP({ disableSignUp: true, storeOTP: "hashed", allowedAttempts: ... })`.
- [ ] Both deliver through the existing `sendEmail` port with their own `messageClass`.
- [ ] **Pin the library's unverified-account behaviour by test:** verifying a magic link against an
      existing unverified account must leave its `account` row untouched. The invited-but-not-yet-activated
      member sits in exactly that state.
- [ ] Set `disableImplicitLinking: true`, empty `trustedProviders`, `allowDifferentEmails` off. Pin by test.

### Task 4.2 — Assurance ceiling

- [ ] A session established by a link or a code alone is stamped `mailbox` (F2) and cannot satisfy any
      `stepUp` gate. This is enforced by the lattice, not by a list of endpoints.
- [ ] The firm may disable links for its members (F3) through the settings registry.

### Task 4.3 — Enumeration

- [ ] Requesting a link answers the same body in the same time for an unknown address, a known address, and
      an address on a federated domain — the federated case mails the address, saying the firm signs in
      through its provider.
- [ ] Verify refuses spent, expired and unknown tokens with one sentence.
- [ ] The `one-time-link` and `reset-code` entries in `unbuilt-capabilities.ts` are deleted.

### Task 4.4 — Human verification

- [ ] Mount `captcha` with `cloudflare-turnstile` over the Better Auth credential endpoints.
- [ ] The `/api/v1` joining routes are ours and get their own verification middleware sharing one
      validator; the `human-verification` entry is deleted and the sign-in screen's Turnstile slot is wired.

### Task 4.5 — Second-factor channels

- [ ] Wire `emailOTP` as the emailed second-factor channel `code-channels.ts` already describes; the
      `second-factor-choice` entry is deleted once more than one channel is enrollable.

---

## Slice 5 — Firm identity providers

### Task 5.1 — The package and the tables

- [ ] Add `@better-auth/sso` (MIT) to the catalog and mount it. Record the dependency in the advisory
      inventory.
- [ ] `firm_identity_provider` (design section _Claiming a domain_), `domain` unique platform-wide.
- [ ] Migration for the plugin's `ssoProvider` table; our row is the authority on **whose** domain it is.

### Task 5.2 — Domain verification

- [ ] A per-firm nonce, a `_magna-carta-challenge.<domain>` TXT lookup over the existing DNS-over-HTTPS
      resolver pattern (`emails/dkim-dns-resolver.ts`), bounded in time and response size.
- [ ] A cron re-check; a domain whose record disappears stops redirecting and falls back to `continue`,
      never locking the firm out.
- [ ] A maintained deny-list refuses claims on consumer mail domains outright.

### Task 5.3 — Discovery on submit

- [ ] Middleware on `/sign-in/email`, ahead of the ladder: resolve the submitted address's **domain**
      against the verified map (KV-cached, short TTL) and short-circuit with `redirect` carrying the
      provider's display name and start URL.
- [ ] The password is discarded unread and no rung is spent.
- [ ] The answer is identical for a verified domain with no accounts.
- [ ] Wire the existing `identityProvider` prop on the sign-in screen; delete the `identity-provider`
      entry from `unbuilt-capabilities.ts`.

### Task 5.4 — Enforcement modes and the session cap

- [ ] `optional` / `preferred` / `exclusive` (F10). `exclusive` **removes** the password method from the
      register for every member — it does not ignore it.
- [ ] `exclusive` refuses to turn on until the firm's Owner holds an enrolled passkey.
- [ ] `provisionUserOnEveryLogin: true`; the federated session cap from settings (F11).
- [ ] Federated assurance is derived from the assertion's own claims, never assumed: no multi-factor
      claim means `credential`.

### Task 5.5 — Enumeration and audit

- [ ] The provider's errors are never relayed; an assertion the platform will not accept produces the
      platform's one neutral sentence.
- [ ] `identity_provider.registered`, `.domain_verified`, `realm.redirected` — ids and the verified domain
      only.

---

## Slice 6 — Client-portal identity

### Task 6.1 — Membership

- [ ] `portal_membership(principal_id, firm_id, directory_entity_id, status, created_at)`, unique on
      `(principal_id, firm_id)`.
- [ ] The invitation redemption path writes a portal principal plus a membership row for a
      `clientOfFirm` invitation, and a firm member plus `user.firm_id` for a `firmMember` one — the two
      shapes finally diverge at the only place they should.
- [ ] Every membership names a Directory entity; there is no shadow user list.

### Task 6.2 — The firm-less portal session

- [ ] A portal session carries no firm. Every portal request names the grant it exercises; the firm is
      derived from the grant, on every request.
- [ ] A test asserts no portal route reads a firm from the session.

### Task 6.3 — Per-grant assurance

- [ ] `PortalGrant` gains its required assurance level, expressed in this design's lattice.
- [ ] The portal escalates the challenge to the strongest assurance among the grants being accessed —
      the mechanism the white paper's per-share assurance already describes, now with a lattice to
      express it in.
- [ ] A portal client may hold a passkey and a second factor (F13).

### Task 6.4 — One mailbox, two kinds (F14)

- [ ] After a successful authentication, if the same address holds an account of the other kind, offer to
      switch. **After** — never before.

### Task 6.5 — Surface

- [ ] The aggregated portal view: every active grant across every firm, in one list, with the firm named
      per grant and no firm on the session.
- [ ] Which firms hold grants is rendered only after authentication.

---

## Verification for every slice

- `pnpm check:scoped` clean; the full `pnpm check` + `pnpm test` is the gate of record in GitHub Actions.
- `pnpm run lint:process-refs`, `lint:decisions`, `lint:changelog-fragments`, `lint:status`,
  `lint:refusal-neutrality` (from slice 1).
- OpenAPI snapshot re-emitted and `@magna-carta/api-client` regenerated in the same commit as any route
  or `RouteMeta` change.
- An ADR fragment for anything decided that this plan did not already decide, and a `changelog.d/`
  fragment with an explicit `audience:` key.
- Developer docs and `docs/user/` updated in the same commit — a method somebody can now use is a user-facing
  feature, and recovery in particular is the page people read on their worst day.
