---
category: Changed
audience: public
---

**WHOIS retries registry faults itself, visibly, and the Safe Website Viewer becomes a real
browser shell.** The lookup seam gains `lookupWhoisWithRetries`: a transient upstream fault (the
502 the worker maps `RdapUpstreamFailure` to, or nothing answering) is retried up to three
attempts with short backoff, each attempt reported to the page, which shows "Trying again, attempt
2 of 3" in the loading card instead of stalling silently; the platform's own 429 is deliberately
never retried. Recorded as the standing rule "Retry a transient upstream fault yourself, visibly".
The viewer's result structure now renders at rest (the "result region is furniture" ruling): the
URL entry moves into the shell's own address bar as the one entry ("Load Website"), the landed URL
appears as a secondary row when a capture ends on a different site, back/forward/refresh navigate
a client-side capture history (`capture-history.ts`, unit-tested), outbound links load in the
viewer as new captures (buttons, never anchors), the URL is click-to-copy, tab panels are boxed
structures, and a Static/Live toggle renders with Live seamed behind the Soon affordance until the
interactive remote-browsing seam is built.

## Public

**The WHOIS lookup now rides out registry hiccups for you.** When a registry is rate-limiting or
briefly away, the lookup retries automatically and shows you each attempt as it happens; you only
see a failure once several attempts have genuinely not gotten through. **The Safe Website Viewer
now works like a small browser.** The address bar sits on the viewer itself: type or paste a link,
press Load Website, and the captured site fills the frame below, with the site's facts in boxed
tabs beside it. If the link lands somewhere else, the real destination appears right under the
address you entered. Back, forward, and refresh walk your capture history, clicking an outbound
link captures that page next, and the address copies with one click. A Live view toggle shows
where interactive viewing will arrive; it is not available yet and says so.
