# Unified identity and authentication methods — design

**Date:** 2026-08-13
**Status:** Design — proposed, fifteen owner flags open (see _Flagged for the owner_)
**Scope answer:** the owner scoped this as the four methods named together — **passkeys, one-time
sign-in links, firm identity providers, and client-portal identity** — designed as one surface rather
than four bolt-ons.
**Builds on:** ADR-0004 (first-party auth on Better Auth), ADR-0073 (the Better Auth integration
shape), ADR-0084 (TOTP seeds stay under Better Auth's own at-rest encryption), ADR-0068 (trusted-insider
access control), ADR-0003 (tenancy and control-plane/per-firm split), ADR-0036 (the client portal's
unified grant model), ADR-0067 (route metadata enforced at the chokepoint),
`ADR-joining-the-platform-registration-invitations-attempt-budget` (ADR-0280),
`ADR-0281`, ADR-0157 (the support-access framework),
ADR-0266 (the self-serve tier and entitlement mask), `ADR-community-identity-and-vote-eligibility`
(ADR-0275)
**Reads against:** [`2026-08-10-self-serve-firm-provisioning-and-entitlements.md`](2026-08-10-self-serve-firm-provisioning-and-entitlements.md),
[`2026-08-11-community-surfaces-design.md`](2026-08-11-community-surfaces-design.md)
**White paper:** _Authentication, access control, and encryption_ · _Tenancy and data isolation_ ·
_Client portal_
**Plan:** [`2026-08-13-unified-identity-implementation-plan.md`](2026-08-13-unified-identity-implementation-plan.md)
**Decisions proposed:** `principal-kind-is-a-column-not-an-invitation-lookup`,
`authentication-methods-are-one-register-over-better-auths-tables`,
`a-session-carries-an-assurance-level-and-an-authentication-instant`,
`home-realm-discovery-answers-about-a-domain-never-an-address` (which also settles the domain claim,
its DNS verification, and the three enforcement modes),
`recovery-is-a-held-announced-act-not-a-second-front-door`,
`a-one-time-link-proves-a-mailbox-and-only-a-mailbox`,
`the-neutral-refusal-becomes-a-fitness-function`

---

## 1. What this is, and the sentence the whole design turns on

Sign-in, self-serve registration and invitation redemption all shipped in the last week. The auth
surface therefore exists, and its gaps are visible rather than hypothetical: `unbuilt-capabilities.ts`
registers seven of them, three of which are three of the four methods in this scope. This design does
not add a fourth, fifth and sixth way in beside the password. It says what the ways in **share**, so
that adding one is a row in a register rather than a new branch in every gate.

Everything below is subordinate to one sentence:

> **A method proves you are the principal. It never decides who the principal is, and it never decides
> what the principal may then do.**

The failure this design exists to prevent is a method that quietly acquires one of the other two jobs.
A magic link that also creates the account has decided who you are. A federated assertion that also
carries a role has decided what you may do. An invitation kind that is the only record of whether a
person is staff or a client has made a **credential-issuing event** into the **identity model**, which
is the defect already sitting in the tree.

And its corollary, which is the whole of section 7:

> **Recovery is a way in.** Every recovery path is an authentication method with the ceremony removed,
> so it is enrolled, budgeted, audited, and rate-limited as one — or it is the weakest method the
> account has, and therefore the only one that matters.

Sections 2 and 3 say what exists and what the library gives. Section 4 is the model: three nouns —
principal, method, assurance — and the policy that resolves them. Sections 5 through 8 are the hard
parts in the order they were named: client-portal identity, home-realm discovery, recovery, step-up.
Section 9 generalises the enumeration posture the invitation fix established. Section 10 lists what is
deliberately not decided here.

---

## 2. What exists today

Read against the tree at `8fcdb8ae`. This is inventory, not commentary; the commentary is section 4.

**The server.** `apps/worker/src/auth.ts` mounts Better Auth on control-plane D1 with
`emailAndPassword` (`disableSignUp: true`, `requireEmailVerification: true`), the `twoFactor` plugin
with `MC`-prefixed recovery codes, a `firmId` additional field marked `input: false` and `required:
true`, host-only cookies, prefixed identifier minting per model, and audit hooks writing
`login.success`, `two_factor.enabled` / `.disabled`, and `password.reset`. There is exactly one plugin.

**The ladder.** `apps/worker/src/auth-attempt-budget.ts` is a per-isolate, address-keyed budget of five
failures over a fifteen-minute window with a five-minute lockout, spent by five credential path
suffixes, published as three `x-mc-*` headers, and refusing outright while a lockout stands. Its
key derivation, its "one ladder across every credential" rule, and its refusal-replaces-the-answer
behaviour are the pattern every method in this design inherits.

**The joining routes.** `routes/session/registrations.ts` (three doors; only `foundFirm` writes; the
address-in-use difference goes to the mailbox, never to the caller) and `routes/session/invitations.ts` (three
facts folded into one stored verifier; one neutral refusal built in one function; the invitation's own
ladder runs but is never spoken aloud). Both are already correct on enumeration, and both are the
reference implementations for section 9.

