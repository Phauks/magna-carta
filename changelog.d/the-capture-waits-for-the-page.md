---
category: Fixed
audience: public
---

**The capture waits for the page, shoots all of it, and narrates while it works — and a WHOIS
query for a hostname finds the domain's record.** The renderer was shooting a client-rendered page
mid-load (skeleton placeholders where content goes) and only the first viewport: the snapshot call
now passes `gotoOptions.waitUntil: networkidle2` with a timeout, a settle beat for lazy content,
and `screenshotOptions.fullPage`. A new streaming route (`POST /api/v1/safe-browse/stream`,
newline-delimited JSON stage lines) reports the redirect probe's settled facts while the renderer
still works, via a `CaptureStage` callback on `captureSafeView`; the page's loading viewport
narrates them ("Landed on youtube.com after 2 redirects. Rendering the page…") instead of a
generic line. And `lookupRegistration` walks a hostname up to the registrable domain that actually
answers — `www.youtube.com` is a registry 404 while `youtube.com` is the record the member meant —
stopping at the two-label floor and never walking an IP. Screen side: the tab strip aligns to the
address bar's height, the Different Site indicator (landed URL, badge, copy) lives only in the
Overview tab, the Soon marker survives only on the Live control's hover, and the WHOIS page
renders its result frame at rest.

## Public

**Captures now show the finished page, all of it.** The isolated browser waits until the site has
actually loaded before taking its screenshot, and the screenshot covers the whole page, not just
the first screen. While it works, the viewer tells you what is really happening: where the link
landed and how many redirects it took, while the picture is still rendering. Checking who
registered a site now works for any address on it — pasting a link to a page inside a site finds
the site's own registration record. The viewer's frame is tidier: one continuous top bar, the
different-site callout lives with the facts on the right, and the WHOIS page shows its result area
before you search.
