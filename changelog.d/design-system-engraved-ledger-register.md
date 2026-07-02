---
category: Changed
---

**Design system — the Engraved Ledger register (first fold).** The owner-approved finishing voice lands in `@magna-carta/design-system`: self-hosted fonts now actually load (Atkinson Hyperlegible Next Variable for reading, Fraunces Variable for display serif at ceremonial edges, UnifrakturMaguntia for the brand mark — the catalog previously rendered in the system-ui fallback); a new `BrandMark` component (blackletter illuminated M + letterspaced MAGNA CARTA wordmark) replaces the placeholder icon in the sidebar brand corner; structural labels (sidebar group labels, table column headers, filter headings) take the letterspaced-caps voice via the new `tracking.caps` token; and the Tabs active indicator becomes a gold underline that draws in (the "gilt draw" — new `mc-draw-x`/`mc-draw-y` keyframes, reduced-motion safe). Also fixes the table sort button silently discarding the header's uppercase (UA `text-transform: none`).
