---
category: Added
audience: public
---

**The meeting screen pages a large room rather than drawing all of it.** What a browser pulls is now
decided by one pure function over the roster, the presence facts, the pins and the gallery page
(`apps/web/src/lib/meetings/subscription-policy.ts`): at most sixteen cameras, at most one screen
share, at most twenty-four microphones, ordered pinned first, then whoever is sharing, then the most
recent speakers, then roster order. It is a function rather than a method on the client for one
reason — the case that matters is three hundred participants, and three hundred browsers cannot be
stood up in a test.

**The client makes the plan true and nothing more.** `reconcile()` asks for what the plan names and
is not already coming in, closes what the plan no longer names by its media section, and moves a
simulcast layer where the plan changed it; a burst of `roster-delta` frames costs one pass rather
than one pass each, because reconciliation acts on the first change and folds everything inside the
next quarter second into one. Cameras publish three layers (`f`, `h`, `q`) and a subscriber asks for
the full picture on a page of four tiles, half on a page of nine and a quarter beyond — a screen
share still publishes one layer, because a quarter-size document is unreadable. A `roster-delta`
naming somebody this browser has never heard of is a gap, and the answer is one `sync`, not a guess.

**Every voice is played once, apart from the tiles.** The people a browser hears and the people it
shows are different sets, ranked differently on purpose, so playback moved out of the tile into one
component over the pulled streams. Sound coming through the tiles is how a room goes quiet the
moment somebody turns a page.

## Public

**A large meeting shows you a page of the room at a time.** Sixteen tiles, with the page you are on
and how many there are, and a way through the rest. Anybody you have pinned comes first, then
whoever is sharing their screen, then the people who have been talking — so the first page is the
part of the room the meeting is happening in, and somebody who starts talking twelve pages away
comes to you rather than waiting to be found.

**Speaker view** puts whoever is talking large with the last few speakers in a strip beside them,
and **Pin** keeps somebody on your screen whatever else the room does. Both are yours alone: neither
changes what anybody else is looking at.

**Somebody with no picture is a name, and the tile says so.** A tile reading "Not shown" is a person
in the room whose camera is not being sent to you at this moment, which is the ordinary state of most
of a large room rather than a picture that failed to arrive. You still hear them, wherever they are
in the room.

**The list beside the room gains a search** once there are more than a couple of dozen people in it,
and every row carries the same marks as the tiles: who is speaking, who is muted, who is sharing.
