---
category: Fixed
audience: internal
---

**`changelog.d/a-firm-puts-its-own-fields-on-an-asset.md` gains the developer entry it was marked
`public` without.** The fragment carried only customer-facing prose under no `## Public` heading, so
`lint:changelog-fragments` had been failing on `main` since it landed — `vp run changelog-build` would
have refused to assemble either changelog. It surfaced the moment that lint moved into the inner loop's
always-on step; a red gate on arrival is exactly what a gate is for, but it belongs fixed in the same
change that starts enforcing it.
