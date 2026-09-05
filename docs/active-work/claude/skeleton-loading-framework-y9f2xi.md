---
worktree: C:/dev/magna-carta-worktrees/claude/skeleton-loading-framework-y9f2xi
area: One loading framework — research into deriving a screen's skeleton from the screen itself
status: designing
touches: docs/research/2026-09-05-skeleton-loading-framework.md, changelog.d/
---

Research only, no code. Inventories every way `apps/web` and the design system show that something
is loading (one primitive, eight components with their own `loading` prop, 89 hand-placed skeleton
tags in 37 files), surveys the libraries that derive a skeleton automatically, and recommends an
in-house design-system region that renders the real component over a fixture and greys its leaves
with CSS. A concurrent stream that adds a loading state to a screen should keep using `Skeleton`
inside an `aria-busy` region with a sentence for now; the region component, the `mc-loading` recipe
and the `lint:one-ui` rule are proposals awaiting a spec.