**The browser.** `apps/web/src/lib/auth/` holds the client (`client.ts`, budget captured on one
response hook), the ladder's copy (`attempt-ladder.ts`), the WebAuthn ceremony script
(`passkey-ceremony.ts`, no route behind it), the second-factor channel shapes (`code-channels.ts`),
the two-factor policy mirror (`two-factor-policy.ts`), and eleven screens. The sign-in screen already
models home-realm discovery: an `identityProvider` prop, resolution **on submit and never on blur**, a
password field left visible but inert, and the sentence "Passwords are managed there, so the one you
typed was not checked."

**The honest inventory.** `unbuilt-capabilities.ts` declares seven server-side gaps. Three are in this
scope (`passkey`, `one-time-link`, `identity-provider`); three more are adjacent and this design closes
or re-homes them (`second-factor-choice`, `reset-code`, `human-verification`); one (`workspace-selection`)
turns out to be a portal question and is answered in section 5.

**The gap that is already costing something.** `apps/community-worker/src/session.ts` on
`claude/community-board` must refuse portal principals, and can only do it by counting invitation rows:

```sql
(SELECT COUNT(*) FROM invitation AS i
   WHERE i.redeemed_user_id = s.user_id AND i.kind = 'clientOfFirm') AS portal_invitation_count
```

Its own comment says what is wrong with that, and it is right: "a check is one refactor away from being
silently wrong and this particular failure is a confidentiality breach rather than a bug." Section 5 is
the answer.

**Two stale facts in the tree**, found while reading and worth fixing in slice 1 rather than leaving:
`attempt-ladder.ts` still says the server publishes no budget (it does, since the middleware landed),
and `auth.ts` and `docs/conventions/security.md` both pin reasoning to Better Auth 1.6.16 while the
catalog now resolves `better-auth: 1.6.22`.

---

## 3. Better Auth — what it gives, and what must be built

Verified 2026-08-13 against the library's own current documentation, per golden rule 11. The catalog
pins `better-auth@1.6.22`; the SSO plugin is a **separate MIT package**, `@better-auth/sso`, currently
1.6.23. Nothing below is recalled from memory.

### 3.1 What the library provides

| Need                        | Library answer                                                                                                                                                                                                                                                                                                                                         | Verdict                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Passkeys                    | `passkey` plugin: `addPasskey`, `signIn.passkey` (with conditional-UI autofill), `listUserPasskeys`, `delete`/`update`; a `passkey` table carrying credential id, public key, counter, backup state, transports, AAGUID; `rpID`/`rpName`/`origin` and `authenticatorSelection` config                                                                  | **Take it whole.** Multiple passkeys per user are supported.                                                                       |
| One-time sign-in link       | `magicLink` plugin: `sendMagicLink`, `expiresIn` (default 300s), `disableSignUp`, `storeToken` (plain / hashed / custom), atomic single-use consumption                                                                                                                                                                                                | **Take it, with two defaults inverted** — see 3.3.                                                                                 |
| Typeable emailed code       | `emailOTP` plugin: `otpLength` (6), `expiresIn` (300s), `allowedAttempts` (3), types `sign-in` / `email-verification` / `forget-password`, `storeOTP` hashed                                                                                                                                                                                           | **Take it.** Closes the `reset-code` unbuilt entry and gives the second-factor email channel.                                      |
| Firm identity provider      | `@better-auth/sso`: OIDC (with discovery) and SAML 2.0; an `ssoProvider` table with `issuer`, `domain`, `oidcConfig`, `samlConfig`, `organizationId`, `domainVerified`; sign-in by email domain, explicit domain, organization slug or provider id; `provisionUser`, `provisionUserOnEveryLogin`, `organizationProvisioning` with a `getRole` callback | **Take the protocol half.** Everything about _whose_ domain it is, and about intercepting a password attempt, is ours.             |
| Human verification          | `captcha` plugin: Cloudflare Turnstile among four providers; protects `/sign-in/email`, `/sign-up/email`, `/request-password-reset` by default, list replaceable                                                                                                                                                                                       | **Take it** for the Better Auth surface; our own `/api/v1` joining routes still need their own.                                    |
| Step-up primitive           | `session.freshAge` (default one day, settable, `0` disables) — a session is "fresh" if `createdAt` is within it                                                                                                                                                                                                                                        | **Take it as the clock**, not as the policy. The policy is route metadata (section 8).                                             |
| Cross-host session handoff  | `oneTimeToken` plugin: a single-use token against the current session, three-minute default, hashable at rest                                                                                                                                                                                                                                          | **Take it.** This is the principled answer to the community worker's host-only-cookie problem, which is currently a bearer header. |
| Second factor               | `twoFactor`: TOTP, OTP over a supplied channel, backup codes, thirty-day trusted device, and in 1.6.x its **own** lockout answering `429 ACCOUNT_TEMPORARILY_LOCKED`                                                                                                                                                                                   | **Already mounted.** The plugin's lockout is new information and collides with ours — see 3.4.                                     |
| Multi-organization identity | `organization` plugin: many memberships per user, an active organization on the session, teams, invitations, dynamic roles                                                                                                                                                                                                                             | **Declined** — see 3.5.                                                                                                            |
| "Last method used" hint     | `lastLoginMethod`: a non-httpOnly cookie (30 days) or a user column                                                                                                                                                                                                                                                                                    | **Declined** — see 3.5.                                                                                                            |

### 3.2 What must be built here

