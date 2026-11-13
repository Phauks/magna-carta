# The navigation layout — CLAUDE.md

A screen's two sides, navigation and content, drawn once. The package-wide rules are in [`../../../../CLAUDE.md`](../../../../CLAUDE.md).

## The navigation layout: a screen's two sides, drawn once

**`src/lib/components/navigation-layout/` is the one shape for a canvas with a navigational column
on the left and the chosen thing on the right** (owner ruling, 2026-09-11) — Settings, Magnus, and
any list-left / chosen-thing-right screen (Tools, Reports). Settings and Magnus had each drawn it
by hand at two widths with two scroll treatments.

- **It owns the landmark, the width, the scroll and the gutter — and nothing the navigation
  HOLDS.** `navigation` and `children` are snippets; grouped links, a control over rows, a plain
  list are all the consumer's to draw. There is no `items` prop, and `test/navigation-layout.test.ts`
  refuses one.
- **Both widths are tokens, no arithmetic.** The column is sized content-box: `size.popover` holds
  the rows and the gutter each side is what `standard` (space-24, the settings measure) and
  `narrow` (space-16, which lands on the global sidebar's width) differ in. A third width is a
  third gutter, not a `calc()`.
- **It cancels the canvas inset and takes the full height under the top bar**, so the canvas
  never scrolls on such a route; the two columns do, with `scrollbar-gutter: stable` so a
  scrollbar arriving never shifts what sits beside it. A screen that renders it beneath a masthead
  of its own is not this shape yet.
- **The height calc is CAPPED at the canvas, and the cap is not a plain 100%.** The viewport calc
  is a guess: it is right only while the chrome measures exactly the top-bar token and the
  viewport's `dvh` agrees with the height the shell was sized in (`h-screen`, which is `vh`). When
  it overshoots, the canvas — itself a scroll region — grows a scrollbar beside the two columns,
  and one surface shows three. `max-block-size: calc(100% + var(--mc-space-48))` bounds it from
  the parent instead. The `+ space-48` is the cancelled inset: a percentage resolves against the
  canvas's CONTENT box, which is already short by the inset the `-m-24` gives back, so capping at
  a bare 100% would pull both columns up by 48px and leave a band of bare canvas under them. Where
  the parent has no definite height (a catalog story's box) the percentage cannot resolve, the cap
  behaves as `none`, and the calc stands alone. What this does NOT reach is a sibling ABOVE the
  layout inside the canvas (the app's `PlatformNotice`): that pushes the layout down by its own
  height and the canvas scrolls by exactly that, which needs the shell's `<main>` to become the
  flex column the layout is a child of.
- **A title can SPAN both columns (`header`), and the navigation can PIN something under its
  scroll (`navigationFooter`).** Both are optional, and giving neither leaves the DOM byte-identical
  for the screens composing this today. The calendar asked for both and neither is calendar-specific:
  a title that names the SCREEN belongs over the whole canvas rather than over one column of it, and
  a rail with a picker under it is the shape of every navigation whose last element must stay in
  view while its list scrolls. The header sits inside the cancelled canvas inset and puts the gutter
  back itself; `navigationFooter` moves the scroll region and its reserved gutter off the `<nav>`
  onto an inner stack, because a pinned footer cannot sit inside the thing that scrolls past it. The
  landmark stays the `<nav>` either way.
- **`contentScrolls={false}` for a page that stages header / scrolling middle / pinned footer.**
  The column is then a bare full-height flex stack and the page owns its scroller; otherwise the
  page's middle would draw a second scrollbar inside a column that had already reserved a gutter.
- **The content column adds no tab stop.** A scroll region a keyboard can reach holds something
  focusable, and every product page does; the layout does not put a stop before every page's
  first control. A page of pure prose must bring a control — axe's `scrollable-region-focusable`
  says so, and the stories carry an action for that reason.
- **Narrow viewports stack the navigation above the content and scroll the layout as one**, below
  `lg`. Nothing in the design language decides a breakpoint; `lg` is where the safe-browse
  website shell already stacks its two panes, and a navigation pinned on top would eat the
  viewport on a long nav. A recipe cannot carry a breakpoint (a literal length is banned in
  `components.css`), so the stacking is `max-lg:` / `lg:` utilities on the elements.

### The row, the one thing the column does NOT draw itself

**`Row` is the second export of `./navigation-layout`** (as `Row`, as `NavigationLayoutRow`, and
the layout itself as both the default and `Root` — the default came first and every consumer imports
it that way, so it stays). The layout still imposes no structure on what the navigation holds; the
row is offered, never required. It became a part because its treatment had been written by hand
three times — the settings nav, the catalogue column Tools and Reports share, and the inline styling
in both — with a fourth two-sided screen already foreseen.

- **The element follows from `href`, and the part guesses nothing.** A string is an `<a>`; omitting
  it is a `<button>` (the shape a conversation rail takes); **`null` is a row with nowhere to go
  yet** — unlinked, `aria-disabled`, quieter, with the Soon mark in its `trailing` slot. `null` is
  the spelling the app's catalogue vocabulary already uses for the same fact. It is deliberately NOT
  a disabled control: a greyed-out button reads as broken, a quiet row reads as not yet.
- **A name WRAPS; it never truncates.** The column is 224px of content and a name beside a mark does
  not always fit one line, so the control height is a `min-block-size` and the recipe carries no
  `white-space` and no `text-overflow` — `test/navigation-layout.test.ts` refuses both. "Property
  Listin… Soon" has stopped naming the tool, which is the row's one job. The sidebar rail truncates
  because its label collapses to an icon; this column never does.
- **Every treatment is recipe, none is a call-site class.** Resting muted ink, the hover tint, and
  `current` (selected fill, firmer text, the gilt start-edge bar as an inset box-shadow — a border
  would bend around the rounded corners) all live in `navigation-layout-row.css`. A screen passing
  its own colours here is the defect the part exists to end.
- **`icon` and `trailing` are snippets.** The glyph is sized by `mc-navigation-layout-row-icon`,
  which the part applies itself; the trailing mark never shrinks.

### The group, the column's fold

**`Group` is the third export of `./navigation-layout`** (as `Group` and as `NavigationLayoutGroup`)
— a heading that folds what it holds. It exists because the owner asked whether the settings nav's
folds and the rail's were one component (2026-09-17); the answer is that the disclosure GRAMMAR is
one and the rows are not.

- **One grammar, and the sidebar settled it.** The heading IS the control — not a chevron beside a
  label, not a control in a row of its own — it keeps its own voice rather than dressing as a
  button, its hit target is the whole width, and the chevron points down while open and toward the
  inline start while folded. `Sidebar.GroupTrigger` says the same thing in the chrome register.
- **It composes `mc-field-label` rather than restating the caps voice**, the way the sidebar's
  trigger composes `mc-sidebar-group-label`. A recipe that retyped the register would be the second
  copy of it that FieldLabel exists to prevent.
- **Two levels, and the indent stagger is the recipe's**: `band` (a glyph, firmer ink, the column's
  rule under it) over `group` (a step in, quieter) over the rows (a step further). The settings
  column had that stagger in utilities and an inline `padding-inline-start`; it is one recipe now,
  so a two-sided screen cannot re-choose it.
- **The fold is the CONSUMER's.** Nothing is remembered here — the app stores a member's folds as
  departures from everything-open, and a part with its own memory would be a second answer to that.
  It takes `expanded` and reports the press through `onToggle`.
- **Folded means ABSENT.** The rows are removed rather than hidden, and the heading carries
  `aria-expanded` alone — an `aria-controls` naming an element that is not there is an invalid
  reference, and a `hidden` attribute would leave the rows under the keyboard's fingers.
- **The sidebar was NOT migrated onto it, deliberately.** `Sidebar.MenuTrigger` is a three-track
  grid with an icon column, a truncating label and a collapsed-rail tooltip — a different anatomy,
  and absorbing it would grow this part four props and stop it being one thing. Migrating
  `Sidebar.GroupTrigger` alone would split one visual fact across two class names in the rail
  (`mc-sidebar-group-chevron`, which the menu trigger also wears, against this part's own), which
  is worse than the duplication it would remove. What the two share is the grammar, and the grammar
  is written down here and in the sidebar's own note.
