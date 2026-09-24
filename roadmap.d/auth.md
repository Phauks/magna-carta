# Authentication, Access Control & Encryption

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Security and sign-in -->

- id: auth
  name: Authentication, access control and encryption
  scope: First-party Better Auth login, trusted-insider RBAC, and narrowly-scoped structural application-level encryption.
  status: partial
  slices: 0-4-auth-rbac-skeleton-firm-provisioning, 1-2-protected-crypto-module
  adrs: ADR-0004, ADR-0068, ADR-0026
  audience: public
  public-name: Accounts and permissions
  public-summary: A named account for everyone at the firm, with roles that decide what each person can open, change and see.
  awaiting-owner: The unified-identity design proposes fifteen settings and two of them are commitments rather than knobs. Whether a firm may weaken a platform security default for its own members — the design says no, on the ground that a floor which can be written down is not a floor, and a no means some firm will one day be told it cannot have what it asks for. And whether the platform may administer an account recovery at all: the design permits it only for a sole Owner locked out, two-person, on a full hold, audited, with the billing contact notified — the alternative is that a solo practitioner who loses their factors loses the firm. The other thirteen are windows, caps and enrolment grace periods that ship configurable with the recommended value. Unified identity design, flags F5 and F8.

- id: auth.first-party-login
  name: First-party login
  scope: Better Auth on control-plane D1 (Drizzle adapter), firm = organization, exactly one organization per user; role/profile mirrored to the per-firm member row.
  status: shipped
  slices: 0-4-auth-rbac-skeleton-firm-provisioning
  adrs: ADR-0004, ADR-0073
  spec: docs/specs/2026-06-09-slice-0-4-auth-rbac-provisioning-design.md
  evidence: apps/api-worker/src/auth.ts, control-plane auth tables + schema-sync fitness test
  notes: API-only to date; the login/2FA UI is the 0-7b slice (branch active).

- id: auth.first-party-login.invitation-only
  name: Invitation-only membership
  scope: Nobody adds themselves to an existing firm; Better Auth's own signup stays structurally off, and joining a firm goes through invitation redemption with an email-verified flip.
  status: shipped
  surface: screen
  adrs: ADR-0280
  evidence: apps/api-worker fitness-tested signup-off configuration (disableSignUp stays true); invitation redemption takes a code plus surname and date of birth against one digest over all three, so the handler cannot report which fact was wrong.
  notes: Founding a NEW firm is now self-serve (ADR-0280) — that is the one anonymous write, two-staged behind an emailed link. Membership of an existing firm remains invitation-only, which is what this node covers.

