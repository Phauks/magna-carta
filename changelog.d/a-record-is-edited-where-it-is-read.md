---
category: Changed
audience: internal
---

**A record is now edited in the window that reads it, and the window stops growing before its tabs
do.** Three owner rulings landed in the record window at once.

Editing happens in place. `onEdit` is gone from the shell, so there is no callback a consumer could
hang a second surface off; the header's Edit control raises the shell's own `editing` state, and the
record snippet is handed the mode so one snippet renders values or fields. The tabs are deliberately
not told the mode, which is what makes "the context pane stays read-only in both modes" true by
construction rather than by five record types each remembering it. Edit refuses entry twice over: a
consumer's own reason, and the absence of a commit path, because a mode with no way to save is worse
than no mode. Commit and abandon are the shell's, always the last two controls in that order — a
person aims at the commit without reading it, and a bar whose terminal control is worded differently
per record type costs exactly that.

A record that fits does not scroll. The panel sizes to its content, so a short record opens as a
short window with no scrollbar and no empty band under the last field; only a record that genuinely
cannot fit caps at the viewport, and then the body alone moves. The header and the action bar never
scroll away. The two statements read as contradictory and had been re-litigated more than once, so
they are written into the recipe as one ordered preference with the order stated.

Growth goes to the tabs, not to the record. The left pane stops at a measure wide enough for a
three-column field row and narrow enough that a description is not set across a monitor; everything
past it goes to attachments and history, which are the half that reads better wide. It is a bound
rather than a ratio, which is why the two panes are flex items: a track ratio cannot say "this one
stops and that one carries on".

**And the width token governed nothing until it was measured.** The recipe declared
`max-inline-size: var(--mc-size-record-window)` on a panel that arrives wearing the dialog's own
`max-w-lg`, and a Tailwind utility outranks the components layer whatever the selector — so the
window opened at 512px while its recipe named 1024. The cap is now a utility fed by the same token
(`--container-record-window`, registered in `mergeClasses` so two `max-w-*` classes cannot both
survive the merge), and the recipe says why it is not declared there. The trap is general: any
recipe setting a width on an element that also carries a width utility loses silently, and nothing
scans for it.
