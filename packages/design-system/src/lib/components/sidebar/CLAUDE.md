# The sidebar — CLAUDE.md

The sidebar's two levels and its collapse. The package-wide rules are in [`../../../../CLAUDE.md`](../../../../CLAUDE.md).

## The sidebar's two levels

**`Sidebar.MenuTrigger` + `Sidebar.MenuSub` are the rail's SUB-MENU**, added when the tools became
top-level rows and nine of them arrived in one group (owner's direction, 2026-09-16).

- **The trigger wears the destination row's recipe exactly** and differs in the one way that
  matters: pressing it opens the rows beneath instead of going anywhere. A row that looked like a
  category and navigated like a destination would be the `/tools` index again in miniature. Its
  chevron follows the group heading's convention — down while open, toward the inline start while
  folded — and rides the trailing column, so a long cluster name truncates and the chevron stays.
- **`MenuSub` is a real nested `<ul>` inside the trigger's `<li>`**, so the nesting a reader sees is
  the nesting a screen reader hears. Its indent and start-edge hairline are what make "these belong
  to the row above" legible at a glance rather than by measurement.
- **The expansion state is the CONSUMER's.** Neither part holds it: the app stores a member's folds
  as departures (`sidebar-preferences.svelte.ts`), and the story holds a `$state` for the same
  reason. A part that remembered its own fold would be a second answer to a question the preference
  store has already settled.
- **`MenuButton` gained a `trailing` snippet**, and the row is a three-track grid: icon, label
  (takes the slack, truncates), trailing (sized to its contents, never shrinks). A mark rendered
  among the children rides inside the label's own overflow, which clipped the maturity badge off
  every row long enough to need it. The collapsed rail hides the trailing column with the label.

- **Sidebar collapse seam tearing — RESOLVED (owner-flagged "not acceptable"; fixed via View Transitions).**
  The collapse used to animate **layout** properties (the rail `inline-size`, the menu-button
  `grid-template-columns` `1fr→0fr`, the label `padding`), repainting the sidebar↔canvas seam every
  frame; at a fractional device-pixel ratio (Windows 150% scaling) that 1px border edge shimmered/tore.
  Profiling showed it was **not** a frame-rate problem (avg ~16.7ms/frame, 0 long frames) — purely the
  sub-pixel **paint seam**. Fix: the collapsed-state widths/tracks now change **instantly** and the
  collapse is composited via the **View Transitions API** — the Trigger flips state through
  `runViewTransition` (`internal/view-transition.ts`), `.mc-sidebar` carries `view-transition-name:
  mc-sidebar`, and the work canvas (in the shell/story) carries `view-transition-name: mc-app-canvas` so
  it morphs rather than ghosting. The browser tweens before/after layouts on the GPU, so the seam is
  sampled, never re-rasterized → no tear. Reduced-motion / unsupported browsers fall back to an instant
  collapse. **The UX principle this establishes platform-wide: animate only compositor properties
  (`transform`, `opacity`) — never `width`/`height`/`grid-template`/`top`/`left`/`margin`; for an
  unavoidable layout change, wrap the mutation in `runViewTransition`.** Chosen over a hand-rolled
  `translateX`/spacer rebuild because View Transitions is the project's motion stack (Svelte built-ins +
  View Transitions at 0 kB) and far less invasive. Only collapse-unrelated interaction colour
  (hover/active) still uses CSS transitions. (Play test asserts the now-deferred state flip via
  `waitFor`.)
