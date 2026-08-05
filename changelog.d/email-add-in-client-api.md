---
category: Added
---

**The mail-client add-in's client API is complete: the firm's mail client can now ask where a message
belongs, file it, and read back what happened.** Filing itself already worked — an add-in posts the
open message to its matter and reads the wall-safe "already filed" indicator — but three things it
needs were missing, and each is now a route.

**Where should this go?** A new matter-suggestion read ranks the matters an open message probably
belongs to, so the pane can pre-select one instead of making an attorney search mid-triage. Four
signals combine, ordered by how hard each is to be wrong about: the conversation is already filed to a
matter (the strongest — it is the thread itself, not a guess about who is on it), the subject line
carries the firm's own matter number, a correspondent on the message is a party on a matter (live now
that Directory resolves an address to an entity), and last and weakest, whatever the member typed —
delegated to the same free-text matter search the caseload list uses, so "search" means one thing
across the product. Each suggestion carries its confidence and the reasons behind it in plain language,
and the response flags when the top candidates tie, so a client knows not to pre-select anything.

**Every suggested matter is one the member can already see.** Suggestions are the one place in the
subsystem where the server proposes matters nobody asked for by name, so the narrowing happens before
the ranking, not after: a matter the member is walled from contributes no suggestion, no reason, and no
count, and its absence is indistinguishable from having no evidence at all. The message facts ride the
request body rather than a URL — a subject line and a client's correspondents are the firm's mail and
do not belong in a log.

**What happened to what I filed?** Filing a message returns a job identifier and finishes off the
request path, and until now that identifier led nowhere. A capture-status read turns it back into the
answer: which record the message became, whether it was filed outright or staged for a person to
accept, and whether the firm already held it and the capture converged on the existing record rather
than writing a second one. The capture worker records its outcome on the same atomic write as the
capture itself, so a status can never describe a filing that rolled back. A job whose result sits on a
matter the caller cannot access is reported as absent — never as somebody else's matter.

**What do I show this member?** A filing-context read gives the pane everything it needs before the
member chooses anything: the matters they have most recently filed mail to (their own filings — a
shortcut list is a personal working set, not a window onto what colleagues are busy with), whether each
has a live forward/CC capture address, whether the firm has a catch-all, the zone those addresses live
under, and the size ceiling a message must fit under so a too-large message is refused on the desk
rather than after the upload. Capture tokens stay write-once: the response says an address exists, never
what it is.

All three are reads bound to the existing `emails:read` capability — nothing new to grant, and a member
who can read the firm's filed mail can be told where to put the next message. One index-only migration
backs the recent-filings list so it walks one member's own filings instead of scanning the firm's.
