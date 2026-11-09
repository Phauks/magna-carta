# Support Access Framework — backend rails (design)

**Status:** Design. Scope is the backend framework and permissions only — identity, grants, enforcement,
consent, audit. UI (a support console and the privileged "view-as" render path) and the notification
transport are deferred named seams, staged like the release-channels backend rails.

**White-paper areas:** _Authentication & encryption_, _Tenancy & data isolation_, _Observability &
diagnostics_. **Touches:** the control-plane schema, the access-control registry, the worker chokepoint,
and the `auth_audit` lineage.

---

## 1. Problem & posture

Help desk will need to access the instances a firm is using to diagnose problems. For a legal
practice-management platform this collides head-on with the product's core guarantee: each firm's
sensitive data is envelope-encrypted (a per-firm data key wrapped under `ROOT_KEK`; `protected()` values
unreadable without unwrapping it), telemetry redacts by default, and the platform deliberately cannot
casually read firm content. Support access cannot become a back door around that posture — it must be a
constrained, attributed, expiring path _through_ the same enforcement everything else traverses.

Two design facts make this tractable:

- The worker **chokepoint** already runs every `/api/v1` route through `tenancy → authn → RBAC →
  idempotency → rate-limit`. A request's authority is a `SessionContext { userId, firmId }` (the firm
  comes from the session, never the URL) plus an effective-permission set resolved against that firm's
  database.
- A **platform-admin surface** and a control-plane `auth_audit` trail already exist as seams.

The framework slots a support session into the _existing_ `SessionContext` model rather than bypassing
it. Support enters through the same front door — with a constrained, expiring, named authority.

## 2. Core concept — a support grant is an alternate principal at the chokepoint

The whole feature is one idea:

> A firm member's request mints a **time-boxed grant**; a **named staff principal** redeems that grant to
> obtain a `SessionContext` the chokepoint already understands, carrying a permission set bounded by the
> grant's tier.

Support is **pull, not push.** Help desk can never open a session unilaterally — a session exists only
because someone inside the firm requested help. That request _is_ the consent and the audit anchor. There
is no help-desk-initiated path.

Two tiers, one mechanism:

| Tier         | What it reaches                                                 | Who requests                             |
| ------------ | --------------------------------------------------------------- | ---------------------------------------- |
| `diagnostic` | System state only — never decrypted client content              | Any firm member                          |
| `privileged` | Exactly the requester's own authority (`scope: self`) — no more | Any firm member (optional admin co-sign) |

The privileged tier rests on one realization: if a privileged session grants help desk _precisely the
requesting member's own authorization and nothing more_, then **no firm-level privilege is expanded.**
Help desk sees what that one already-authorized user could pull up themselves — the digital equivalent of
the user turning their monitor around, with their consent, for a bounded time. The client's
confidentiality envelope is never widened.

## 3. Identity — `platform_staff` (control plane)

A new control-plane table, parallel to but separate from firm `user` (every `user` belongs to exactly one
firm, so staff cannot be firm users). Named per-person credentials, **MFA mandatory**, a minimal role set
(`support`, `support_lead` — the latter gates privileged-tier eligibility). No elaborate RBAC tree yet.

The redeemer is modelled as a **principal**, not hardcoded as a human:

```
principal = { principalType: "staff" | "agent", principalId }
```

The `agent` variant is reserved, not built — the far-flung AI-agent help-desk case is the _same_ grant
machinery with a tighter scope and its own credential, added later behind this abstraction. Building
nothing agent-specific now keeps that future additive.

The existing `PLATFORM_ADMIN_KEY` bearer key stays for **machine/provisioning** ops only; **humans never
use it** for support access. A shared bearer token cannot attribute an action to a named person, and
per-person attribution is the entire value of this feature.

## 4. The grant — `support_grant` (control plane, firm-linked)

One row per support request.

| Field               | Meaning                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| `id`                | Grant handle.                                                           |
| `firmId`            | The firm the grant authorizes access to.                                |
| `requestedByUserId` | The firm member who requested help — the consent anchor.                |
| `tier`              | `diagnostic` \| `privileged`.                                           |
| `scope`             | `self` — pins privileged access to the requester's own authority.       |
| `status`            | `requested → active → expired \| revoked \| closed`.                    |
| `reason`            | Free-text request reason (redacted lineage — non-privileged).           |
| `principalId`       | The staff/agent principal that redeemed the grant (null until claimed). |
| `requiresCosign`    | Set when firm policy demands admin co-sign for a privileged grant.      |
| `cosignedByUserId`  | The admin who co-signed, when required (else null).                     |
| `expiresAt`         | Hard time-box (ISO-8601 UTC). Access ends here regardless of activity.  |
| `createdAt`         | Request instant.                                                        |

