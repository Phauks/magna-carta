---
category: Changed
audience: internal
---

The handover told the next instance to verify in a browser and left out the recipe, which is not guessable: two remote-only wrangler bindings have to be commented out before the worker boots, the dev seed returns the credentials, and a Playwright run has to POST those to the sign-in endpoint on the page's own request context before any `(app)` route is reachable. It now carries all of that, plus the instruction to measure rather than eyeball — a `boundingBox()` on the thing you changed, and a walk up the ancestor chain when a flex child will not stretch.

The count of render-only defects in that section went from three to five: the two that shipped to `main` past a green gate, fifteen passing tests and a clean build are the strongest argument the section makes.
