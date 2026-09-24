---
category: Added
audience: public
---

The Safe Website Viewer downloads everything a capture found, not only its picture. `capture-export.ts` builds one ZIP through `client-zip` (the bulk-download library): the screenshot PNG, `capture.txt` (every inspector tab as plain text, ordered as the tabs are) and `capture.json` (the view without its screenshot, plus capture time, duration, mode, the different-site flag and the registration record when the member opened that tab for the same host). Nothing in the archive is markup: addresses are written as text so a report opened later in a browser cannot be the thing that finally lets the page act. History entries now carry their mode, so the report says whether a held Live browser or a fresh Static one produced it.

## Public

You can now keep everything the Safe Website Viewer found, not only its picture. **Download Screenshot and Details**, above the screenshot, saves one ZIP holding the screenshot, a plain-text report of every tab on the right — overview, redirects, page text, links, headers, and the registration record when you opened it — and the same facts in a structured file. Nothing in it is live: the site's addresses are written as text, never as links.