Everything in this list is absent from the library by design, because it is a property of _this_
platform rather than of authentication in general.

- **A principal kind**, its immutability, and the constraint tying firm tenancy to it (section 5).
- **One register of methods.** The library spreads enrolment across `account`, `passkey`, `twoFactor`
  and `ssoProvider`; there is no single place to ask "what may this person use, and what do they hold".
- **Assurance on the session.** The library has no notion of how strongly a session was established.
- **Method policy** — the platform floor, the firm's permitted narrowing, and the resolution between
  them (section 4.4).
- **Home-realm discovery on a password submit.** The SSO plugin matches a domain when it is _asked_ to
  federate; it does not intercept `/sign-in/email`. The interception is ours (section 6).
- **Domain verification.** `ssoProvider` stores a `domain` and a `domainVerified` flag; nothing
  verifies anything (section 6.3).
- **The recovery hold** — pending recovery, announcement, delay, cancel-by-any-session, revoke-on-effect
  (section 7).
- **Step-up as a declared property of an operation** (section 8).
- **Portal identity** — external principal, multi-firm membership, a session with no active firm
  (section 5).
- **The enumeration fitness function** over every refusal builder (section 9).

### 3.3 Two library defaults that must be inverted, and pinned

**`magicLink({ disableSignUp: true })` is mandatory.** The default auto-registers an unknown address.
Membership on this platform is invitation-only and the public signup route already always refuses
(`emailAndPassword.disableSignUp: true`); a magic link that quietly creates a user would be a second,
unguarded door into the `user` table.

**The magic-link verify path's treatment of an unconfirmed account must be pinned by a test.** The
plugin's documented behaviour is that verifying a link for an existing **unverified** account removes
its password and revokes its sessions, on the reasoning that mailbox ownership is the source of truth.
That reasoning is defensible in general and is wrong here in one specific case: an invited member who
has redeemed but not yet set a password sits in exactly that state, and this platform must not let an
inbound link mutate a credential. The remedy is `disableSignUp` plus a Miniflare test asserting that a
verify against an unverified account leaves the `account` row untouched — the same canary discipline
`test/auth-audit.test.ts` already applies to the two-factor hook pairing.

**Account linking is set to explicit.** The library links accounts sharing an email address by default.
Set `disableImplicitLinking: true`, leave `trustedProviders` empty, and leave `allowDifferentEmails`
off. An identity provider that asserts an address it does not control would otherwise inherit a
password account, which is the single highest-value takeover in a federated design. Pinned by test.

### 3.4 Two lockouts must not both fire

The `twoFactor` plugin in 1.6.x has acquired its own failed-attempt lockout. The platform already has
one — shared across the password, the code and the recovery code, published in three headers, and
rendered by the sign-in screen. Two lockouts with different budgets means the number on the screen is
sometimes a lie, which is precisely the failure `attempt-ladder.ts` was written to avoid.

**Ours is the one the platform speaks.** The plugin's budget is configured strictly larger than ours so
it can never fire first, and a test pins the ordering by exhausting our ladder and asserting the answer
carries our `x-mc-*` headers and our problem type rather than the plugin's `ACCOUNT_TEMPORARILY_LOCKED`.
If a future version makes its lockout unconfigurable, the ladder middleware still refuses first,
because it sits above the plugin on the path.

### 3.5 Two plugins deliberately declined

**The `organization` plugin.** It is the obvious carrier for portal multi-firm membership and it is
still the wrong choice. Firm membership on this platform is a per-firm `member` row inside the
isolation boundary (ADR-0003, ADR-0068) with `user.firm_id` as the control-plane index; adopting
`organization` would put a second membership model in the control plane, give the session an "active
organization" the chokepoint would then have to distrust, and contradict the one-organization-per-user
line the white paper settled. For portal membership specifically, a purpose-built `portal_membership`
table is three columns and cannot grow an active-organization concept — which section 5.4 argues it
must never have.

**The `lastLoginMethod` plugin.** A non-httpOnly cookie naming the last method used is a small
disclosure on a shared machine, and it invites the sign-in surface to guess. This design's surface never
guesses: it offers what the **domain** resolved to, plus the methods the visitor can start without an
account lookup, and lets the person choose. That is one fewer thing to be wrong about, and it removes
the temptation to render a method list for a typed address — which is the enumeration oracle of
section 9.

---

## 4. The model — three nouns and a policy

### 4.1 Principal

**Who is asking.** One row, one `principal_kind`, fixed at creation:

| Kind            | Is                                        | Tenancy                                                 |
| --------------- | ----------------------------------------- | ------------------------------------------------------- |
| `firmMember`    | somebody who works at a firm              | exactly one firm, on `user.firm_id`                     |
| `portalClient`  | somebody a firm shares with               | zero or more firms, as `portal_membership` rows         |
| `platformStaff` | help-desk staff redeeming a support grant | no firm; the existing `platform_staff` table (ADR-0157) |

`platformStaff` is listed because the enumeration is exhaustive or it is not a model. It is unchanged
by this design; it already lives in its own table and never holds a firm.

### 4.2 Method

**How they prove it.** One row per enrolled credential in a new control-plane register:

```
authentication_method(
  id, principal_id, kind, status, label,
  assurance_ceiling, provenance, enrolled_at, last_used_at, revoked_at
)
```

