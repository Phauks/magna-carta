---
category: Added
audience: public
---

**A meeting can hold arrivals at a door.** `meeting.lobby` is `'off' | 'on'`, chosen at Start beside the medium and — unlike the medium — changeable by a host afterwards: a medium is what the people already in the room agreed to, and a lobby is a standing decision about who may come in. One lobby per MEETING and never one per firm, on the owner's ruling of 2026-09-20: a firm runs several meetings at once, so a firm-level door would queue the people arriving at a partner's deposition behind the people arriving at a staff briefing, in front of a host who is in neither.

**A waiting arrival is a stay from the moment it reaches the door.** `meeting_attendance.waiting_from` and `admitted_at` are additive on the existing row rather than a second table: the socket upgrade's ticket is an open stay and a waiter needs a socket, the signaling room's own storage is transient and is deleted when the last socket closes, and the record has to be able to say who waited and was never let in. `joined_at` therefore widens to mean "when this stay began", at the door or in the room, and the read carries all three instants so nothing downstream has to infer anything.

**"In the room" and "has an open stay" stopped being the same sentence, so both are single exported fragments.** `IN_THE_ROOM_PREDICATE` and `WAITING_PREDICATE` in `packages/meetings/src/meeting-statements.ts` are composed by the live count, the capacity guard, the roster and the lobby list, so the four cannot drift into disagreeing about who is present.

**The capacity guard moved from the door to the ADMISSION.** `MAX_MEETING_PARTICIPANTS` counts admitted open stays only, which is what the room actually holds, so the arrival insert cannot be the statement that holds it. `admitAttendanceUnderCapStatement` carries the count in its own `WHERE` and is `guarded()`, and the door gets its own much smaller ceiling — `MAX_MEETING_LOBBY` (100), refused as `meeting-lobby-full`, because a queue is not somewhere a firm should be able to accumulate ten thousand rows and the guest door lands on this path next.

`POST /api/v1/meetings` takes `lobby`; `POST .../join` answers `{ waiting, participantId, displayName, iceServers }` and mints the relay credentials either way — they last an hour, which covers any wait anybody will sit through, and minting at admission would need a second round trip at the exact moment somebody is being let into a meeting that has started without them. Four new routes on `apps/api-worker/src/routes/meeting-lobby.ts`, all of them host acts including the read: `POST/GET /api/v1/meetings/{meetingId}/lobby`, `POST .../lobby/admissions`, `POST .../lobby/denials`. The read is the one in this family that the people inside the room may not make — it is a list of people a host has not decided about yet.

**There is no server-side "admit everyone".** Admit all sends the identifiers the host's panel was showing, because a server-side "all" would admit whoever arrived in the millisecond after the host looked at the list — precisely the person the host did not decide about. The response reports one outcome per identifier (`admitted`, `not-waiting`, `room-full`), so a host admitting five people into two free seats learns which three did not get in.

**On the wire:** a waiting socket is stored under `waiting:<attendanceId>` and never under `participant:`, so `storedParticipants()` — the one read every roster, delta, subscription check and broadcast is built from — cannot include them; a waiter is not omitted from the roster by a filter somebody has to remember. It receives `lobby { position, waiting, at }` instead of a welcome, `admitted { at }` followed by the ordinary welcome, `refused: denied` with a 4000 close, and `ended`. Every other frame from it is refused `not-admitted` with the socket kept open, decided before the routing client is even resolved. Hosts receive `waiting { participants }`, whole, and nobody else does. `room-state` gains `lobby`, and `welcome` gains the lobby list — empty for everybody who is not running the meeting.

**Barred entry is one rule with two labels.** A stay closed `removed` or `denied` bars that member from this meeting while it runs; only the sentence differs (`meeting-removed`, `meeting-not-admitted`). A denial that did not bar would be a button that does nothing.

**Turning the lobby off admits nobody**, and the lock beats the lobby. A setting is not a decision about a named person, and somebody may be waiting precisely because the host intends to deny them; a locked room is shut to everybody, so there is nothing to queue for. A host or co-host of the meeting never waits, and holding `meetings:host` is deliberately not enough — a paralegal with the key walking past the door of a confidential matter discussion is what a host turns the lobby on to prevent.

**The lobby's one deadlock has an exit.** A lobby-on meeting whose host has gone leaves everybody queued for somebody who will never admit them; a key-holder claims the hostless room from inside the lobby, and a grant written for a member whose stay is waiting admits that stay in the same batch — so there is no instant in which somebody is hosting a room they are not in. That admission carries no capacity count, deliberately: refusing the claimer for a full room would restore exactly the deadlock the claim exists to end.

The screen is the web half and is not built: the waiting state, the host's lobby sheet with its badge, and the lobby switch at Start.

## Public

**Hold people at the door until you are ready for them.** Switch on "Hold arrivals in a lobby" when you start a meeting, or any time during one, and everybody who arrives waits until you let them in. Whoever is running the meeting — the host and any co-hosts — never waits.

Admit people one at a time or all at once, or turn somebody away. Somebody you turn away cannot come back into that meeting.

Turning the lobby off part-way through does not let in the people already waiting. They stay on your list until you decide about each of them, because switching a setting is not the same as saying yes to somebody.
