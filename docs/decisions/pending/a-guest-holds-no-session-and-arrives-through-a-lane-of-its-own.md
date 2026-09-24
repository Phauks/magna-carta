---
slug: a-guest-holds-no-session-and-arrives-through-a-lane-of-its-own
status: Proposed
area: Meetings
date: 2026-09-24
summary: "A meeting guest from outside the firm is admitted on a signed, expiring link for one Directory entity on one meeting, not on a session. Six decisions carry it: a guest is a Directory entity on the event, never a free address; the link proves possession of a mailbox and nothing more, so it brings its holder to the lobby and a host admits them; a guest holds no session and never will, so the chokepoint gains a step-zero guest lane that stashes a firm and the credential and never a user id; a guest's stay is a table of its own shaped like a member's, so meeting_attendance.user_id keeps its NOT NULL and its foreign key; the guest arrives on the application's own origin, outside the signed-in shell; and two names are kept, the Directory name the link was minted for and the name typed at the door. It is a stopgap with a named successor: the client portal's PortalGrant subsumes the link and absorbs the two tables when it lands."
---

**A meeting guest holds no session and never will, so the chokepoint admits one through a lane of its
own rather than through a widening of the session path.**

**Context:** a hearing, a settlement conference and a client call have people in them who are not
members of the firm, and a participant in a meeting was, until this, somebody holding a session. The
client portal's `PortalGrant` is the real answer to "somebody outside the firm may reach this", and
it is not started. The design is
[`docs/specs/2026-09-20-meetings-external-guests-design.md`](../../specs/2026-09-20-meetings-external-guests-design.md).

**Decision — six rulings, and the rest follows from them.**

1. **A guest is a Directory entity on the event** — a `directoryPerson_` or `directoryOrganization_`
   participant of kind `entity`. Never a free e-mail address, so the record always names somebody the
   firm knows and the conflicts corpus can see. An `external` participant carrying only a typed name
   cannot be invited until a member deliberately promotes them into the Directory.
2. **The link proves possession of a mailbox and nothing else**, so it never admits anybody by itself.
   Its holder always waits at the door, whatever the meeting's lobby setting, and a host admits them.
   Opening the link spends nothing; pressing Join spends one of a bounded number of arrivals.
3. **A guest holds no session and never will.** A route declares `guestLane: "invitation" | "grant"`;
   the chokepoint runs a step zero INSTEAD of the session, member-active and permission steps, and
   what it hands the handler is a firm and the credential's names — never a user id and never a
   permission set — so a member handler pointed at a guest route fails on its first line.
   Registration refuses a lane route that names a permission, is authenticated, or sits outside
   `surface: "app"` and `resource: "firm"`, and a guest's credential presented to any other route is
   answered the reserved 404. Resolving the guest's firm is a method of its own
   (`resolveGuestFirmContext`) rather than a flag on the member resolver, whose member-active check is
   the one thing a guest cannot pass and a member must never skip.
4. **A guest's stay is its own table, shaped like a member's** (`meeting_guest_stay` beside
   `meeting_attendance`), so the member table keeps `user_id NOT NULL` and its foreign key to
   `member`. Presence becomes a union over both tables, composed in one place, so the live count, both
   ceilings, the roster and the lobby list cannot disagree about who is present.
5. **The guest arrives on the application's own origin**, at a route outside the signed-in shell,
   because the meeting's media permissions and the socket's same-origin check are properties of that
   origin.
6. **Two names are kept** — the Directory name the link was minted for and the name typed at the
   door — because the difference between them is the whole of what a forwarded link leaves behind.

**The credential.** The link is a token in the support session's signed format
(`base64url(payload).base64url(HMAC-SHA-256)` under the platform secret) with a `typ` of its own,
carrying a 256-bit secret whose SHA-256 alone is stored on the invitation row. The signature lets a
public route turn away guessed tokens with no database read; the row lets a withdrawal, a rotation or
an expiry refuse a perfectly-signed token at once. An arrival mints a shorter-lived GRANT carrying the
guest's stay and no secret, which rides every later guest request and — because a browser cannot set
a header on a WebSocket — the socket upgrade's `guest` query parameter, on that one route only.
Neither credential is ever logged, audited, counted, stored in the idempotency record or returned to a
host.

**Consequences.** The room builds every frame that names a user per viewer, so a guest's socket holds
no firm user identifier. The guest reads a summary of its own schema rather than the member's with
fields nulled, and no guest route carries a meeting identifier in its path. A guest's chat line has no
member behind it, so only a host may take it back.

**Successor.** This is a stopgap with an explicit successor: when the client portal's `PortalGrant`
lands it subsumes the link, and `meeting_guest_invitation` and `meeting_guest_stay` are the tables it
absorbs. Nothing here is shaped to outlive that.
