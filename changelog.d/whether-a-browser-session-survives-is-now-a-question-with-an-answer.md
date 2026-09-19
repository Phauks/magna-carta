---
category: Added
audience: internal
---

**Whether a browser session survives between requests is now a question with an answer.** The safe
website viewer's capture reaches the rendering service through quick actions, which are one request
in and one answer out — the browser that served a capture is gone before the next starts. Interactive
browsing needs the opposite, and that is a different API against the same binding
(`@cloudflare/puppeteer`, added to the catalogue at 1.4.0, Apache-2.0) that nothing in this
repository had ever exercised.

`POST /api/v1/safe-browse/session-probe` exercises it once and reports each step: read the account's
limits and open sessions, launch, navigate, disconnect leaving the session alive, reconnect to the
same session id, navigate again, attach a CDP session and enable `Page`. Two facts decide what can
be built — `sessionReused`, without which every navigation pays a cold browser and carries no
cookies, and `cdpAttached`, without which pixel streaming is ruled out whatever else works.

It is gated on `tools:safeBrowse` and audited, because each run acquires a real session and is billed
for the time it is held; the browser is closed in a `finally` whatever happens, and `sessionsBefore`
reports what was already open so a leak shows up rather than staying invisible.

**It navigates only to a constant held in its own file, and that is a constraint rather than an
unfinished edge.** A route that drives a real browser to a caller's address is the SSRF surface the
whole safe-browse subsystem is built to contain, and the guard that contains it belongs on an
interactive route when there is one — not bolted onto a diagnostic. This probe answers a question
about the platform and must never be extended into a browsing endpoint.

The shape is a direct answer to the preceding round, which spent weeks attributing every failed
capture to an account entitlement that had been working the whole time. Make the unknown answerable
before building on it.
