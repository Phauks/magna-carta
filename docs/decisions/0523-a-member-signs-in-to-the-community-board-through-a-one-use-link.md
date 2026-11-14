---
number: 523
slug: a-member-signs-in-to-the-community-board-through-a-one-use-link
status: Accepted
date: 2026-11-13
area: Community
summary: "The community board lives on its own host and cannot read the app's session cookie, so a signed-in member crosses to it through a one-minute, one-use link the app mints (GET /api/v1/me/community-handoff), signed with COMMUNITY_HANDOFF_SECRET, which only the app's worker and the board's worker hold. The board records the link's id so it works once, sets its own host-only cookie, and reads the person's firm and team standing from the control plane on every request. Chosen by the owner's 2026-11-13 delegation over a shared parent-domain cookie and over a second sign-in on the board."
---

**A member signs in to the community board through a one-use link from the app.**

**Context:** the board is `community.magnacarta.esq`, its own origin by design
([`docs/specs/2026-08-11-community-surfaces-design.md`](../specs/2026-08-11-community-surfaces-design.md)),
and the app's session cookie is host-only on `magnacarta.esq`. Three ways across were weighed: widen
the app's cookie to the parent domain so the board can read it; give the board its own sign-in
against the same accounts; or have the app hand the person across with a short-lived signed link.

**Decision.** The handoff link. The app mints a token naming the person, a random id and an expiry
one minute out, signed with `COMMUNITY_HANDOFF_SECRET`. The board's worker verifies it, records the
id in `community_session_handoff` so a second use is refused, and sets
`__Host-community_session` (HttpOnly, Secure, SameSite=Lax, thirty days). Every request then reads
the person's firm and any unexpired platform-operator grant from the control plane, so leaving a firm
ends the right to post at once. Writes also require the request's `Origin` to be the board itself.

**Consequences.** The app's own session cookie never leaves its host, so a fault on the board cannot
read or replay it, and the board's secret cannot forge an app session because it is not
`AUTH_SECRET`. Signing out of the app does not sign the person out of the board; the board has its
own "sign out", and its cookie ends after thirty days. Both workers need the secret before anyone can
sign in, and the board stays readable without it.
