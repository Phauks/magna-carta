---
category: Added
audience: internal
---

`Masthead.Root` takes a `density`, and a second selection round measures what the matter's identity block can give back.

The matter's section strip now shares the header band, so the band is as tall as its taller column and the identity block is what is left to shorten. `density` (`default` / `compact` / `dense`) steps the title through the recipe — 2rem, 1.5rem, 1.25rem — because the masthead is the one door to the display serif, and a screen reaching for `text-2xl` on the Title would hand that scale back to every call site.

Six settings are rendered and measured side by side at `/developer-console/matter-identity`, dev builds only. The measurement found a floor nobody had noticed: with the overflow control stacked above the strip, the inline-end column is 40px + 8px + 41px = 89px, so the band cannot go below 90px however short the identity gets. Two settings that look quite different both land on exactly 90px for that reason. Moving the control onto the strip's own row is what breaks it — 111px becomes 76px.

Nothing under `matters/[id]` changes shape yet; the chosen setting is applied and the gallery deleted in the same commit.
