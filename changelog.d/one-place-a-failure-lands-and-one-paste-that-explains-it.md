---
category: Changed
audience: public
---

**Every failure in `apps/web` renders from one record through one component family.** The client
kept four of the twelve fields an RFC 9457 problem carries; it now reads all of them, and
`requestAccess` / `stepUpRequired` — emitted at six places in the API worker and previously read at
none — become the control the member presses instead of another apology. Four private copies of the
problem parser collapse into `lib/api/problem.ts`; `PagedList` holds the failure rather than a
string, which is what made nine surfaces structurally unable to show an Error ID; and
`failure-state` / `failure-band` / `failure-details` in the design system are extracted from the
costs and billing pair rather than invented. The copy path assembles the whole trace once
(`lib/diagnostics/failure-trace.ts`), states absent facts rather than dropping them, and falls back
to a selection copy where the async clipboard is refused. `lint:failure-surface` is the fitness
function that keeps it.

## Public

Every failure in Magna Carta now lands in the same place and says the same kind of thing. When a
screen, a panel or an action cannot complete, you get what happened in plain words, an Error ID you
can copy with one press, and — where we can offer one — the control that actually moves you forward:
retry, sign in again, or ask for access to what you were refused.

Copy details puts the whole report on your clipboard: which version you were on, which page, which
request failed, what the service said, when it failed and when you copied it, your browser and
connection, and the last few things you did in the app. Anything we do not have is written as
missing rather than left out, so a support conversation never starts by asking you something the
screen already knew. If your browser refuses the clipboard, the block says so and stays selectable
rather than claiming it copied.

Report a Problem now files. It is reachable from the profile menu and the command palette on every
screen, it goes to your firm's own reporting pipeline and nowhere else, and it comes back with a
reference you can quote. No document, file name, client name or matter content leaves the firm.

Two failures that used to look like your fault no longer do. A read that fails while an update is
still rolling out says the service is mid-update instead of blaming the address you typed, and when
several reads fail at once one line at the top of the screen says so — once — with a link to the
service status page, instead of six panels apologising separately.
