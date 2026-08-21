---
worktree: /home/user/magna-carta
area: the signed-out surface — sign-in copy, the quiet-link cursor, the chrome band's destinations
status: building
touches: apps/web-worker/src/lib/auth, changelog.d
---

Three owner corrections from the first live pass over the deployed site.

The chrome band is the one worth reading twice: its four destinations were a local list of labels with
`href="#"` hardcoded, while `ecosystem-sites.ts` — the registry that exists to be the single home for
these addresses — already carried the live status URL. So the status page was reachable and
unreachable at the same time. The band now resolves through the registry, which means the remaining
three light up when their entry gets a URL rather than when somebody remembers this file.
