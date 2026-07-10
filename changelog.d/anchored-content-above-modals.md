---
category: Fixed
---

**Pickers opened inside dialogs are clickable again.** Anchored floating content — select and combobox listboxes, menus, popovers, tooltips, date pickers — used to paint beneath a modal dialog's panel, so a picker inside a dialog (like the change-request recipient search) could only be driven by keyboard. The layer scale gains a documented `anchored` layer above `modal` and below `toast` (the ecosystem norm: anchored content hosted in a dialog must float over it; notifications still win over everything), applied through the one floating-content seam so every anchored surface moved together, with a CI assertion pinning the layer order so a regression fails in tests rather than in someone's browser.
