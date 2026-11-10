---
slice: Meetings — meetings and calls from a calendar event, in rooms of up to three hundred, with guests from outside the firm on a signed link
group: cross-cutting
order: 45
research: n/a
spec: done by="Claude"
plan: done
built: in-progress by="Claude"
ui: in-progress by="Claude"
load-profile: n/a
tested: in-progress by="Claude"
branch: claude/focused-edison-ylxfiy
active-work: docs/active-work/claude/focused-edison-ylxfiy.md
next: Recording's transcript (slice R3), then captions, once the owner has proved the sink address against the live routing service; then breakout rooms, webinars and booking pages from their designs
link-spec: docs/specs/2026-09-18-meetings-design.md
link-plan:
adrs:
blocked-by:
---

A member starts a meeting on a calendar event and other members join from the same place: media goes browser to Cloudflare Realtime selective forwarding unit, signaling is a `MeetingRoom` Durable Object per meeting, and the record keeps who was in the room and when and nothing that was said.

Slice 3 lifts the room from twelve people to three hundred, which is work on the two ends rather than in the routing service: each browser pulls video only for the tiles it shows and audio only for the people talking, cameras publish three simulcast layers and subscribers choose between them, the room sends what changed rather than the whole roster above sixteen participants, and who is talking is measured by each browser and relayed by the room.

Host controls follow it, because a room that size has somebody running it. Authority over a meeting is a grant on the meeting rather than a capability of a seat: the starter gets one when the room is created, co-hosts are rows beside it, hosting never passes by itself, a hostless room is claimed, and ending a meeting needs a grant like every other host act. The server half is built — the record, the routes with their audit rows, and the four frames a host sends into the room; the per-tile menu and the Host controls band are the web half.

The waiting room hangs from that grant, because admitting somebody is a host act. One lobby per meeting and never one per firm: a firm runs several at once, so a firm-level door would queue the people arriving at a deposition behind the people arriving at a staff briefing. An arrival at the door is a stay from the moment it knocks — the socket upgrade's ticket is an open stay, and the record has to be able to say who waited and was never let in — which split "in the room" from "has an open stay" and moved the room's capacity guard onto the admission, with a much smaller ceiling at the door. The server half is built: the columns, the lobby trio, the four routes, and the `waiting:` storage prefix that keeps a waiter structurally out of every roster rather than filtered out of it. The waiting screen, the host's lobby sheet and the switch at Start are the web half.

Chat, a raised hand and reactions are the in-meeting tools, and they split on the one question that
matters here: does the meeting record keep it. Chat does — the owner ruled it on the record, so a
message carries what a filed email carries — and the route is the record either way; what the room
adds is a RELAY, a copy of a committed row broadcast to every welcomed socket and to nobody at the
door, so a message arrives as it is said rather than on a poller's next tick. The read converges the
half a relay cannot: a redaction moves no row's position in a forward walk, so the list carries the
messages taken back since the reader's own position beside the page. A hand and a reaction do not
reach the record at all — no table, no migration, no audit row, no personal-data registration — and
that absence is the slice's whole claim. The room stamps the instant a hand goes up and relays it on
the roster so a late arrival gets the queue; a reaction is named on its thrower's tile in a small
room and counted for the whole of a large one, one frame a second, because three hundred people
applauding one sentence relayed individually is ninety thousand frames inside a second. Both are the
first frames here that are REFUSED rather than dropped when they arrive too fast, because neither
restates itself. The web half is built too: the control bar's menu of six, the rising mark on the
thrower's tile, the counts strip in a large room, the hand on tile and roster, and the host's ordered
queue of hands — none of it yet seen in a browser.

