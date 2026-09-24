---
category: Fixed
audience: public
---

**A second person on a guest's link no longer walks into the room under the first guest's name.**
An arrival on a link whose stay is already open still returns that stay, but now puts it back at
the door under the name just typed, so a host sees who is arriving and admits them deliberately.
The room drops the earlier holder's tile and socket at once. The name the stay carried before, and
who admitted it, stay on the arrival's audit row.

**Sending a fresh link closes the stay the old one held**, in the same write, and the fresh link
arrives at the door. Withdrawing a link and replacing one both close the stay `left` rather than
`removed`, so inviting the person again brings them back instead of telling them they were put out.
A fresh link, whether rotated or re-sent, also starts its arrival count again, so a guest whose
connection kept failing is never sent a link that is already used up.

**A link says why it stopped working.** An expired link this deployment signed is answered
`410 guest-link-expired` with no database read, instead of the flat 404 a guessed token gets, and
it is counted under its own reason. An arrival whose link changed under it is told whether it was
withdrawn, replaced, used up or expired. A link whose person has been taken off the event is refused
as withdrawn, and the refused arrival is recorded.

**The meeting socket takes a guest's grant as a WebSocket subprotocol** (`meeting-guest`, then the
grant), and answers with the bare protocol name, so the credential stays out of the socket's
address. The `guest` query parameter is still accepted, on the socket route alone; the messages and
departure routes now refuse it even on an upgrade.

**An invitation whose e-mail could not be sent is no longer remembered as sent.** Nothing is stored
under the request's idempotency key until the mail has gone, so the host's retry sends a fresh link
rather than replaying a success the guest never received.

## Public

A guest link now tells the person holding it what happened to it: a link past its time says it
has expired, a withdrawn link says the firm withdrew it, and a link used too many times says so,
each with the same remedy, which is to ask the firm for a new one. Somebody who opens a link while
another person is already in the meeting on it goes to the waiting room under the name they typed,
so the host decides who comes in. A guest whose link was withdrawn by mistake can be invited again.
