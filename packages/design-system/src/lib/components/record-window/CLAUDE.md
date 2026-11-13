# The two modal shells — CLAUDE.md

`ActionDialog` and `RecordWindow`, the only two modal shells, and the frame they share. The package-wide rules are in [`../../../../CLAUDE.md`](../../../../CLAUDE.md).

## Two modal shells, and never a third

**Every modal surface in the product is `RecordWindow` (reading and changing a record) or
`ActionDialog` (an act asked of a reader).** A screen does not compose `Dialog.Content` /
`AlertDialog.Content` / `Sheet.Content` into a panel of its own — `lint:one-ui`'s
`hand-composed-modal` rule fails it, and the homes allowed to compose one are DECLARED in
`tooling/lint-one-ui/registry.json` (`modalShells`), not hardcoded in the rule. Being a registered
component is not enough on its own: `RecordAttachments` is registered and its detach confirmation
is still an `ActionDialog` inside it, not a panel of its own.

- **What `ActionDialog` owns, it owns by having no prop for it**: the footer's geometry and the
  order of its two controls, the dismissal's word, the busy state, whether the corner dismiss shows,
  which primitive renders the panel, and the one close path every exit runs through. There is no
  `class` prop. A caller differs on a closed set — `fields`, `notice`, `kind`, `width`, and a commit
  returning `"committed" | "refused"`.
- **`kind` selects the primitive.** `form` → `Dialog` (corner dismiss, dismissed by a press
  outside); `confirm`/`destructive` → `AlertDialog` (the `alertdialog` role, no incidental dismiss).
  The dismissal says "Cancel" for every acting kind, held as one constant. The trait table describes
  what Bits already does rather than fighting it.
- **`kind="reading"` is the fourth kind, and it is an arm of a discriminated union, not an
  optional commit.** A reading panel — the matter-status window is the model — states a fact and
  seats any step it offers in the body beside that fact, so its bar holds one control that says
  "Close" (nothing was begun). The props type has two arms: acting kinds REQUIRE `commitLabel` and
  `onCommit`; the reading kind forbids them (`?: never`). Neither arm got weaker to admit the other.
  Its row in the kind table carries `commitVariant: null`, which is what hides the commit; it runs
  no unsaved-work guard unless the caller says `unsavedChanges`. It is not a read-only
  `RecordWindow`: a record with tabs, history or an editing mode still opens in the record window.
- **The primary pane is a `<form>` and the commit is its submit button, by `form` attribute.** That
  is how Enter commits in every panel without a caller wiring it: the platform's implicit submission
  presses the form's default button, and only while it is enabled, so a refused or `commitSoon`
  commit refuses Enter too. Ctrl+Enter or Cmd+Enter commits from a textarea (the form's keydown
  listener; the a11y warning on it is ignored with its reason). The form is `novalidate` — a refusal
  is stated beside the commit, never as a browser bubble. A caller must not put a second `<form>`
  inside `fields`, and a raw `<button>` inside it needs `type="button"` (the design system's Button
  already defaults to it).
- **`subtitle` is `RecordSubject | Snippet`, and the removal of the `string` arm is the point.**
  A `RecordSubject` (`../record-reference`) is an optional `RecordReference` — `kind`, `number` and
  a `standing` of `drawn | tentative | preview` — plus short facts, rendered by `RecordSubjectLine`.
  The slot took a string until 2026-09-14, and eighteen of fifty-four call sites used it for a
  paragraph about what a subsystem is for; the owner had already struck exactly that on 2026-09-08,
  and a slot typed `string` accepts it anyway. A sentence about the ACT has nowhere to go now,
  because the heading names the act. The snippet arm stays for a subject carrying real markup, and
  both arms still render through one `subtitleContent` snippet in the shell. `RecordWindow` takes
  the same union, so a record window and the panel that created that record name it identically.
- **`commitSoon: { reason }` is the acting arm's seam for an act not served yet.** The shell wraps
  its own commit in `SoonAffordance` (`../maturity`), so the commit is disabled with the Soon mark
  beside it and the dependency as its accessible description. The commit is ONE snippet rendered
  one of two ways so the bar holds exactly one `<Button` carrying the commit marker in this file's
  source — that is what keeps `footer-set` true; do not duplicate the control to add a branch.
