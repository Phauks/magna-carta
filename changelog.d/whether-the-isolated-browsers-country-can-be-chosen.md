---
category: Added
audience: internal
---

`POST /api/v1/safe-browse/location-probe?country=US` — which country a website sees the Safe Website Viewer's isolated browser in, and whether that can be chosen.

The owner's first Live session surfaced in New Zealand. A page aimed at one country often shows its real content only to visitors from there, so a viewer that lands wherever the rendering service places it may be looking at the decoy. The service accepts a `location` when a browser session is launched, documented in one line that says neither whether it is honoured nor whether it moves the address a website sees; quick actions, the static capture's path, do not document it at all.

The probe reads the service's own trace endpoint three ways — a session with no location, a session launched with the requested country, and a quick action carrying it — and reports the country and data centre each time, with `sessionHonoursLocation` and `quickActionHonoursLocation` as the two facts a country picker stands on. It navigates only to that constant; its one input is a two-letter code. Audited and on the expensive rate-limit bucket, because each run holds two billed browsers.
