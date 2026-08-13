---
category: Added
audience: internal
---

Unified identity and authentication methods — the design for passkeys, one-time sign-in links, firm
identity providers and client-portal identity, treated as one surface rather than four bolt-ons.
Design only: a spec, a six-slice implementation plan, and six ADR fragments. No application code, no
schema, no migration.

**The framing sentence comes first and everything inherits it.** A method proves you are the principal;
it never decides who the principal is, and it never decides what the principal may then do. The failure
the design exists to prevent is a method quietly acquiring one of the other two jobs — and one instance
of that is already in the tree, where a credential-issuing event (the invitation's `kind`) is the only
record of whether an account is staff or a client.

**Three nouns carry the whole surface.** A **principal** with an immutable `principal_kind`; an
**authentication-method register** projected over Better Auth's four credential tables, because three of
the questions the platform must answer — may this account use a password, is this the last method, what
was enrolled after that sign-in — are asked across those tables and answerable in none of them; and an
**assurance** level (`mailbox` < `credential` < `multiFactor` < `phishingResistant`) with an
`authenticated_at` stamped on the session. Which methods an account may use resolves most-restrictive-wins
over a platform floor that is code beside the permission registry, firm narrowing through the settings
registry, and actual enrolment.

**Client-portal identity becomes structural, and the load-bearing half is the one usually skipped.**
`principal_kind` is NOT NULL with an immutability trigger, `RouteMeta` gains `principals` enforced by a
new chokepoint admission gate, and a portal principal holds no per-firm `member` row so RBAC grants it
nothing anywhere. But the change that matters is
`CHECK ((principal_kind = 'portalClient') = (firm_id IS NULL))`: `user.firm_id` is what every
firm-scoped surface reads to place a caller, so leaving it populated for a portal client makes a
forgetful surface fail **open** inside that firm, while emptying it makes the same surface resolve no
firm and answer the reserved cross-firm 404. The community board's invitation-counting subquery — whose
own comment asks for exactly this — becomes one session field.

**Recovery is the part the design spends its judgement on**, because recovery is where account takeover
lives and any method can be added. Every recovery path is an authentication method with the ceremony
removed, so it is enrolled, budgeted against the shared ladder, and audited as one — a passkey defeated
by "email us a link" is a mailbox credential wearing a passkey's clothes. The mechanism is a hold:
announced immediately to every channel of record plus the firm's Owners and Admins (never one channel,
because the attacker holds one), delayed, cancellable by any valid session or one click from any
notified channel, and on effect revoking every session and every method enrolled since the request.
Its converse closes the commonest takeover shape — enrolling a method is itself a notified event. The
primary path is firm-administered and reuses the shipped three-fact invitation machinery; platform
recovery is bounded to the sole-Owner case and deliberately not routed through the support-grant
framework, which is consent-anchored and cannot stretch to somebody who by definition cannot consent.
Four paths are refused outright, including knowledge-based answers, since a firm's own data is largely
in public court records.

**Home-realm discovery answers about a domain, never an address.** Silently refusing and silently
allowing are both wrong, and resolving on blur is worse than either. Discovery resolves on submit
against a domain the firm verified by publishing a DNS TXT record — a fact anyone can already resolve —
which is why the map may only ever be populated by verification and never by an administrator pasting a
list of addresses. `exclusive` enforcement removes the password from the register rather than ignoring
it, and cannot be turned on until the firm's Owner holds a passkey, because a provider outage must not
lock a firm out of its own practice-management system.

**The library was verified rather than assumed**, per golden rule 11: Better Auth supplies passkeys,
magic links, email OTP, Turnstile, cross-domain one-time tokens, `session.freshAge`, and — as a separate
MIT package — OIDC and SAML single sign-on with domain matching. It supplies no principal kind, no
method register, no assurance, no domain verification, no interception of a password submit, and no
recovery hold. Two of its defaults are inverted and pinned by test because both are wrong for an
invitation-only platform: magic-link auto-registration, and its documented removal of an unverified
account's password on verify, which lands on exactly the state an invited member occupies between
redemption and setting a password. Account linking is set explicit for the same class of reason. Three
stale facts in the tree are scheduled for repair in slice 1, including the two-factor plugin's own new
lockout, which would otherwise disagree with the platform's published attempt budget.

**Step-up becomes route metadata** over the `stepUpRequired` field the problem contract already carries
for the malware-flagged download, with a counter-rule so the gate does not metastasise: step-up is for
acts that are irreversible or that create a new way in, and everything else is RBAC's job.

Fifteen questions are flagged rather than decided, each shipping as a configurable value with a
recommended default: whether a passkey may stand alone, whether a link may establish a session, whether
a firm may narrow or weaken a control, the second-factor floor and its grace, the three recovery hold
windows, platform-administered recovery, forced re-enrolment after a spent recovery code, the single
sign-on enforcement modes and break-glass, the federated session cap, the step-up list, portal method
strength, whether one mailbox that is staff at one firm and a client of another gets one account or
two, and whether the shared attempt ladder becomes a Durable Object. Every one of them changes the
platform's security posture, which makes it the owner's call and not the design's.
