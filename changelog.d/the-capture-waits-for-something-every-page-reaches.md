---
category: Fixed
audience: public
---

**The capture waits for something every page reaches.** The first refusal the safe website viewer
could actually read said `http=422, code=6004` — which the rendering service documents as being
unable to complete the action because of an issue with the site, most often a timeout. The cause was
ours: the snapshot asked the browser to wait for `networkidle2` before shooting, and a page holding
a socket, a poll or an analytics beacon never reaches two-connections-idle, so the wait ran to its
own 45-second limit and the service gave up. Every capture against a live commercial page failed
that way, and the answer on screen blamed capacity. The capture now waits for `load`, a condition
every page reaches, and the bounded settle afterwards is what covers the painting that idle was
there to wait for.

A page that still will not finish gets a second attempt with everything expensive turned off — no
lazy-load sweep, the earliest ready signal, the first viewport only. A worse screenshot is worth
more than none on a surface whose whole purpose is looking at pages chosen for being suspect. Only
a page failure earns that retry: a capacity shortage and a configuration refusal fail identically
on a second ask, so retrying either would spend a second render to learn nothing.

A failed render is now its own answer (`page-render-failed`, HTTP 422) rather than borrowing one
that fits it badly. It is not the capacity 502, which invites a retry the server has already made,
and it is not the 500, which hands the member an Error ID for a page that is merely slow.

## Public

**A page that will not load now says so.** The Safe Website Viewer could not capture ordinary
websites — anything with live updates on it would time out, and the message blamed our service for
being busy. Captures work now. If a page still will not load, the viewer tries again in a simpler
way first, and tells you plainly that the page did not finish loading rather than asking you to
report a fault.
