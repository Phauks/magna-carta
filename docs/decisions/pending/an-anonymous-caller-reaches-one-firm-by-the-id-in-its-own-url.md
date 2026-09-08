---
slug: an-anonymous-caller-reaches-one-firm-by-the-id-in-its-own-url
status: Accepted
area: Client intake
date: 2026-09-07
summary: "The public intake form is the platform's first surface where an unauthenticated caller writes into a FIRM's database rather than the control plane, and the URL is what names the firm: /enquiry/{firmId}/{publicToken}, resolved by addressing the FirmDatabase Durable Object with the id in the path — the same firmDatabaseFor seam the queue consumers and the cron already use with no session. A firm-chosen vanity path was rejected for this slice because a vanity path is a GLOBAL namespace that per-firm databases cannot enforce uniqueness over: it needs a control-plane routing table written in the same act as the per-firm form, which is a cross-database write needing the outbox, plus the reserved-namespace machinery — all of it additive later as an alias resolving to the same pair, and none of it needed to make the feature work. The per-form token is separate from the form id because it is ROTATABLE: a firm whose link has been scraped mints a new one and the old link stops resolving, keeping the form, its versions and its submissions. What the path leaks is recorded rather than denied — anyone holding the link learns the firm's internal handle, which is not a secret and grants nothing without a session. The disclosure discipline is enforced by construction: the resolver filters on published status inside its SQL so a draft form, a closed form, a rotated token and a token that never existed are one 404 with one body, and the submission path performs NO lookup against firm data, because a read whose duration varies with what a visitor typed hands a probing script an oracle from the clock."
---

**A public form belongs to one firm, and the URL has to say which — without a global table to look it up in.**

**Context:** Every public route the platform had built was control-plane business: registration, invitation
redemption. Each writes one control-plane row and nothing else, so none of them ever needed to reach a tenant's
own database. The chokepoint resolves a firm from a session, and on `surface: "public"` there is no session.

The public intake form breaks that pattern by necessity. A submission is a firm's own record and belongs in the
firm's own database; there is nowhere else for it to go that does not create a second tenancy model.

**Decision:** The URL carries both halves — `/enquiry/{firmId}/{publicToken}` — and the route addresses the
firm's `FirmDatabase` Durable Object by the id in its own path. The mechanism was never missing:
`firmDatabaseFor` already addresses a firm by id with no session at all, and the queue consumers and the cron are
its existing callers. What was missing was only how an anonymous caller names the firm, and a path segment is the
honest answer.

**Not a firm-chosen vanity path**, though the white paper anticipates one. A vanity path is a **global** namespace
— two firms cannot hold `/apply/personal-injury` — and global uniqueness cannot be enforced from inside per-firm
databases. Delivering one means a control-plane routing table written in the same act as the per-firm form, which
is a cross-database write needing the outbox, plus the reserved-namespace machinery that stops a firm's path
shadowing a system route. Every piece of that is real work and none of it is needed for a firm to take enquiries.
It is also purely additive: a control-plane alias resolving to the same `(firmId, publicToken)` pair can be added
later without touching the form model, the submission path, or a single stored row.

**Not the form id as the URL's second segment.** Both are opaque, so the difference is not secrecy — it is that a
token can be **rotated**. A firm whose link has been scraped and is being flooded mints a new one, the old link
stops resolving, and the form, its versions and its submissions all stand. An id cannot do that; it is the
identity of the record, and changing it would orphan everything that names it.

**What the path leaks, recorded rather than denied.** Anyone holding the link learns the firm's internal handle.
That handle appears in no confidential context and grants nothing without a session, and the alternative — an
opaque token resolved through a global table — costs exactly the control-plane table this decision avoids. The
trade is written down so it is not rediscovered later as a defect.

**Consequences:** The two anonymous routes carry `surface: "public"`, `authenticated: false`, `permission: null`
and the `auth` rate-limit bucket — the registration route's posture, for the same reason: it is the tightest
bucket the platform has and it is sized to stand alone, which is what makes the still-dormant human verification
survivable. Idempotency is `optional`, because a stranger's browser mints no key and requiring one would make the
form unusable from a plain post; a double submission is a duplicate row triage dismisses, which is far cheaper
than deduplicating by content — that would be the firm-data read the disclosure rule forbids.

The disclosure discipline this opens the door to is enforced structurally rather than by review. The status filter
lives inside the resolver's SQL, so a draft form, a closed form, a rotated token and a token that never existed
are indistinguishable — a route that fetched the row and then decided would answer measurably differently for a
form that exists. And the submission path performs no lookup against firm data at all: no duplicate detection, no
entity resolution, no conflicts check, no matter-type routing. Each of those is available a moment later on the
staff side, where the reveal is authorised and the timing tells nobody anything.
