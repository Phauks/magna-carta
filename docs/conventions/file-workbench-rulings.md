# File Workbench — the owner's standing rulings

Every ruling the owner has issued on this screen, cumulative, newest round last. **A ruling here is
settled.** It is not re-derived, re-proposed, or re-litigated by a later round, and a round that
silently reverts one is a regression, not a redesign.

Read this file before changing the screen, and check the built screen against it after. Do not
rebuild the screen from scratch: edit it.

Status values: `settled` (built and confirmed) · `regressed` (was settled, a later round undid it) ·
`open` (asked for, not yet built) · `superseded` (a later ruling replaced it, with the pointer).

The surface: `apps/web/src/lib/tools/file-workbench/`, rendered at `/file-workbench` — a sidebar
destination in the Firm group, not a screen inside the Tools area. Its local rules are in the
`CLAUDE.md` beside the code; this file is the review record.

## R1 — first round: the shape of the surface

| #   | Ruling                                                                                                                                                                    | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| W1  | The ten file utilities are ONE screen, not ten. A file is dropped once and every capability addresses it.                                                                 | settled |
| W2  | The capability tabs sit on the RIGHT, over the findings they govern. A full-width strip reads as though it switches the whole screen, and it does not.                    | settled |
| W3  | There is no separate empty state. The empty screen is the filled screen lacking information: the same regions, each saying what it is missing.                            | settled |
| W4  | No explanatory notes. A panel states findings; it does not explain the product to the reader ("Every file that arrives here is scanned before anything else touches it"). | settled |
| W5  | No status pills describing the capability itself ("Ran on arrival", "Needs your consent"). The reader is looking at the reading, not at its provenance.                   | settled |
| W6  | A file the scanner flagged still gets the full treatment. This bench exists for files nobody trusts, and withholding the readings is what leaves a person guessing.       | settled |
| W7  | Conversion takes a multiple selection, so a bulk conversion is one gesture.                                                                                               | settled |
| W8  | The surface is built modularly: adding a capability, or changing what the Overview says, is self-contained.                                                               | settled |

## R2 — second round: the list becomes a table

| #   | Ruling                                                                                                                   | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ------- |
| W9  | No dashed drop area in the left pane. The pane ITSELF takes a drop; nothing is drawn for it until a drag is over it.     | settled |
| W10 | The upload button sits at the top of the list, not at its foot.                                                          | settled |
| W11 | Every row carries a triple-dot menu of its own, holding Discard and whatever else the row can do.                        | settled |
| W12 | No Discard All in the masthead. Discarding is the list's verb and belongs to the list.                                   | settled |
| W13 | The file count does not sit in the masthead. It belongs to the list, in the list's own footer beside the selection.      | settled |
| W14 | The left pane is a TABLE, sortable by name, type, size and arrival time.                                                 | settled |
| W15 | Readings are encapsulated in tables with their own headings and edges, never a bare list of values floating on the page. | settled |
| W16 | One control shows or hides the preview, and it holds whichever capability tab is open.                                   | settled |

**What R2 changed under the hood, and why it is not a detail.** The list is now the product's one
grid (`DataTable.Grid`), not a bespoke rail — so sorting, per-column filters, show/hide, reorder,
pinning, the selection gestures and the footer counts are the same behaviours the matter's ledgers
have, and this surface cannot drift from them. The bespoke selection module that preceded it is
deleted: the grid owns selection. The narrow pane is why Arrival and Safety start hidden — the
columns menu at the top of the list shows them, and the grid remembers.

## R3 — third round: the list keeps its own verbs

| #   | Ruling                                                                                                                           | Status  |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------- |
| W17 | No standing Discard button. Throwing a file away is that file's own verb: its triple-dot menu, and the same menu on right-click. | settled |
| W18 | The reader chooses which side of the readings the file is drawn on, and the choice is remembered.                                | settled |
| W19 | Resizable edges carry no grip. The edge is the affordance; a grip drawn on it is furniture on a work surface.                    | settled |

## R4 — fourth round: two containers, and the screen's controls together

| #   | Ruling                                                                                                                    | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------- |
| W20 | Add Files and the columns menu sit at the top right with the rest of the screen's controls, not in a strip over the list. | settled |
| W21 | With that strip gone, the list starts at the top of its pane.                                                             | settled |
| W22 | The tabs read as tabs: they sit on the top edge of the panel they switch, not floating over open page.                    | settled |
| W23 | The whole right side is a container with edges, the same way the file list is.                                            | settled |

**Where the controls live, and why it moved code.** Every control in the masthead acts on the
surface — adding files, which columns the list shows, whether the file is drawn and on which side —
so the masthead moved into the screen component and the route became thin. A route holding those
would have had to reach into the list's grid to render its columns menu.

## Standing questions this surface has already answered

- **"Are these files deleted after a while? Should we say so?"** Today, no: nothing is uploaded, so
  there is no retention to report — the files never leave the browser and closing the page clears
  them. The masthead says exactly that. When the firm-scoped scratch object lands, the same line
  becomes the retention promise (what is held, and until when), and the surface gains the Discard
  that deletes it now. The line is the one place that sentence lives.
