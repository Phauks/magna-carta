---
category: Fixed
audience: public
---

**Six corrections to hosting and the door, found in review.**

**A hand-over leaves the outgoing host a co-host.** `grantHosting` now inserts a co-host grant for
the person stepping down, in the same batch as the revocation, so there is no instant in which they
hold nothing. Handing the room over is not leaving it: dropping the outgoing host to an ordinary
member took the mute, the spotlight and the door away from somebody who had been hosting a second
earlier, with nothing on any screen to say so. `revokeHostGrantStatement` takes an optional `role` for
the same reason — a batch that closes one grant and opens another for one member is the only place
"whatever they hold" stops being one row, and the hand-over now names the grant it is closing so a
race is caught by the guard rather than by a raw constraint one statement later.

**A co-host may stand down.** `POST /api/v1/meetings/{meetingId}/hosts/{userId}/revoke` naming
YOURSELF is a resignation and is anybody's to make; the one refusal is the sole grant-holder, because
a host resigning out of a room where nobody else holds anything leaves a running meeting with nobody
running it. Its own audit event, `meetings.meeting.hostingResigned`, because both rows carry the
caller as the actor and one name would make "did somebody stand down or were they stood down" a
question you answer by comparing identifiers.

**Two co-hosts and an absent host no longer leave a room permanently hostless.**
`countOtherHostsPresent` counted every live grant, so each co-host saw the other and neither could
claim a room nobody was holding. It now counts a live HOST grant whose holder is in the room. A
co-host does not prevent the claim; the host does.

**The door is now shut in the same statement as the arrival.** The join path read the lock and the
lobby a round trip before its insert, so a host shutting the door in that instant had the arrival
land in a locked room — and a host turning the LOBBY on in the same instant put somebody straight
into a discussion the door was opened to keep them out of. Both conditions are now predicates on
`insertAttendanceUnderCapStatement` and, inverted, on the waiting insert, so the guarded write rolls
the whole batch back rather than half-landing a stay in a room that is shut.

**Removing somebody who was still at the door leaves no key behind.** The room's release only knew
the `participant:` keyspace, so a removal from the lobby closed the stay in the record and left a
`waiting:` key — the host's own panel went on offering to admit somebody the record says is not in
the meeting, and the key kept arming the door's grace deadline.

**A lock or lobby write that changed nothing no longer disturbs the room.** Both routes now skip the
room call when the service reports nothing moved, rather than spending a room-state broadcast on
every socket to restate what each of them already draws.

## Public

**Handing a meeting over keeps you running it too.** Passing the room to a colleague now leaves you
as a co-host, so you keep the mute, the spotlight and the door instead of losing them the moment you
hand over.

**You can stop being a co-host yourself.** Step down from your own grant without having to ask the
person who gave it to you.

**A meeting whose host has gone can always be taken over.** If two co-hosts were in the room and the
host had left, neither of them could take the room; either of them can now.

**Shutting the door works at the moment you press it.** Locking a room, or turning the waiting room
on, now takes effect for somebody arriving in that same instant — which is exactly when a host
reaches for it.
