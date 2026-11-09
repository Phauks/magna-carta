---
slice: Community 1 — public changelog
group: cross-cutting
order: 38
research: n/a
spec: done by="Opus 4.8"
plan: n/a
built: done by="Opus 5" gap
ui: done
load-profile: n/a
tested: done by="Opus 5" gap
branch: claude/community-slice-1
active-work:
next: The public page, rendering the same artifact the in-app Changelog screen now does
link-spec: docs/specs/2026-08-11-community-surfaces-design.md
link-plan:
adrs: ADR-0048, ADR-0279
blocked-by:
---

The first of the three community surfaces, built alone as the design sequences it. `changelog.d/` fragments gain a required `audience:` key with no default and a `## Public` block; `vp run changelog-build` now folds both halves in one pass — the developer entry into `CHANGELOG.md`, the customer entry into the new `docs/public-changelog.md` — and `pnpm run lint:changelog-fragments` refuses an undecided fragment in the author's own gate. `@magna-carta/product-updates` holds the artifact schema and the strict parser that turns the assembled document into it. No database, no board. The in-app Changelog screen (`/updates`) renders the artifact, built into the web bundle.
