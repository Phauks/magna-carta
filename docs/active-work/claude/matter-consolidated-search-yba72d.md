---
worktree: C:/dev/magna-carta-worktrees/claude/matter-consolidated-search-yba72d
area: consolidated search within a matter — the source registry, the one route, the control in the matter header
status: designing
touches: docs/specs, docs/decisions/pending, packages/matter-search, apps/api-worker/src/routes, apps/web/src/lib/matters, apps/web/src/routes/(app)/matters/[id]
---

# matter-consolidated-search

Designing the matter's own search: one control in the matter header, a scope that defaults to the
section you are standing on and widens to the whole matter, and a registry of declared sources so a
new searchable section is one file rather than a change to the control, the route and the results
page.

This stream is **design only** so far — the spec and its ADR fragment. Nothing under `packages/` or
`apps/` has been touched, and no slice has been opened in `status.d/`. Owner answers on flags M1–M7
in the spec decide the build.

**Coordination points a concurrent stream should know about:**

- The design proposes filling the `scope` seam on the design system's `ScreenSearch` — it changes
  nothing in `packages/design-system`, but it is that component's first real consumer beyond the
  file manager's results view.
- Flag **M2** asks whether the file manager's own Search Results view retires into the matter
  results page. Until it is answered, nothing in `apps/web/src/lib/file-manager/` is edited.
- It proposes one new permission key, `search:matter`, which means a seed migration in
  `packages/database/drizzle/per-firm/` — the one place this stream would collide with another.
