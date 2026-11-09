---
number: 437
slug: the-component-is-its-own-skeleton
status: Accepted
date: 2026-09-05
area: Design system
summary: "Every loading state in the app runs through one design-system region, LoadingRegion, and the placeholder is the component itself: the real markup renders over representative content and one CSS recipe turns its leaves into bones while the frame, the headings, the labels and the column heads stay real. Nothing is measured at runtime and nothing is captured at build time, because every library that promises to derive a skeleton from the finished component needs representative content before it can measure anything, and once that content exists the measurement is the part worth dropping. The region takes the two facts only its caller knows, whether it is loading and what it is reading, and owns the rest by having no prop for it; it is inert while loading so a fixture can never be pressed or read as real. Skeleton leaves the public surface and stays as an internal box for the six design-system components that render placeholder rows of their own shape. A lint:one-ui rule fails any hand-placed loading state on either side of the line, with the homes allowed to hold one declared in the registry and every exception recorded with its reason."
---

**A placeholder drawn from memory of a screen drifts from it; a placeholder that is the screen
cannot.**

**Context:** The app had one loading primitive, a sized-by-the-caller grey box, and eighty-nine
hand-placed copies of it across thirty-seven files, sized by roughly seventeen freehand utility
combinations, about half outside the announced region the primitive's own comment required. Three
surfaces showed a sentence instead, two a static glyph. The owner had flagged the drift on
2026-06-13 and asked for one generalized way to show that something is loading, ideally one that
derives the placeholder from the finished screen. The research
([`docs/research/2026-09-05-skeleton-loading-framework.md`](../research/2026-09-05-skeleton-loading-framework.md))
found that the libraries which promise that, runtime measurement (phantom-ui, auto-skeleton) and
build-time capture (boneyard-js), all hit one wall: a data-driven component has no shape until it
has data, so every one of them needs a fixture anyway. Runtime measurement then pays a forced
layout per leaf on every transition; build-time capture commits pictures of a layout that do not
reflow and go stale silently, and brings a browser into the build.

**Decision:** Keep the part those libraries do before they measure and drop the measuring. One
Tier 1 region, `LoadingRegion`, renders the real markup over a fixture snippet under the
`mc-loading` recipe, which greys text, media and controls and keeps furniture, and announces the
state once with a sentence and `aria-busy` while holding the fixture `inert`. The recipe hides text
with `-webkit-text-fill-color` so a utility class in the utilities layer cannot show it, and is
imported last so it wins over every recipe a region can hold. The Skeleton export is removed; the
design-system components that render placeholder rows of their own shape keep the box internally
and one count prop name, `placeholderCount`. A `hand-placed-loading` rule in `lint:one-ui` fails
the Skeleton import or tag, the `mc-skeleton` class, `aria-busy`, `animate-pulse` and a Lucide
loader glyph in the app, and the same signals inside the design system outside the declared
`loadingHomes`; a busy live act that is not a placeholder (a search field with a query in flight)
is a recorded allowance with a reason, printed on every run and failing when it outlives its
violation. The developer console gains a `loading-states` gallery as the review surface.

**Consequences:** No dependency, no main-thread cost beyond a style recalculation, and no second
implementation of any screen. Every loading region is announced. A fixture is authored beside its
surface in the components the surface uses, which is the cost, and it is the cost every other
approach paid too. A surface whose furniture is already its shape needs no fixture at all. The
failure exit sits outside the region so a failed read can never leave the shape standing. Open: the
four-state region that would also own the failure and empty branches, and the bone contrast
against WCAG 1.4.11.

**Second round (2026-09-06):** the region holds the whole state set — `failed` renders the
surface's failure snippet first, `empty` its empty state, `refreshing` keeps the content and marks
the region busy — so the failure-exit ruling is structural and the four-branch chain is gone from
every surface. A read past fifteen seconds states itself on the screen with Retry; the status line
announces the finish; every settle is measured through the User Timing API and a bubbling event the
app shell records as a breadcrumb. A sample vocabulary supplies every fixture's words. Two more
`lint:one-ui` rules, `silent-loading` and `fixture-shape`, close the gaps the first rule left. The
bone's contrast is measured at 1.16:1 to 1.59:1 across themes and pinned at a floor; whether it must
meet 3:1 remains the owner's.