- id: auth.first-party-login.auth-ui
  name: Login and 2FA UI
  scope: The login/2FA surface over the auth backend — the design system's first consumer.
  status: partial
  surface: screen
  slices: 0-7b-auth-ui-deferred-surfaces
  evidence: Sign-in is one screen (email and password together) with channel-aware code entry and real recovery-code entry, on main at apps/web/src/routes/login and account/security; every state renders on apps/web/src/routes/developer-console/sign-in-screens, and apps/web/src/lib/auth/unbuilt-capabilities.ts declares each server capability a control would need before it is rendered. Ending a session is built at both ends: apps/web/src/lib/auth/sign-out.ts (the profile menu's Sign out — server first, local state second, a document load third, and a refusal that stays put) and apps/web/src/routes/account/sessions, the signed-in-devices section over Better Auth's list and revoke routes.
  notes: Sign-in shipped, so has signing out (and signing another device out), and so are the joining screens — apps/web/src/routes/register (the role fork), register/firm, register/confirm and register/invitation each call startRegistration, confirmRegistration or redeemInvitation against the real endpoints. The two-factor ENROLMENT screens are still missing, which is the half of auth.two-factor.totp nobody can reach: a code is verified at sign-in and no screen sets one up. Passkeys, the one-time sign-in link, firm identity providers, workspace selection and the second-factor channel choice remain server-side gaps. Human verification is no longer one of them — the server side exists (auth.hardening.human-verification); what the sign-in surface's Turnstile slot still lacks is a widget that mints a token, which is UI.

- id: auth.two-factor
  name: Second factors
  scope: Passkeys/WebAuthn and TOTP primary; email codes and SMS secondary/recovery only.
  status: partial
  audience: public
  public-name: Two-step sign-in
  public-summary: Protect an account with a second step: a code from an app, a hardware key, or a passkey instead of a password.

- id: auth.two-factor.totp
  name: TOTP
  scope: TOTP enrollment and login with transition-exact audit events.
  status: shipped
  surface: awaiting-screen
  slices: 0-4-auth-rbac-skeleton-firm-provisioning
  evidence: apps/api-worker end-to-end TOTP coverage; two_factor audit hooks

- id: auth.two-factor.passkeys
  name: Passkeys / WebAuthn
  scope: Passkey server plugin, enrollment UI, virtual-authenticator test coverage.
  status: not-started
  notes: Deferred from the auth backend slice because WebAuthn needs a browser; scheduled into the auth-UI slice.

- id: auth.two-factor.email-otp
  name: Email OTP
  scope: Email codes as a secondary/recovery factor.
  status: not-started

- id: auth.two-factor.sms-otp
  name: SMS OTP
  scope: Better-Auth-generated codes delivered through the Communications layer messaging port; flagged weakest, never a sole second factor.
  status: not-started
  adrs: ADR-0047
  notes: Messaging port decision accepted; no delivery adapter built.

- id: auth.hardening
  name: Auth hardening
  scope: Argon2id hashing, secure sessions, rate limiting, account lockout, email verification, password reset, immutable auth audit log.
  status: partial

- id: auth.hardening.auth-audit-log
  name: Auth audit log
  scope: Immutable control-plane auth audit (login success, logout, session revocation, 2FA transitions, password reset, key shred, alpha-door writes).
  status: shipped
  surface: internal
  evidence: packages/data-access/src/auth-audit-statements.ts

- id: auth.hardening.rate-limiting
  name: Rate limiting
  scope: Rate limiting on the API surface via the chokepoint's declared limits.
  status: partial
  surface: internal
  slices: 0-5a-api-contract-foundation
  evidence: apps/api-worker/src/http/chokepoint/rate-limiter.ts holds four named buckets as data (default, auth, expensive, incident-report) and an in-memory sliding-window log behind an async-capable RateLimiter interface; every route declares its bucket as meta.rateLimit in apps/api-worker/src/http/contracts/route-meta.ts and the chokepoint checks it before the handler, publishing limit and remaining on every verdict so a client can warn before it is refused.
  notes: Partial because of WHERE the state lives, not because nothing enforces: the limiter is per Workers isolate, so it resets on eviction or redeploy and the effective global ceiling is the bucket limit times the number of live isolates. That is an abuse backstop rather than a limit. A distributed adapter over Durable Objects or KV swaps in behind the same interface with no route or contract change, which is why the signature is sync-or-promise.

- id: auth.hardening.human-verification
  name: Human verification on anonymous endpoints
  scope: A bot check ahead of the platform's anonymous writes — server-side verification of a Cloudflare Turnstile challenge solution, with a typed absence when no verifier is provisioned.
  status: partial
  surface: internal
  evidence: apps/api-worker/src/http/human-verification/ — the port with its three-valued outcome, the siteverify adapter (single-use tokens, retry under one idempotency key), and the gate called by POST /api/v1/registrations and POST /api/v1/invitations/redemptions; apps/api-worker/test/turnstile-verifier.test.ts and apps/api-worker/test/human-verification-gate.test.ts cover a valid solution, a rejected one, a replayed one, both unconfigured postures and an unreachable verifier.
  notes: PARTIAL, and specifically: the server half exists and enforces nothing today. No Turnstile widget has been created, so no secret is provisioned, so every environment resolves the not-configured verifier and the protected endpoints serve exactly as before — counting each unprotected pass as human_verification.decided/unenforced. Two things are outstanding and neither is server work: the owner creating the widget and setting TURNSTILE_SECRET_KEY (queued in docs/deploy-queue.md), and a client that renders the challenge and mints a token, which is UI reserved to the owner. The Better Auth credential endpoints are deliberately NOT gated — their shipped sign-in screen mints no token, so gating them would break a working surface; that mounting belongs to the identity slice that owns them.

- id: auth.access-control
  name: Trusted-insider access control
  scope: Firm isolation the only hard boundary; RBAC governs actions not visibility; ethical walls a future content overlay.
  status: partial
  adrs: ADR-0068

- id: auth.access-control.permission-registry
  name: Permission registry
  scope: Fixed platform registry, one namespace per subsystem (subsystem:action); every route declares one, cross-checked by a fitness function.
  status: shipped
  surface: internal
  adrs: ADR-0067
  evidence: packages/access-control, 0-5b conformance suite

- id: auth.access-control.roles-as-data
  name: Roles as data
  scope: role-to-permissions and member-to-roles rows seeded with editable defaults; effective permissions = roles held union direct grants.
  status: shipped
  surface: internal
  slices: 0-4-auth-rbac-skeleton-firm-provisioning
  evidence: member-rbac migration, packages/access-control resolver, GET /v1/me
  notes: The defaults are not editable yet, and the word in scope is aspirational rather than a claim about today - packages/data-access holds only SELECTs over role_permission and direct_grant, so the migration seeds are the whole supply and a permission no seed grants is a permanent refusal. Held from now on by lint:ungranted-permissions; the two write surfaces are auth.access-control.role-editor-ui and the unbuilt half of auth.access-control.access-requests.

- id: auth.access-control.ungranted-permission-scan
  name: Ungranted-permission scan
  scope: Fitness function failing any permission that gates a chokepoint route or a Tools catalogue manifest and that no migration seed grants to any role.
  status: shipped
  surface: internal
  evidence: tooling/lint-ungranted-permissions (rules.mjs, index.mjs, index.test.mjs), wired as lint:ungranted-permissions in package.json and discovered automatically by the gate's derived lint set. Reports one hit on today's tree, allowlisted with its reason; replayed against the tree of 2026-06-22 it names documents:edit on the commit that introduced the route.
  notes: Does not catch a permission granted only to a role no member holds, nor a capability enforced somewhere other than the chokepoint or the Tools catalogue.

- id: auth.access-control.role-editor-ui
  name: Role editor UI
  scope: Firm-facing role editing surface.
  status: not-started
  notes: Named as a later additive seam.

- id: auth.access-control.access-requests
  name: Access requests and direct grants
  scope: Within-firm denial is 403 plus request-access; approver writes an optionally time-boxed direct grant.
  status: partial
  surface: awaiting-screen
  evidence: The denial half and the grant READ are both built — apps/api-worker/src/http/chokepoint/chokepoint.ts answers a within-firm denial with 403 plus the requestAccess flag on the problem body, and packages/access-control/src/resolver.ts already unions direct grants into a member's effective permissions off the direct_grant table.
  notes: What is missing is the middle: nothing writes a direct_grant row. The table already carries the time box (expires_at, null meaning none) and who granted it, and the resolver already honours expiry in code rather than in SQL, so what a build has to add is the request record and the approver route rather than the model. The separate support-access framework (support_grant) covers platform staff, not member grants.

- id: auth.access-control.cross-firm-404
  name: 404-not-403 boundary
  scope: Cross-firm and unauthorized-but-existing resources return 404 so responses are never an existence oracle; 403 reserved for within-firm denial.
  status: shipped
  surface: internal
  slices: 0-5b-api-contract-enforcement-pipeline
  adrs: ADR-0052
  evidence: chokepoint deactivated-member 404 unification

- id: auth.access-control.location-filter
  name: Location as view filter
  scope: Office as a list/search/report filter, never an access gate; hard per-location separation a reserved seam.
  status: not-started
  notes: Locations entity shipped; the filter surfaces are UI-gated.

- id: auth.access-control.ethical-walls
  name: Ethical walls
  scope: Content-screening overlay (header visible, contents screened) for the rare conflict.
  status: deferred
  notes: Parked by the white paper's Authentication, access control and encryption topic, which names it as the future content-screening layer and says it is not designed until a concrete use case exists; kept as a seam. The 404-not-403 boundary that would carry it is already shipped.

- id: auth.encryption
  name: Encryption and key management
  scope: App-level encryption scoped to crown-jewel secrets only, giving an audited role-gated read chokepoint; everything else on platform at-rest encryption.
  status: partial
  slices: 1-2-protected-crypto-module
  adrs: ADR-0026, ADR-0084
  spec: docs/specs/2026-06-12-slice-1-2-protected-crypto-module-design.md
  audience: public
  public-name: Encryption of sensitive fields
  public-summary: Identifiers and other sensitive details are encrypted with keys held for your firm alone, not merely stored behind a login.

- id: auth.encryption.envelope-keys
  name: Envelope key hierarchy
  scope: Root KEK as Worker secret wrapping a per-firm key; HKDF-derived purpose keys (pii, secrets, index); AES-KW/AES-GCM/HKDF/HMAC via Web Crypto.
  status: shipped
  surface: internal
  evidence: packages/encryption, packages/data-access/src/firm-key-provider.ts

- id: auth.encryption.protected-fields
  name: protected() field chokepoint
  scope: Declarative field type encrypting on write, role-gated audited decrypt on read, inside the data-access layer — no separate crypto service.
  status: shipped
  surface: internal
  evidence: packages/data-access/src/{protected-fields,protected-field-registry}.ts

- id: auth.encryption.blind-index
  name: HMAC blind index
  scope: Blind index so conflicts matching works over encrypted identifiers without decrypting.
  status: shipped
  surface: internal
  evidence: packages/encryption/src/blind-index.ts; directory protected identifiers use it

- id: auth.encryption.firm-secrets
  name: Per-firm plugin credentials
  scope: getSecret/putSecret for per-firm plugin credentials; ciphertext in the firm database, plugin Workers never see key material.
  status: shipped
  surface: internal
  evidence: packages/data-access/src/{secret-statements,firm-secret-credential-store}.ts

- id: auth.encryption.crypto-shred
  name: Per-firm crypto-shred
  scope: Destroying a firm's wrapped key renders its encrypted corpus permanently unreadable — instant per-firm offboard.
  status: shipped
  surface: internal
  evidence: apps/api-worker/src/firm-key-shred.ts
  notes: Function only; the offboarding flow that invokes it is its own future design.

- id: auth.encryption.key-rotation
  name: Key rotation machinery
  scope: Root rotation (rewrap firm keys) and per-firm rotation (re-encrypt the small sensitive set).
  status: deferred
  notes: Parked by the white paper's Encryption and key management topic — the wrapped structure permits both rotations without re-encrypting everything, so the machinery waits until needed and only the seam is built now. That seam is the versioned envelope in packages/encryption/src/envelope.ts.

- id: auth.encryption.post-quantum
  name: Post-quantum posture
  scope: Symmetric corpus already quantum-resistant; crypto-agility via per-ciphertext algorithm/key version identifiers; PQ signatures seamed on upstream standards.
  status: partial
  surface: internal
  adrs: ADR-0046
  evidence: packages/encryption/src/envelope.ts (algoVersion + keyVersion frame)
  notes: Agility seam shipped; PQC-TLS gap logging for third-party endpoints and signature migration not built.

- id: auth.encryption.totp-seed-exception
  name: TOTP seed placement
  scope: TOTP seeds stay in Better Auth's tables under its at-rest encryption (user-owned, pre-firm-context), verified against the pinned version.
  status: shipped
  surface: internal
  adrs: ADR-0084
  evidence: docs/decisions/0084-encryption-keys-protected-concretization-envelope-context.md

- id: auth.encryption.kms-rooted-kek
  name: External KMS-rooted KEK
  scope: AWS-KMS-anchored root key as a hardening upgrade (Cloudflare offers no application-data HSM).
  status: deferred
  notes: Parked by the white paper's Encryption and key management topic, under Honest limits — root-KEK compromise is total compromise, the only stronger anchor is an external KMS or HSM, and Cloudflare offers none for application data, so this is a backlog hardening item rather than Phase 0. PQC-wrapped-key support becomes a selection criterion when it is picked up.
