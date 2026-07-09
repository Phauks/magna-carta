---
category: Fixed
---

**The styled scrollbar now actually renders in Chromium, and the app shell wears it.** The
`mc-scrollbar` recipe declared both the standard `scrollbar-width`/`scrollbar-color` properties and
the `::-webkit-scrollbar` pseudo-elements; Chromium takes the standard path whenever those
properties are present and ignores every webkit rule, so our pill thumb never rendered and Chrome
drew its own scrollbar, arrow buttons and all. The standard properties are now quarantined to a
Firefox-only `@supports` guard and the default path is `::-webkit-scrollbar` pseudo-elements only
(with the arrow-button pseudo explicitly suppressed). The thumb is restyled to a floating pill —
fully rounded, `border-strong`, inset from a slim 8px track to a 6px visible width via a transparent
border plus `background-clip: content-box`. The recipe is applied where it was missing: the app
shell's work canvas (the app's single scroll region), the Settings nav column and every Settings
page's scroll area, and the developer console.