`kind` is one of `password`, `passkey`, `totp`, `emailCode`, `oneTimeLink`, `recoveryCode`,
`identityProvider`. `provenance` records what created the row — a self-service enrolment, an
administered recovery, a domain-verified provider — because "how did this method get here" is the first
question asked after a takeover and the `account` table does not answer it.

**The register is a projection, not a second source of truth.** The credential material stays where the
library puts it: passwords and federated links in `account`, credentials in `passkey`, the seed and
backup codes in `twoFactor`, the provider in `ssoProvider`. The register is maintained by
`databaseHooks` on those models plus our own writes, and a fitness function asserts that every row in
the four library tables has exactly one live register row and vice versa. Two sources of truth about
credentials is how an account ends up with a method nothing can see; a projection with a reconciliation
test is not that.

Why a register at all, when the library tables exist: three of the four questions this design must
answer are asked _across_ the tables. "May this account use a password" is a policy question about a
principal, not a row in `account`. "Is this the last method" is a count across four tables. "What was
enrolled in the ninety minutes after that sign-in" is the takeover investigation, and it is unanswerable
without one ordered list.

### 4.3 Assurance

**How strongly they proved it.** A four-level total order, stamped on the session at establishment
along with the instant:

| Level               | Established by                                                                                               | Notes                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `mailbox`           | a one-time link or an emailed code, alone                                                                    | proves control of a mailbox at one instant, and nothing else |
| `credential`        | a password against a verified address; or a federated assertion carrying no multi-factor claim               |                                                              |
| `multiFactor`       | `credential` plus TOTP or an emailed code; or a federated assertion whose claims assert multi-factor         |                                                              |
| `phishingResistant` | a user-verifying passkey; or a federated assertion whose authentication-method claims are phishing-resistant | one gesture, both factors, bound to an origin                |

The session carries `assurance` and `authenticated_at`. `authenticated_at` is **not** `createdAt`: a
step-up re-verification moves it without minting a new session, and a session extended by activity does
not. Better Auth's `freshAge` compares against `createdAt`, so it is the wrong clock for step-up on its
own and is used only as the coarse backstop (section 8).

**The platform does not claim NIST AAL conformance.** The lattice is shaped by the same thinking, and
saying "AAL2" in a UI or a contract would be a claim about verifier impersonation resistance and
re-authentication cadence that nothing here evidences. The words above are the platform's own and mean
exactly what the table says.

### 4.4 Method policy — how the platform decides which method an account may use

Three layers, resolved most-restrictive-wins:

1. **The platform floor.** Non-negotiable, in code, the same shape as the permission registry: a
   `portalClient` may never hold an `identityProvider` method belonging to a firm; a recovery method
   must exist before a second factor may be the only way past a password; the last live method on an
   account cannot be removed.
2. **Firm narrowing.** A firm may require more and never less. It may require phishing-resistant
   methods for its members, disable one-time links for its members, or shorten its own federated
   session cap. It may not disable the second-factor floor, and it may not weaken any platform default —
   which is flag **F5**, recommended **no**, for the reason that a multi-tenant platform holding
   privileged material cannot let one tenant's configuration become the platform's weakest link and
   then defend the result.
3. **Enrolment.** What this principal actually holds.

**Effective methods = (floor ∩ firm) ∩ enrolled.** The sign-in surface never publishes that
intersection for an address it has not authenticated (section 9). It publishes what the **domain**
resolved to, which is a different and public fact.

