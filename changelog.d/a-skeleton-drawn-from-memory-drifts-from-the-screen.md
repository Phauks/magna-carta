---
category: Added
audience: internal
---

**The loading framework is researched: one region that renders the real screen over a fixture and greys its leaves, in place of 89 hand-drawn skeletons.** [`docs/research/2026-09-05-skeleton-loading-framework.md`](docs/research/2026-09-05-skeleton-loading-framework.md) answers the evaluation flagged in the design system on 2026-06-13. It inventories every loading shape in the app (one sized-by-the-caller primitive, eight design-system components with three names for the same count prop, 89 hand-placed tags in 37 files with roughly seventeen freehand sizes, half of them outside any announced region) and surveys the libraries that promise to derive the skeleton from the finished component.

The finding is that every such library, runtime or build-time, needs representative content before it can measure anything, and once a fixture exists the measurement is the part worth dropping. The recommendation is a design-system region that takes one boolean and one sentence, renders the real markup over a fixture with a CSS recipe that turns text, media and controls into bones while the frame stays real, is `inert` and `aria-busy` while loading, and is enforced by a `lint:one-ui` rule that retires the hand-placed form. `boneyard-js` is recorded as the fallback to trial if fixtures prove the real cost. Nothing is built; the spec is the next step.