- **`restoreFocus={false}` is the one focus seam, for a trigger revealed on focus.** Bits returns
  focus to the trigger on close; a per-row control that reveals on focus then stays latched open
  after the panel has gone (owner-reported twice on the settings rows). The default is true and
  right for every other trigger; do not reach for it to tidy focus elsewhere.
- **The `notice` slot is the layering seam.** The design system cannot know what a failure reads
  like, so the shell reserves the PLACE and the app puts `FailureNotice` in it. Never import an app
  module here to close that gap.
- **The commit owns the close.** `onCommit` reports an outcome; the shell closes on `"committed"`,
  stands its ground on `"refused"`, and on `"done"` stays open as a panel with nothing left to ask:
  the commit leaves the bar, the dismissal reads Close, the guard stands down, and `fields` /
  `context` are handed `done` so one snippet shows what the act came to (a reference, a batch
  still landing). A caller never writes `open` on the way out — that is what keeps the close to
  one path, and a one-entrance close path is the only kind a guard can cover. A host MAY close a
  done panel itself by writing the bound `open` (the upload panel's host does, once the last file
  lands); that is a prop changing, not a gesture, and runs no guard.
- **Both shells stamp `data-modal-shell`** on their panel, and `ActionDialog`'s two footer controls
  carry `data-action-dialog-action`. These are the hooks a scan and a rendered-DOM check read;
  `footer-set` asserts the bar against the shell's source the way `header-set` asserts the record
  window's header. Do not remove or rename them to tidy up markup.
- **Both shells sit on one frame — `styles/recipes/modal-frame.css` — and no panel builds a pane
  system.** The frame is the record window's own, extracted: `mc-modal-frame` (the panel),
  `-header` / `-identity` / `-heading` / `-subtitle` / `-header-actions` / `-header-action`,
  `-body`, `-pane` (the primary pane, which stops at `size.record-pane` beside a context and fills
  the frame when alone via `:only-child`), `-context` (+ `-context-body` for a context that is not
  tabs), `-notice` (outside the scroll, directly above the bar; `:empty` collapses it), and
  `-actions`. `RecordWindow` keeps every `mc-record-window-*` name as a hook beside the frame's
  class; its own recipe is the tab strip only. Do not re-declare any of these in a shell's recipe,
  and do not give `ActionDialog` a `class` prop to reach past them. A form that needs something
  beside its fields hands `ActionDialog` a `context` snippet; a context pane implies the record
  width, whatever `width` said.
- **The frame owns expand, and each shell keeps its own control.** `internal/frame-expansion.svelte.ts`
  holds the state, the per-shell session memory (`recordWindowExpansion`, `actionDialogExpansion`
  — never persisted, never shared between the shells), the two control names, and the expanded
  geometry (`EXPANDED_FRAME_CLASSES`, utilities, since only a utility can replace the panel's own
  cap). The corner control's markup stays in each shell's source because `header-set` asserts the
  record window's set at the source. `ActionDialog` offers expand on the kinds with something to
  gain — `form` and `reading`, the Dialog kinds; `expandable` in the trait table — and never on a
  question. Both shells take a bindable `expanded`, which is also how a panel OPENS expanded by
  design; the caller's binding wins over the memory.
- **Both shells take an optional `menu` snippet, drawn first in the header as the "More"
  dropdown.** The record window calls it the kind's menu; `ActionDialog` draws it only on the kinds
  that show the corner controls, because a question is answered, never browsed. It holds what is
  done WITH the thing shown (copy its link, download a copy), and it follows the "a menu earns its
  glyph" ruling in `docs/conventions/design-corrections.md`: a caller with fewer than two live items
  passes no menu.
- **A primary pane that carries a section rail stops at `size.record-form`, not `size.record-pane`.**
  The frame recognises it by `data-record-rail` on the rail's container
  (`.mc-modal-frame-pane:has([data-record-rail])`, `styles/recipes/modal-frame.css`), so the rail
  is added to the pane's measure instead of being taken out of the fields beside it. A pane alone in
  its frame still fills it.
- **`ActionDialog` takes an optional `leading` snippet, drawn before the heading** (in
  `.mc-modal-frame-lead`, `styles/recipes/modal-frame.css`). It is for one small square that names
  what the panel is about, such as the directory record's picture; it is not a second toolbar, so
  actions still go in `menu` or the footer.
