---
category: Added
audience: public
---

**You can sign out — and sign out of your other devices.**

`Sign out` in the profile menu was the last control left over from before accounts existed: a session could be started and never ended. It ends the real session now, and it leaves by loading a fresh page rather than navigating within the application, so nothing the session had read stays behind in the tab for the next person at that computer. A sign-out that does not go through says so and keeps you where you are — the one thing worse than not signing out is believing you did.

**Account → Active Sessions** is a new section beside Profile and Security: every computer and phone signed in as you, one row each — the device, when it signed in, the address it signed in from, and when it expires — with the one you are reading on marked and left alone. Sign out of any of them, or **Sign out everywhere else** in one go, which is the right move when you cannot tell which row is the intruder. The screen states the one thing that would otherwise be discovered the hard way: a device signed out here can take up to five minutes to be turned away, so somebody who thinks their account is compromised is told to change their password as well.

Two facts the screen deliberately refuses to state. It shows no "last used" time — the record knows when a session STARTED and not when it was last active, and a stamp that read as the second while meaning the first would have people clearing rows that were in use. And a browser it cannot identify is listed as unrecognised rather than guessed at.

Under it: `logout` and `session.revoked` join the control-plane audit trail, decided by the endpoint the session was deleted under rather than by the deletion itself — sweeping an expired session and the rotation that happens when a second factor is enabled both delete a session row, and neither is somebody leaving. And Better Auth's session-freshness dial is turned off, because in the pinned version it gates the listing and none of the writes: left at its default it would have hidden the signed-in-devices screen from anybody signed in longer than a day, which is exactly the long-lived session the screen exists to let somebody find and end.

## Public

**You can sign out, and sign out of your other devices.**

**Sign out** in the menu behind your initials, at the top right, ends your session on the computer you are using and returns you to the sign-in screen. Nothing you were looking at stays behind in the browser for the next person at that machine. If a sign-out cannot be completed the screen tells you your session is still open rather than pretending you have left.

**Account → Active Sessions** is a new page listing every computer and phone signed in as you: what the device is, when it signed in, the address it signed in from, and when it expires. The one you are reading on is marked. Sign out of any of the others one at a time, or use **Sign out everywhere else** to clear them all in one go — which is what to do when you are not sure which of them is not you.

Two things the page is careful about. A device you sign out can take up to five minutes to be turned away, so the page says so and tells you to change your password as well if you think somebody else has your account. And it never shows a "last used" time, because what the record actually knows is when each session started — a time that looked like one and meant the other would have you clearing devices that were in use.
