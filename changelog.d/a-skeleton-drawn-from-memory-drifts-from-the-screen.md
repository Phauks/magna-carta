---
category: Changed
audience: internal
---

**Every loading state in the app runs through one region, and the placeholder is the component itself.** `LoadingRegion` (`@magna-carta/design-system/loading-region`) renders a surface's real markup over a fixture snippet while its data has not arrived, and one recipe turns the text, media and controls into bones while the frame, the headings, the labels and the column heads stay real. The region takes `loading` and a `label` sentence, is `inert` and `aria-busy` while loading, and owns the rest by having no prop for it. Eighty-nine hand-placed `Skeleton` boxes across thirty-seven files, three loading sentences and two static spinner glyphs are gone; the `./skeleton` export is gone with them, and the box stays only inside the six design-system components that render placeholder rows of their own shape, under one count prop name, `placeholderCount`.

The research behind it ([`docs/research/2026-09-05-skeleton-loading-framework.md`](docs/research/2026-09-05-skeleton-loading-framework.md)) surveyed the libraries that derive a skeleton from the finished component and found that every one of them, runtime or build-time, needs representative content before it can measure anything, and that once a fixture exists the measurement is the part worth dropping. The design is [`docs/specs/2026-09-05-loading-region-design.md`](docs/specs/2026-09-05-loading-region-design.md).

It cannot stray: `lint:one-ui` carries a `hand-placed-loading` rule that fails the Skeleton import or tag, the recipe class, `aria-busy`, a pulsing utility or a loader glyph anywhere in the app, and the same signals inside the design system outside the homes the registry declares; the rule is proved against known-bad input, the region's story asserts the announcement and the inert fixture, and `/developer-console/loading-states` shows every shape beside its settled state.