Where the policy lives: the firm half is the existing declarative settings registry (ADR-0040,
ADR-0132's scoped resolver), so it inherits the resolution order, the audit, and the settings UI
already built. The platform floor is a module beside the permission registry, not a setting, because a
floor that can be written is not a floor.

### 4.5 What a sign-in is, in one line

```
(principal, method, evidence) -> session { principalKind, assurance, authenticatedAt, firmId? }
```

Everything in the rest of this document is a constraint on that arrow.

---

## 5. Client-portal identity is not firm-member identity

### 5.1 The claim, and why the current shape does not support it

The white paper already says the right thing: portal accounts are "a **distinct external principal
type** (never staff RBAC), linked to the per-firm Directory entity through the firm registry." The
build did not do that. `routes/session/invitations.ts` writes the same `INSERT INTO "user"` for both invitation
kinds, differing only in which row of `invitation` records the kind, and the community board — the first
surface that needed the distinction — had to reconstruct it with a correlated subquery over invitation
history.

Three things are wrong with that subquery, and only the first is the one usually noticed:

1. **It is a check.** Every surface that ever needs the distinction must remember to write it.
2. **It reads history, not state.** A portal client the firm later hires is marked forever. A firm
   member who was once a client of a _different_ firm is marked wrongly. Neither is hypothetical: a
   solo practitioner who is also a client of the firm handling their own estate plan is an ordinary
   fact pattern.
3. **It depends on a row nothing promises to keep.** Invitations expire, get revoked, and are the
   obvious candidate for a retention sweep. The day one is deleted, a portal client silently becomes a
   firm member to every reader of that query.

### 5.2 What would make it structural — four things, and each does a different job

**One. `principal_kind` on the account row, immutable.** `NOT NULL`, written only by the two paths that
create accounts, and protected by a SQLite `BEFORE UPDATE` trigger that `RAISE(ABORT)`s on any change.
An immutability trigger rather than discipline, for the same reason the invitation's three facts share
one digest: the handler becomes structurally incapable of the mistake.

**Two. Firm tenancy becomes conditional on the kind, enforced by a CHECK.**

```
CHECK ((principal_kind = 'portalClient') = (firm_id IS NULL))
```

This is the load-bearing one, and it is worth being precise about why. `user.firm_id` is the column
every firm-scoped surface reads to place a caller. Today it is populated for a portal client with the
inviting firm, so a surface that forgets the kind check places the portal client **inside that firm** —
open by default. With the CHECK, `firm_id` is `NULL` for a portal client, so the same forgetful surface
resolves no firm and answers the reserved cross-firm `404` (ADR-0052) — **closed by default**. The
difference between those two failure modes is the entire value of the change.

The cost is real and is stated rather than hidden: `firmId` stops being `required: true` on the Better
Auth user model and becomes `FirmId | null` in the type system, and every reader is forced by the
compiler to say what it does with `null`. That is a one-time cost paid by a compiler rather than an
ongoing cost paid by reviewers, and it is the cheapest moment to pay it — there are two account-creating
paths and both landed this week.

**Three. The principal kind rides the session, and route admission is metadata.** The session carries
`principalKind`, so no gate joins anything. `RouteMeta` gains `principals`, defaulting to
`["firmMember"]`, and the chokepoint gains one ordered step — **surface admission** — ahead of tenancy.
A route registered without it fails at startup exactly as a route naming an unregistered permission does
today. Exclusion becomes a property of registration, which is the mechanism this codebase already
trusts for authorization and idempotency.

**Four. A portal principal has no `member` row in any per-firm database.** RBAC resolves permissions
from `member`, gated on `status = 'active'`; no row means no permissions anywhere, in any firm, under
any bug. The portal's own authority comes from `PortalGrant` (ADR-0036) through a different resolver
that cannot read `member`. Two authority systems that cannot see each other's tables is a stronger
statement than one system with a flag.

With those four, the community worker's subquery becomes `session.principalKind === "portalClient"`,
read off the row it authenticated against, and its comment's stated intent is satisfied.

### 5.3 Membership in several firms

```
portal_membership(principal_id, firm_id, directory_entity_id, status, created_at)
```

One row per firm that has ever shared with this person. `directory_entity_id` is the link the white
paper requires — every external collaborator is a known, conflict-checkable Directory entity, never a
shadow user list. Status is `active` / `suspended`, and it is the firm's lever: a firm suspends its own
membership row without touching a person the other three firms still work with.

### 5.4 The portal session has no active firm, deliberately

The `organization` plugin's active-organization-on-session is the obvious model and it is the wrong one
here. A cross-firm leak in a portal is a stale active firm plus a grant lookup that trusts it, and that
bug is invisible in every test written by somebody holding one membership. So: **the portal session
carries no firm at all.** Every portal request names the grant it is exercising, the grant names its
firm, and the firm is derived from the grant on every single request. The unbuilt `workspace-selection`
capability is therefore answered — for a portal client there is nothing to select, because the surface
is the live aggregation of grants the white paper already describes. For a firm member there is nothing
to select either, because a firm member has exactly one firm.

### 5.5 One mailbox, two kinds

A person who is staff at one firm and a client of another needs two accounts, because
`principal_kind` is immutable and the whole design rests on that. Flag **F14**; recommended **two
accounts**, and the cost stated plainly: two credentials against one mailbox.

The mitigation is small and safe: after a successful authentication, if the same address also holds an
account of the other kind, the surface offers to switch to it. **After** authentication — offering it
before would be a free bit about an address nobody has proven they hold.

---

## 6. Home-realm discovery

### 6.1 The question, and why both easy answers are wrong

A firm has an identity provider. Its member types a password.

- **Silently refuse.** They believe their password is wrong, reset it, and the reset either does nothing
  (confusing) or does something (a live password on a federated account, which is the second door the
  firm bought SSO to close).
- **Silently allow.** The firm has a revocation point that does not revoke. Somebody dismissed on Monday
  still signs in on Tuesday with a password the firm's identity provider has never heard of.
- **Reveal as the address loses focus.** An anonymous prober learns `@somefirm.example` is a customer
  here, with SSO. For a law firm's client list, and increasingly for the firm's own vendor list, that is
  itself a disclosure.

### 6.2 What is answered, and about what

**Discovery is a fact about a domain, resolved on submit, and it says nothing about the address.**

The submit carries an address and a password. Before either is checked, the domain is resolved against
the verified-domain map. Exactly two answers:

- **`continue`** — proceed into the ordinary credential path, which has its own single neutral outcome
  set (session, second-factor challenge, or the one refusal).
- **`redirect`** — the domain is claimed by a verified provider. The answer carries the provider's
  display name and start URL, **the password is discarded unread**, and no ladder rung is spent because
  nothing was tested.

Why that is not an oracle: the map is keyed on a **verified** domain, and verification is a DNS TXT
record the domain's owner published. Anyone can already resolve it. The firm chose to make the fact
public, in the only way the platform accepts. So the answer discloses nothing that is not already
public — **provided** the map is only ever populated by domain verification and never by an
administrator pasting a list of addresses, which is why section 6.3 exists and why the ADR names it.

Two consequences worth stating:

- The answer must be **identical for a verified domain with no accounts at all** — a firm that verified
  a domain and then deactivated every member still redirects. Discovery is about the domain.
- A `redirect` costs no ladder rung and a `continue` may cost one. That difference is observable and is
  fine: it is the same domain-level public fact by another route.

The sign-in screen already renders exactly this: resolution on submit, the password field visible but
inert, and a sentence saying the typed password was not checked. No screen work is needed beyond wiring.

### 6.3 Claiming a domain

```
firm_identity_provider(
  id, firm_id, provider_id, protocol, domain, domain_verified_at,
  enforcement, display_name, created_at
)
```

`domain` is unique across the platform, so two firms cannot claim one domain and the first verified
claim wins. Verification is a DNS TXT record at `_magna-carta-challenge.<domain>` carrying a
per-firm nonce, re-checked on a cadence; a domain whose record disappears **stops redirecting** and
falls back to `continue` rather than locking the firm out. `domain_verified_at` being null means the
row exists and does nothing.

The generic-domain problem is real and is handled by a refusal, not a heuristic: a claim on a
well-known consumer mail domain is refused outright against a maintained deny-list, because
`@gmail.com` federating to one firm would redirect every unrelated visitor whose address happens to sit
there.

### 6.4 Enforcement modes

| Mode        | Discovery | The password credential                                                                            |
| ----------- | --------- | -------------------------------------------------------------------------------------------------- |
| `optional`  | no        | works; the provider is an additional door. The migration state.                                    |
| `preferred` | yes       | still works, reachable by an explicit control on the redirect card                                 |
| `exclusive` | yes       | **removed from the register** for every member of the firm — nothing to check and nothing to reset |

`exclusive` removes rather than ignores, because an ignored credential is a credential somebody can
still reset, phish, and later find working after a mode change.

**Break-glass.** An `exclusive` firm whose provider is unreachable — an outage, a misconfigured claim, a
vendor gone — is locked out of its own practice-management system, and no amount of protocol
correctness makes that acceptable. Flag **F10**; recommended: `exclusive` may only be turned on once the
firm's Owner holds an enrolled **passkey**, and that passkey keeps working. A passkey is
phishing-resistant, bound to hardware the Owner holds, and is not the identity provider — so it is the
one credential that survives the provider without being the password the firm asked the platform not to
hold.

### 6.5 Revocation, and its honest limit

The platform learns an identity provider revoked somebody only by that person failing to sign in again.
So `provisionUserOnEveryLogin` is on, and a **federated session is capped** — flag **F11**, recommended
twelve hours idle and seven days absolute, firm-narrowable. The platform-side lever is unchanged and
already works: deactivating the per-firm `member` row strips every permission at the read path.

**SCIM is out of scope** and is named here so the omission is deliberate. It is a whole provisioning
protocol, and the firm's own `member` deactivation already gates every permission read; the gap SCIM
would close is the interval between a revocation and the next sign-in attempt, which the session cap
bounds.

---

## 7. Recovery

This is the part the design spends its judgement on. Enrolment is easy; the question is what happens
when the method is gone, and a law firm's account holds privileged client material.

### 7.1 The frame

> Every recovery path is an authentication method with the ceremony removed.

So a recovery path is enrolled (it appears in the register), budgeted (it spends the shared ladder),
audited (it writes `auth_audit`), and rate-limited — or it is the account's weakest method and the
strength of everything else is decoration. A passkey defeated by "email us a link" is a mailbox
credential wearing a passkey's clothes.

### 7.2 The matrix

| What was lost                          | Path                                                                                                           | Why it holds                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| A passkey, other methods enrolled      | sign in with another method; remove the lost one from the register                                             | not a recovery at all, which is why the floor forbids removing the last other method while a passkey is the only one |
| A passkey, it was the only method      | **firm-administered**: an Owner or Admin issues a recovery invitation over the shipped three-fact machinery    | attributable, between people who know each other, and reuses code that already exists                                |
| The second factor, recovery codes held | spend one; the session drops to `credential` and must enrol a replacement before anything step-up-gated        | flag **F9**, recommended yes — a spent recovery code is a known-degraded state and should not be a quiet one         |
| The second factor, no recovery codes   | as "only method": firm-administered                                                                            |                                                                                                                      |
| The mailbox                            | changing the address of record is a step-up act at the account's **highest enrolled** assurance, plus the hold | see 7.4 — this is the chain that turns a brief mailbox compromise into a permanent account                           |
| The identity provider revoked them     | nothing. The firm decided.                                                                                     | deactivation, never deletion — their time entries and drafts remain the firm's record                                |
| The identity provider is gone entirely | the Owner's retained passkey (6.4), else platform-administered                                                 |                                                                                                                      |
| The sole Owner, everything             | **platform-administered**, bounded, held, two-person, notified                                                 | flag **F8** — see 7.5                                                                                                |

### 7.3 The hold — the one mechanism that makes recovery survivable

> **A recovery that lets somebody in at an assurance the enrolled methods would not have granted is
> announced, delayed, and cancellable by the losing party.**

1. It is recorded as a **pending recovery** with a stated effective instant.
2. **Every channel of record is notified immediately** — the address of record, every enrolled
   second-factor channel, and the firm's Owners and Admins. Not one channel: the attacker holds one.
3. Nothing takes effect until the **hold window** elapses. Flag **F7**; recommended 24 hours for a firm
   member, **zero** when a firm Admin who is not the subject administers it (an attributable human at
   the firm is a stronger control than a delay, and delaying them punishes the good path), 72 hours for
   a portal client.
4. **Any valid existing session, or one click of "this was not me", cancels it** and locks the account
   into administered-recovery-only. The person who still holds the account can always stop the person
   who claims to have lost it.
5. On effect, **every session is revoked** and **every method enrolled since the recovery was requested
   is removed**. A recovered account does not silently keep the attacker's newly enrolled passkey.

Point 5 has a converse that is cheap and closes the commonest takeover shape: **enrolling a method is
itself a notified event**, because the pattern is "get in once, enrol a passkey, stop caring about the
credential that got you there".

### 7.4 The address of record

Two invariants, stated separately because they close different halves of the same chain:

- **A one-time link is never accepted as authorization for the operation that changes where the links
  go.** Otherwise a mailbox held for ten minutes becomes an account held forever.
- **Changing the address of record is a step-up act at the account's highest enrolled assurance**, plus
  the hold, plus a notification to **both** addresses. The old address is the one that can say no.

### 7.5 Platform-administered recovery, and why the support framework does not stretch to it

The support-access framework (ADR-0157) is consent-anchored: a firm member requests help, and the
request _is_ the consent. A person who cannot authenticate cannot consent, so the framework does not
cover this and must not be bent to cover it — bending it would turn a consent model into a claim model.

So platform-administered recovery is its own thing, and it is bounded hard. Flag **F8**; recommended:
permitted, **only** where the firm has no other Owner or Admin who could administer it; a two-person
act by named `platform_staff` principals; the full hold, never zero; an `auth_audit` row naming both
staff principals; and a notification to the firm's billing contact of record, which is the one channel
an account attacker is least likely to also hold.

### 7.6 Four things refused outright

- **Knowledge-based answers.** A firm's own data is discoverable and much of it is in public court
  records. "What was your first matter number" is a question an opposing party can answer.
- **Support confirming identity by voice or by a scan of a document.** The platform has no identity-proofing
  capability, and pretending otherwise is worse than refusing — it produces a path attackers optimise
  against and staff feel obliged to satisfy.
- **A recovery link that mints a full-assurance session.** A link is `mailbox` assurance whatever it is
  called. It may start a recovery; it may not complete one.
- **Removing the old methods before the new one is proven.** The order is always prove, then replace.

---

## 8. Step-up, not all-or-nothing

The seam exists: `problem.ts` already carries `stepUpRequired`, set today only by the flagged-download
path, and `scan-policy-settings.ts` already stores a firm's preference for it. What is missing is that
step-up is decided by a handler.

**Step-up becomes a declared property of the operation**, on `RouteMeta`, enforced at the chokepoint in
a new ordered gate after RBAC and before idempotency:

```
stepUp: { assurance: "multiFactor", maxAge: 900 } | null
```

Unmet, it answers **403** with the existing `stepUpRequired` field — reuse, not a new contract shape
(golden rule 1). Better Auth's `freshAge` is the coarse backstop; the fine clock is the session's own
`authenticated_at`, which a step-up re-verification moves without minting a new session.

**The counter-rule, so it does not metastasise:** step-up is for acts that are **irreversible**, or that
**create a new way in**. Everything else is RBAC's job, and the trusted-insider model already answered
it. Writing a time entry on a sensitive matter is not a step-up act no matter how sensitive the matter.

Proposed list (flag **F12**, recommended `maxAge` 15 minutes):

| Act                                                           | Which limb       |
| ------------------------------------------------------------- | ---------------- |
| Changing the address of record; adding or removing any method | new way in       |
| Disabling a second factor; narrowing the firm's method policy | new way in       |
| Issuing an invitation of kind `firmMember`                    | new way in       |
| Registering or changing a firm identity provider              | new way in       |
| Creating or widening a `PortalGrant`                          | new way in       |
| Trust disbursement, and trust account configuration           | irreversible     |
| Bulk decryption of protected identifiers                      | irreversible     |
| Crypto-shred, firm deletion, whole-firm export                | irreversible     |
| Downloading a malware-flagged file                            | already designed |
| Redeeming a support grant at the privileged tier              | new way in       |

---

## 9. The enumeration posture, generalised

The invitation fix established the rule for one route. The sweep that followed found the pattern
generalises, and four methods multiply the failure paths, so it becomes a test rather than a habit.

**Every refusal on an unauthenticated surface passes four checks:**

1. **One refusal per surface, built in exactly one function**, with nothing row-derived in it. (The
   reference is `neutralRedemptionRefusal`.)
2. **Any number in it is the caller's own** — never a count belonging to the thing being probed.
3. **The work does not vary with what was found** — the unmatchable-digest comparison, the balancing
   write, the same hashes on every path.
4. **The difference goes to the channel, not to the caller** — where there is something to say, it is
   said in mail to the address in question. (The reference is the registration address-in-use branch.)

**A fitness function** (`lint:refusal-neutrality`, modelled on the shipped `lint:conflicts-vocabulary`)
asserts that every handler on a `surface: "public"` route reaches at most one refusal-constructing
function, and that no such function takes a parameter derived from a database read. It cannot prove
neutrality; it can prove that a second construction site was added, which is how a neutral answer stops
being neutral.

**Per method, the specific oracle to close:**

- **Passkey.** Sign-in uses a **discoverable** assertion with an empty `allowCredentials` and takes no
  address. Supplying an allow-list for a typed address publishes how many passkeys that address holds
  and their credential ids. Registration options are minted only for an authenticated session. A failed
  assertion is the same neutral sentence as a wrong password and spends the same rung.
- **One-time link.** Requesting one always answers the same body in the same time, for an unknown
  address, a known one, and a federated domain — the federated case sends mail saying the firm signs in
  through its provider, to the address, not to the caller. Verifying a spent, expired or unknown token
  is one refusal.
- **Identity provider.** Discovery answers about the domain (section 6.2). The provider's own errors are
  never relayed; an assertion the platform will not accept produces the platform's one neutral sentence.
- **Portal.** Which firms hold grants for an address is rendered only after authentication. The portal
  sign-in surface must never differ by whether the address has grants at one firm or four.

---

## 10. What this design does not decide

- **The screens.** The sign-in surface already models discovery, the ceremony and the channels; this is
  a server design plus the wiring, and the settings surfaces for method management are a later slice.
- **SCIM**, and any push-based revocation from an identity provider (6.5).
- **Ethical walls**, which remain deferred at the white-paper level and are named only because a portal
  grant's least-privilege invariant refers to them.
- **The e-signature attribution spectrum**, which reads assurance from this design and is otherwise its
  own subsystem.
- **Whether the attempt ladder becomes a Durable Object** is flagged (**F15**) rather than assumed,
  though the recommendation is yes: per-isolate honesty gets more expensive with four methods sharing
  one budget.

---

## Flagged for the owner

Each changes the platform's security posture, so each is the owner's call. Every one ships as a
mechanism with the recommended default as a configurable value — nothing below is hard-coded.

| #       | Question                                                                                          | Recommended default                                                                          |
| ------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **F1**  | May a user-verifying passkey stand alone as the whole credential, with no separate second factor? | **Yes** with user verification; **no** for a security key without it                         |
| **F2**  | May a one-time link establish a session on its own?                                               | **Yes**, at `mailbox` assurance only, and never satisfying a step-up gate                    |
| **F3**  | May a firm disable one-time links for its own members?                                            | **Yes** — narrowing only                                                                     |
| **F4**  | May a firm require phishing-resistant methods, locking out members who have not enrolled?         | **Yes**, with an enrolment grace window and a guard against the Owner locking themselves out |
| **F5**  | May a firm weaken a platform default for its own members?                                         | **No.** A floor that can be written is not a floor                                           |
| **F6**  | Is a second factor required of every firm member?                                                 | **Yes**, with 14 days' grace from first sign-in                                              |
| **F7**  | The hold window for a recovery                                                                    | 24h firm member · **0** when a firm Admin administers it · 72h portal client                 |
| **F8**  | Is platform-administered recovery permitted, and how bounded?                                     | **Yes**, sole-Owner case only, two-person, full hold, audited, billing contact notified      |
| **F9**  | Does spending a recovery code force enrolment of a replacement before anything step-up-gated?     | **Yes**                                                                                      |
| **F10** | Which SSO enforcement modes ship, and does `exclusive` require the Owner to hold a passkey first? | All three; **yes**, required                                                                 |
| **F11** | The federated session cap                                                                         | 12h idle, 7d absolute, firm-narrowable                                                       |
| **F12** | The step-up list (section 8) and its `maxAge`                                                     | The ten acts listed; 15 minutes                                                              |
| **F13** | May a portal client hold a passkey and a second factor, and may a firm require one per grant?     | **Yes** and **yes** — the per-share assurance model already says so                          |
| **F14** | One mailbox that is staff at one firm and a client of another: one account or two?                | **Two.** The switch offer appears only after authentication                                  |
| **F15** | Does the shared attempt ladder move to a Durable Object in this work?                             | **Yes**, in slice 1                                                                          |

---

## Sources

Better Auth documentation, read 2026-08-13: [passkey](https://www.better-auth.com/docs/plugins/passkey) ·
[magic link](https://www.better-auth.com/docs/plugins/magic-link) ·
[email OTP](https://www.better-auth.com/docs/plugins/email-otp) ·
[SSO](https://www.better-auth.com/docs/plugins/sso) ·
[two-factor](https://www.better-auth.com/docs/plugins/2fa) ·
[captcha](https://www.better-auth.com/docs/plugins/captcha) ·
[one-time token](https://www.better-auth.com/docs/plugins/one-time-token) ·
[organization](https://www.better-auth.com/docs/plugins/organization) ·
[last login method](https://www.better-auth.com/docs/plugins/last-login-method) ·
[session management](https://www.better-auth.com/docs/concepts/session-management) ·
[users and accounts](https://www.better-auth.com/docs/concepts/users-accounts).
[`@better-auth/sso` on npm](https://www.npmjs.com/package/@better-auth/sso) (MIT, 1.6.23).
