---
category: Changed
audience: public
---

**The floating surfaces share one alignment, one width rule and one stacking layer — settled in
the design system, not at each call site.**

A listbox, a menu or a popover now opens aligned to the right-hand edge of the control that opens
it and grows leftward, never extending past that edge and never wider than the room the screen has
for it: a long option wraps inside the panel instead of running the panel off the screen. Before
this, the components set no default of their own and the alignment was written by hand at
ninety-five call sites, with a settings row's listbox — its control pinned to the right of the
row — running off the right-hand edge of the screen. The Combobox now anchors its list to the
whole field a person sees rather than to the text box inside it, so the list's edge sits on the
field's. A caller whose control is left-anchored still says `align="start"` and wins.

The two context-menu parts move to the layer every other floating surface already sat on, above
the modal layer, so a right-click menu raised inside a dialog — the Upload dialog's queued files —
renders above the dialog and can be used, instead of painting underneath it.

## Public

**Menus and lists open where you expect and stay on the screen.** A dropdown list or a menu now
lines up with the right-hand edge of whatever you clicked and never runs off the right of the
screen; a long entry wraps inside the list instead. Right-clicking inside a dialog — the file list
in the Upload window, for one — now shows its menu on top, where it can be used.
