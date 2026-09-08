---
category: Fixed
audience: public
---

**A bare `Combobox.GroupHeading` throws when the listbox opens, and four pickers shipped one.**

The heading finds the identity it labels on the `Group` above it, so without one the context lookup throws — on the press rather than on render, which is why it stayed invisible: the "no matches" line is only drawn when the list is empty or fully narrowed. `matter-picker.svelte` was returning a client crash report from the Messaging screen for exactly that reason. `time-zone-picker.svelte`, `participant-picker.svelte` and the time record window's document picker carried the same line and are fixed with it.

The design system had already written this down, in `undo-redo-controls.svelte`: "Both hand-built copies of this control shipped without it."

## Public

**Four dropdowns crashed the screen when they had nothing to offer.**

Picking a matter on the Messaging screen returned an error report rather than a list. The same one-line fault was in the matter picker, the time-zone picker, the calendar's participant picker and the time record window's document picker. All four are fixed.
