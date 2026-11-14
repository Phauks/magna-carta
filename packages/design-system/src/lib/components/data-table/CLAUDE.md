# The data table — CLAUDE.md

The table's own controls and the grid's frame, scale and row marks in `@magna-carta/design-system`. The package-wide rules are in [`../../../../CLAUDE.md`](../../../../CLAUDE.md).

## The table's own controls: three components, not a snippet per surface

**`DataTable.ClearFilters`, `DataTable.GridFigures` and `DataTable.LoadMore`** are the controls a
table's control row and counts strip are made of. Each was hand-built on several surfaces first —
the clear control seven times in three shapes, the figures strip five times with one already in the
opposite reading order, load-more three times in two places — and the drift is why they moved here.

- **What a surface varies is WHERE it puts them, never what they look like.** The owner's 2026-09-03
  placement: the clear control goes in the control row above the table, where the filters were set;
  the undo and redo pair goes in the footer. `docs/conventions/design-corrections.md` carries it.
- **`ClearFilters` is two acts and says which.** Column filters alone read "Clear Filters"; a
  surface whose own search or scope is also holding rows back passes `narrowing` and the control
  reads "Show Everything", because clearing a search under a button labelled Clear Filters is a lie
  about what the press will do. Neither is configured — both are derived. Its `grid` is optional:
  a surface can be narrowed before its grid exists.
- **It renders NOTHING when nothing is in play**, and so does `LoadMore` at the end of a list. That
  is the standing rule for a control that undoes a state — absence is the answer, never a disabled
  control.
- **`GridFigures` takes TEXT.** Money, durations and counts each format through their own home; a
  strip that took minor units and a currency would have to learn all three and still be wrong for
  the fourth. What it owns is the arrangement: label first, figure second, tabular, `·` between,
  and the "In view:" prefix under a filter — a total that silently changed meaning when a column was
  filtered is the most quietly wrong thing a footer can do.
- **The footer's inline "Show all" stays.** It is part of the tally sentence ("x of y · filtered on
  Status, Matter"), not a control in a control row, and the two are different things.

## The grid's frame, its scale, and its row marks

**A Tooltip is a dismissible layer with behaviour `close`.** An open hover label therefore outranks
the panel beneath it in Bits' layer stack, and Bits will not dismiss that panel on an outside press
while the label shows — which is why two top-bar panels could stand open at once. The top bar
settles it by state rather than by pointer: `TopBar.Root` declares an overlay band
(`internal/overlay-band.svelte.ts`) and `Popover.Root`, `DropdownMenu.Root` and `Dialog.Root` join
it where one exists, so opening any panel in the band closes the others. Everywhere else the join
finds no band and does nothing.

Three things about `DataTable.Grid` that a surface gets wrong by spelling them out itself.

- **A `sortColumnId` of null renders the rows as given.** `initialSort.columnId` accepts null and
  `setSort(null)` clears the sort, which is how a ranked answer keeps the server's relevance order
  until the reader sorts a column themselves (the Directory's search does this); a surface never
  re-sorts a capped best-of into a sorted-looking index of its own.

- **`frame` is `card` or `flush`, and it is a prop rather than three utilities.** A card is the
  hairline, rounded table-card, and its LAST ROW DROPS ITS HAIRLINE because the card's own bottom
  rule runs one a pixel below it. Flush is edge to edge inside a frame the surface already draws —
  a toolbar above, a footer below — so the table takes the frame's full height, the surface
  continues past the last record, and the last record KEEPS its hairline, because there is no
  bottom rule left for it to meet. Nine surfaces were each passing `rounded-none border-0` to get
  the paint, which gave them the paint and none of the rest: the file list's last file was the one
  row in the list with nothing under it.
- **`scale` is the reader's own multiplier, and it moves four things.** 1 is the design's own size,
  so a table nobody scales carries no inline declaration at all. It moves the row's text, its
  height, the padding inside it, and the glyphs that ride in a row — which wear
  `mc-table-grid-row-glyph` rather than a `size-*` utility, so they scale with the row. It moves
  NOT the hairlines (a scaled hairline is a blurred one), nor the header band or the footer strip,
  which are the frame around the list rather than the list. The four metrics are declared in the
  recipe as the tokens they already were and multiplied in the COMPONENT, written back as an inline
  style: `calc()` is neither a token reference nor a structural keyword, and the recipe layer is
  token-pure by gate (`components-css-token-purity`). Density is a separate axis and multiplies in;
  never derive one from the other, which is how the file manager's ten-step control came to have
  exactly one visible step.
- **A row mark is painted into the first cell's leading padding, never rendered ahead of its
  content.** The space is reserved on every row of a table that CAN mark one — a capability that
  cannot change under the reader — so marking a row lights a glyph and moves nothing. It is padding
  and not an inline box because an inline box only stays on the content's line while the content is
  inline too, and every surface composing an icon beside a name reaches for flex, which is
  block-level: the mark then took a line of its own ABOVE the content, and the row was two lines
  tall with its first column sitting low in it.
- **A record written in place is a band's FOOT LINE (`bandFoot`), never a row a surface draws.**
  The grid draws it under each band's last row (once after the last row, and under No Results, when
  the rows are not banded): one cell across at rest, one cell per visible column with the pinned
  offsets while the surface says that band is `editing`. It carries `data-grid-band-foot` and never
  `data-grid-row`, so counts, selection and the grid's keys pass it by; the keys stop at it so its
  buttons keep Enter and the arrows. The task list's add line is the first consumer.
