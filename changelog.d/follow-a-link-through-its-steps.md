---
category: Added
audience: public
---

**Follow a suspect link through its steps: the viewer's Live mode.** The safe website viewer's Live
toggle stops being a Soon affordance. Static still opens every address in a fresh isolated browser;
Live keeps one per member, held by a `SafeBrowseSession` Durable Object keyed `firmId:userId`, so a
shortener into a consent wall into a credential form can be walked to its third step — which exists
only because the first two set cookies. The object holds the remote browser's session id, never the
handle and never any browsing history; an idle alarm (three minutes) and an age ceiling (fifteen)
close the billed browser, and leaving Live or the page releases it through `sendBeacon` on
`pagehide`. A reconnect to a browser the service already reaped relaunches rather than failing, and
the screen says the cookies were dropped.

The live answer carries the capture's fields one for one, the redirect chain read off the navigation
the session actually made — so the inspector renders it unchanged, and never has to pad a missing
chain into a false "answered directly". Request interception guards **every navigation request the
browser makes**, in any frame, through `assertPublicTarget`: a refused sub-frame is blocked alone, a
refused main-frame hop fails the navigation with the generic refusal. Sub-resources are not resolved
one by one, the same line the static renderer draws. What crosses back is still a screenshot and
text, never markup, so nothing new reaches the member's device.

Decision: `docs/decisions/pending/interactive-browsing-on-a-per-member-session.md`. Pixel streaming
is not built; the probe showed it possible, and the reasons against it are not technical.

## Public

**Follow a suspicious link through every step it takes.** The Safe Website Viewer has a Live mode.
Where Static looks at each link on its own, Live keeps one isolated browser for you while you look
around, so you can follow a link past a "confirm you are human" page to whatever it was hiding. You
still only ever see pictures and text — nothing from the site runs on your computer. Live closes
itself after a few quiet minutes, and tells you when a page had to start fresh.
