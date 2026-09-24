---
category: Added
audience: public
---

**A meeting can have a guest from outside the firm, on a signed link.** Two additive per-firm tables
join the lineage (`meeting_guest_invitation`, `meeting_guest_stay`, migration
`20260924T090000_a-guest-holds-a-signed-link-and-a-stay-of-its-own`). An invitation is one row per
Directory person or organization per meeting, holding only the SHA-256 of the link's secret; a stay
is the guest's own presence in the room, beside `meeting_attendance` rather than a nullable column on
it. The in-the-room and waiting predicates are now unions over both tables, composed in one place
(`MEETING_STAY_TABLES`), so a guest counts against the room's and the door's ceilings exactly as a
member does.

**The chokepoint has a guest lane.** A route declaring `guestLane: "invitation" | "grant"` is
admitted by a signed credential in the `x-meeting-guest` header — or, on the socket upgrade alone,
the `guest` query parameter — in place of the session, member-active and permission steps. The
handler gets a firm and the credential's names and never a user id. Registration refuses a guest
route that names a permission or is authenticated, and a guest credential sent to any other route is
answered the reserved 404. The credential shares the support session's signed format
(`src/signed-token.ts`) under its own `typ`.

**Ten routes.** A host (`meetings:host` and a grant on the meeting) invites, lists, rotates and
withdraws links under `/api/v1/meetings/{meetingId}/guests`; the invitation is mailed after its batch
commits and the token is never returned, stored or logged. A guest reads a reduced summary
(`GuestMeetingSummary`, a schema of its own with no matter or event field), arrives at the door,
opens the socket, reads and sends chat once admitted, and leaves, under `/api/v1/guest/*` with no
meeting identifier in any path. Opening the link spends nothing; an arrival does, up to twenty.

**The room redacts per viewer.** `welcome`, `roster`, `roster-delta` and `message` frames are built
for the socket they go to: a guest's copy carries `userId: null` for everybody. Roster entries and
the hosts' `waiting` list gain `kind` (`member` | `guest`), and a waiting guest's entry carries the
name the link was minted for (`invitedName`) beside the name typed at the door.

## Public

**Invite a client, opposing counsel or an expert to a meeting with a link.** A host can send a
one-time link to anybody in the Directory who is on the event. They open it, confirm their name,
check their camera and microphone, and wait at the door until a host lets them in — a guest always
waits, whatever the lobby setting. The host sees the name they typed beside the name the link was
sent to, so a forwarded link is easy to spot.

**A guest sees the meeting and nothing else.** No matter, no calendar, no colleagues' accounts — the
room, the chat and the people in it by name.

**Links are yours to control.** Send a fresh link if one went to the wrong place (the old one stops
working at once), or withdraw it, which also removes the guest from the room. A link stops working a
couple of hours after the meeting ends.
