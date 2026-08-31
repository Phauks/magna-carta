---
worktree: /home/user/magna-carta (remote session)
area: Safe Website Viewer tool page + WHOIS page layout corrections
status: building
touches: apps/web/src/routes/(app)/tools/, apps/web/src/lib/tools/, apps/web/src/lib/navigation/tool-destinations.ts, docs/conventions/design-corrections.md, roadmap.d/integrations.md, docs/now.md, docs/user/features/, changelog.d/, ROADMAP.md
---

Builds the Safe Website Viewer's own page over the shipped backend (`POST /api/v1/safe-browse`):
the fetch-and-classify seam at `apps/web/src/lib/tools/safe-browse/`, the page at
`/tools/safe-website-viewer`, and the presentation-stage flip to `alpha`. Also applies three owner
corrections issued against the WHOIS page (query control at the reading edge, one flowing intro
paragraph, orienting text persisting through result states) and records them in
`docs/conventions/design-corrections.md`. Flips the `integrations.tools.safe-browse` ledger node's
surface to `screen` and re-renders the build register. Concurrent streams should stay out of
`apps/web/src/lib/tools/safe-browse/` and the two tool pages under
`apps/web/src/routes/(app)/tools/` until this lands.
