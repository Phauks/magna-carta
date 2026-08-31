---
category: Added
audience: public
---

**Safe Website Viewer tool page.** The `web-domains` pair is complete on the screen side: a new
page at `/tools/safe-website-viewer` over the existing chokepoint route (`POST /api/v1/safe-browse`),
with the branching in a DOM-free seam (`apps/web/src/lib/tools/safe-browse/safe-browse.ts`) on the
WHOIS page's same-origin-fetch pattern. Everything the page renders is inert: the screenshot is an
`<img>` from base64, extracted text stays escaped text, and the suspect page's outbound links render
as plain text, never anchors. The catalog entry advances `soon` to `alpha`, so the listing tile,
list row, and command palette entry become launchable; palette synonyms ("phishing", "redirect")
widen its search net. A 502 from the remote renderer reads as a transient outage to retry, not a
fault to quote — the render engine is Cloudflare Browser Rendering, an account entitlement still
queued in `docs/deploy-queue.md`, so captures answer that outage state until it is enabled. Three
owner rulings issued against the WHOIS page in review land with it (recorded in
`docs/conventions/design-corrections.md`): the query control sits at the reading edge rather than
the masthead's far-right actions slot, intro copy is one flowing paragraph, and orienting text
persists through result states.

## Public

**See what a suspicious link leads to, without opening it.** The Safe Website Viewer in Tools now
has its page: paste a link you do not trust and the page loads on an isolated remote computer, never
in your browser. You get back a screenshot, the page title and text, every redirect the link passed
through (with a plain callout when it lands on a different site than it started on), the links the
page points at, and the server's response details. Everything you see is a picture and text, so
nothing from the suspect site can run on your device. Nothing is saved. The WHOIS Lookup page also
reads better: its search box sits at the left edge and its explanatory text stays put while you
search.