- **Where a modal panel sits on the screen is one module, in four named parts, and no panel
  touches the screen's edges.** _(owner ruling 2026-09-03)_ A panel's LOOK is its own recipe
  (`dialog.css`, `alert-dialog.css`); what it is MADE OF is the frame's; WHERE it sits is this:
  - `styles/recipes/modal-stage.css` — every placement rule. `mc-modal-stage` is the viewport pulled
    in by `size.modal-gutter` (32px) on every side, centring its panel with flex; flex is also the
    height cap, because a column flex item with `min-block-size: 0` shrinks to its container — fit
    first, then cap, in keywords alone, where `calc(100dvh - …)` fails the purity gate and
    `stretch` reaches only Chromium. `mc-modal-panel` is what makes any panel its well-behaved
    child (positioned, content-height, free to shrink, taking pointer events), and the panel
    recipes never restate a placement declaration (`test/modal-stage.test.ts` refuses one). The
    stage drops its gutter when its direct child says `data-expanded="true"`.
  - `internal/modal-stage.svelte` — the stage's one piece of markup, rendered by `Dialog.Content`
    and `AlertDialog.Content` around Bits' Content. It carries the modal z-layer (a fixed box is a
    stacking context, so a z-index on the panel alone leaves it beneath the scrim) and
    `data-modal-stage`, which the sweep, the story tests and the print sheet find it by.
  - `internal/modal-placement.ts` — the closed placement axis, `centered | anchored`, stamped on
    every panel as `data-modal-placement`. `Dialog.Content` takes it as `placement`; `AlertDialog`
    is always centred. `anchored` is the command palette, positioned against the viewport by its
    own insets; a new placement is a member here, a rule in the recipe, and a row in the sweep.
  - `modal-geometry/` — the diagnostic: a Playwright sweep over the Storybook dev server that
    loads every specimen in `src/stories/modal-geometry.stories.svelte` (each shell, already open,
    one story per way a panel can meet the screen; no trigger, no play function, so a measurement
    never races a story) at every screen size in its `matrix.ts`, prints the panel's size and
    edges, screenshots it, and fails an edge nearer than the gutter (or, expanded, an edge not
    touched). `pnpm --filter @magna-carta/design-system run modal-geometry`; its README says how to
    read a failure and how to add a screen or a panel. The arithmetic is `geometry.ts`, unit tested.
    So the panels carry NO `max-h-*` utility any more (the stage caps them; a `max-h-screen` would
    reach past it), only their `max-w-*`, and no app code knows how the stage works.
- **`RecordWindow` takes an optional `aside` snippet, a third column after the tabs** (the task
  window's comment thread is the first). It is a fixed column (`size.record-aside`), its own recipe
  in `record-window.css`, never the frame's, and a window carrying one opens to
  `size.record-window-wide` (`max-w-record-window-wide`) so the record and its tabs keep their
  geometry. It renders as a labelled `<section>`, not `<aside>`, because a complementary landmark
  may not sit inside a dialog. Without `aside` the DOM is byte-identical to the two-pane window, so
  the frame's four screenshot stories are untouched.
- **The frame is imported after `dialog.css` and `alert-dialog.css` and before `record-window.css`**
  in `styles/components.css`, because it overrides the panels' padding, gap and overflow at equal
  specificity and the record window's tab strip overrides Tabs at equal specificity. Moving the
  import breaks one or the other silently.
- **The standard for touching the frame is byte-identical screenshots** of the record window's four
  frame-bearing stories (default, editing-in-place, fits-without-scrolling,
  caps-and-scrolls-its-body) from the static catalog before and after. The extraction met it; a
  change to the frame that cannot is a change to the owner's pane system and needs the owner.
- **The unit test project carries `svelte()`** (in `vitest.config.ts`, at the top level AND on the
  `unit` project) because `.svelte.ts` runes modules — the close guard — do not compile without it;
  from the repo root only the top-level fallback is used, so a plugin on the project alone passes
  locally and fails in `pnpm test`. The package still has no `vite.config.ts`; that note is about
  the Storybook pipeline's plugin ORDER, which this does not touch.