Diagnosability is the slice that makes a meeting answerable after it has ended, which nothing else
here can be: the room holds no rows, deletes its own state as it goes, and hibernates between frames,
so a three-hundred-person meeting that went wrong used to leave attendance and an Error ID on
whichever refusal a member happened to see. Both halves are now built. The browser measures its own
connection and says so on the wire; the room records each act it takes as one structured event
through the standard pipeline, correlated by firm, meeting and stay, with the redaction structural
rather than a rule at the call sites — there is no declared field for a name, a track or a session
description. A platform operator can read one live room through a guarded route, and a load harness
drives three hundred fake clients against the real object so the fan-out cost is a number instead of
an argument. It falsified a design claim on its first run: every deferred presence transition was
arming the alarm through a reconciliation that reads the whole roster and the whole door, which took
the room to 1.2 storage lists per frame against a design that claims one, and is now 0.4.

External guests are the first people outside the firm to use this product, and they arrive without a
session, a cookie or a member row — so the chokepoint gained a lane of its own rather than a
widening of the session path. A route declares `guestLane`, a signed credential stands where the
session would, and the handler is handed a firm and the credential's names but never a user id, so a
member handler pointed at a guest route fails on its first line. A host mints a link for a Directory
person or organization on the event and it is mailed; the row keeps only the SHA-256 of the link's
secret, and the row is the authority, so a rotation or a withdrawal refuses a perfectly-signed link at
once. Opening the link spends nothing — a mail client that prefetches it costs the guest none of their
twenty arrivals — and pressing Join opens a stay of its own table, always at the door. Presence is now
a union over both stay tables with one home, so a guest counts against the room's and the door's
ceilings exactly as a member does. The room builds every frame that names a user per viewer, so a
guest's socket never holds a firm's user identifiers. The server half is built and tested; the arrival
page, the host's Guests panel and the guest mark in the lobby are the web half, in build beside it.

Polls and the question queue are the meeting's second and third stored content, on chat's terms
exactly: every act is a route that writes through the firm-scoped data-access layer with an audit row
of identifiers and instants, and the room relays a copy after the commit. A poll is four tables, and
the split is the anonymity — the answer row holds what was chosen and, on a poll that shows no names,
nothing about who; the respondent row holds that a stay answered and nothing about what, and is the
one home of when. Options are rows so an answer can only name one of its own poll's, which the
database holds with a composite foreign key. One participation per member per poll, including from a
later stay after leaving and rejoining. A question is the chat message with a second pair — answered
by whom — and upvotes are rows so a member can see and take back their own. The two tallies ride the
per-second bucket the reactions already had, now shared, so three hundred answers in a second is one
frame. Every participant column accepts a webinar's attendee as well as a member and a guest, and
every poll and question row carries a breakout room by value, both now while the migration is
unlanded. The server half is built and tested; the panels are the web half, in build beside it.

Recording's first slice is the sink and the consent mechanism, and it is built on the server side. The
owner ruled the announcement and the mark the consent mechanism, so they are a mechanism with a record:
the room broadcasts a `recording` frame to every welcomed socket, guests included, the instant a start
or stop commits, tells every later arrival on their welcome, and writes a notice row for each stay it
told — one batch per fan-out, every stay named by kind and by value so a guest is on the consent record
exactly as a member is. Start and stop are routes on a new `meetings:record` key seeded to the hosting
seats, and the room is told before any audio is captured. The audio leaves the routing service through
its WebSocket adapter into a non-hibernating `MeetingRecorder` per recording, which stages each track as
mono PCM in the firm's own bucket and reconciles against the room for arrivals, departures, the track
ceiling and lost sockets. It is switched off until the owner proves the routing service keeps the sink
address intact and sets the signing key.

Composing and filing is the second slice, and its server half is built. A stopped recording is handed to
a queue consumer that mixes its staged tracks into one mono WAV a ten-minute window per message — each
track at its own offset, a lost track silent after the loss, two loud speakers clamped rather than
wrapped — keeps its cursor on the recording's row, and files the result onto the matter through the same
upload pipeline, scan and status gate every document crosses; the staged tracks go once it is filed. A
sweep on the ten-minute cron abandons a recording whose recorder stopped working and clears the mark,
hands a stalled compose on and fails it with an Error ID after three attempts, and releases staged audio
nothing needs after its window.