The grant lives in the **control plane** (it is cross-firm platform state and links a platform principal
to a firm), not the per-firm database.

## 5. Enforcement — how a grant becomes authority

A support-redeemed request resolves to a `SessionContext { userId, firmId: <granted firm> }` tagged with
`support: { grantId, principalId, tier }`. The permission set is then computed by tier:

- **`diagnostic`** → a fixed, _additive_ allow-list from a new read-only namespace in the access-control
  registry (`diagnostics:*` — system state, audit/event timelines, job/queue status, config/flags,
  storage/usage). It contains **no** `view*`/decrypt permission, so the existing audited-decrypt gates
  (`incidents:viewDescription`, `directory:viewSensitiveIdentifiers`, the secret store, …) **never
  open**. Privileged content is unreachable _by construction_, not by promise.
- **`privileged` + `scope: self`** → exactly `loadEffectivePermissions(firmDb, requestedByUserId)`: the
  requester's own effective permissions, nothing more. No firm-level escalation can occur.

Server-side decryption is **unchanged** — the firm data key unwraps inside the worker as it always does,
gated by the permission set above; plaintext never leaves our compute. The grant's `expiresAt` and
`status` are checked per request: an expired or revoked grant makes the support session resolution return
null → an ordinary RFC 9457 `401`, never a special-cased bypass.

**Settled decisions:**

1. The diagnostic set is a **brand-new `diagnostics:*` namespace** in the access-control registry — clean
   separation, one home — not a reuse of scattered existing read keys.
2. Authority resolution for a privileged session stays keyed to the **requester's own `userId`** (so the
   permission set is exactly theirs), while the redeeming **staff/agent principal id is stamped into every
   audit row** — so attribution is unambiguous even though authority mirrors the requester.

## 6. Consent, notification, revocation

- **Diagnostic:** any firm member requests; firm admins are **notified** (in-app + email — a _seam_ now,
  wired with the notifications subsystem later) and can **revoke** at any time.
- **Privileged:** self-scoped, admin-notified, with an **optional** `require_cosign` firm policy (default
  off) that inserts an admin approval step before the grant goes `active`. This mirrors the existing
  scoped-setting / step-up-reauth firm-policy pattern. Self-scoping already bounds the blast radius to one
  user's own access, so co-sign is a hardening a firm may opt into — not the default.
- **Revocation** flips `status` to `revoked` and invalidates in-flight access on the next request (same
  per-request check as expiry).

## 7. Audit — the product surface

Every grant lifecycle transition (`requested`, co-signed, `active`/redeemed, `revoked`, `expired`,
`closed`) and every support-context request is written to an audit trail extending the control-plane
`auth_audit` lineage, attributed to the **named principal** and **firm-visible**. This trail is what a
firm reads to see _who_ looked, _when_, _why_, and at _what scope_ — it is the feature's product surface.
House redaction still binds: the audit records _that_ an action happened and against which resource,
never privileged content.

## 8. Deferred — named seams, not built now

- **UI** — the platform-side support console (diagnostic) and the privileged **view-as** render path
  (loading the firm SPA under a server-issued, scoped view-as grant). The rails make both additive.
- **Notification transport** — the in-app + email admin notifications (seam; wired with notifications).
- **AI-agent principals** — the `agent` principal variant and its tighter scope policy.
- **Fleet/cross-firm support dashboard** — any platform-wide view across firms.

## 9. Why these choices

- **One primitive, two scopes.** Diagnostic and privileged share the request-creates-grant backbone and
  differ only by a `tier`/`scope` flag and the resulting permission set — minimal states, minimal code.
- **Safety by construction over safety by promise.** Diagnostic cannot reach privileged content because
  the permission set lacks decrypt keys; privileged cannot escalate because it is the requester's own
  authority verbatim. Neither relies on a procedural "don't look."
- **Attribution is the product.** Named principals + a firm-visible audit trail are what make support
  access defensible for a privilege-bearing legal tool.
- **Reuses the chokepoint.** Support is an alternate principal entering the existing enforcement chain,
  not a bypass around it.
