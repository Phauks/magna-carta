---
category: Fixed
audience: internal
---

Two defects in the newly ported Files screen, both found by running the app and neither visible in any gate.

`size-14` is not 14px. This project's Tailwind theme sizes in pixels — `size-16` is 16px — but 14 is not a size the theme defines, so it fell through to Tailwind's own rem scale and rendered at 56px. The folder rail's Home and New folder glyphs were 56px inside 32px buttons. It typechecks, it lints, svelte-check passes, the bundle builds, and the class reads exactly like the correct one beside it.

`lint:icon-sizes` now pins it. The sanctioned set is READ from `packages/design-tokens/generated/tailwind-theme.css` rather than listed in the check, because the first draft carried a hand-written list that both invented a size the theme does not define and omitted three it does — the same second-home-for-one-fact failure the rule exists to catch. Storybook stories and comments are out of scope: stories use vanilla Tailwind utilities deliberately, and the Skeleton component's doc block names `size-10` to explain it.

The three panes had no height. Their parent chain reaches the shell's block-level `<main>`, and a block parent does not stretch a flex child, so `flex: 1` stretched nothing and the whole file manager collapsed to 190px — a quarter of the window, with the rest of the page empty below it. The wrapper now takes an explicit height.
