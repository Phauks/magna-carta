---
category: Added
audience: public
---

**Meeting guests by name and e-mail address.** `POST /api/v1/meetings/{meetingId}/guests/by-address`
(`meetings.inviteGuestByAddress`) takes a typed name and address. `addGuestByAddress` in
`packages/meetings/src/guest-by-address.ts` matches the address to the Directory entity that holds it,
or composes a Directory person marked `needs_review` with that address, and puts the entity on the
meeting's event; the route commits that and then mints the ordinary invitation through `inviteGuest`.
`composeCreatePerson` gains an optional `needsReview`. `@magna-carta/meetings` now depends on
`@magna-carta/directory`. The Guests panel gains an Invite somebody by e-mail form.

## Public

**Invite a meeting guest by e-mail.** In a meeting's **Guests** panel you can now type a name and an
e-mail address to invite somebody who is not on the list. If they are already in your Directory, the
invitation goes to them; if not, they are added there for somebody to review.
