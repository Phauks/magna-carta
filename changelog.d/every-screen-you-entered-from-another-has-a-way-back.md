---
category: Changed
audience: public
---

**Every screen's title now comes from one component, and a screen entered from another names where it came from.** The two are the same change: the reason three detail screens shipped with no way back is that there was no one place a header rule could live. Twenty screens assembled the design-system Masthead by hand in eight different combinations of its parts; four more hand-rolled an `h1` over a letterspaced `p` outside the design system entirely; and three area wrappers (settings, account, matter) had each partially centralized it for themselves, duplicating the same framing verbatim. Nothing was wrong with any one of them — the problem was that "what does a screen header look like here" had twenty-four answers.

`apps/web/src/lib/screen/screen-header.svelte` is now the one answer: the way back, the eyebrow, the title, the citation line, the actions, and a `trailing` column for a band that shares its height with something else. The Masthead recipe stays the primitive underneath — the register, the display serif, the density step — and this is the one assembly of it. Twenty-four call sites became one; `Masthead.Root` now appears exactly once in the application.

**The way back is named, not drawn** (owner's direction, 2026-09-03). A screen passes a destination **id** — `back="directory"` — and the href, the user-facing label and the glyph all come from the sidebar's own registry, so a back link cannot point at a screen that does not exist, cannot call it something the sidebar calls something else, and cannot go stale when a path moves. `DestinationId` is a literal union derived from the registry, so a typo is a type error rather than a link that renders and goes nowhere. The arrow shows the destination **in miniature** — its own sidebar mark beside its own name — because the point is to learn where the link lands, not merely that there is a way out. A screen outside the sidebar (the developer console) passes a spelled-out target instead, deliberately more work to write than an id.

The matter band takes the one shape too, which costs it a row it had spent two rounds saving: its way back was an unlabelled arrow inside the citation line, which cost no height but said only "back". It now leads the band, named and marked, in the same place as on every other screen.

`pnpm run lint:back-navigation` answers three questions from the route tree and the registry rather than from a list: every route whose nearest ancestor route renders a page passes a `back`; the destination it names resolves to that ancestor's own path; and nothing in the application assembles `Masthead.Root` itself or builds its own back link out of `EyebrowLink` and an arrow icon. The third is what keeps the first true — a screen with a hand-made header is free to grow its own idea of the way back, or none. It runs in the inner loop and in CI by derivation (every `lint:*` script in the root manifest is repo-wide), and its nineteen tests feed it deliberately broken route trees, including the one that would make the whole gate pass vacuously: a component walk that followed the import into the shared header and found the back link every screen's answer flows through.

## Public

**Every screen you open from another screen now shows you the way back — and says where it goes.**

Opening a person from the Directory, or a conflicts check from the register, used to leave you with the browser's back button and the sidebar. That is fine until the screen arrived some other way — from a link a colleague sent, from a search result, in a fresh tab — where there is no history to step back through.

The way back sits at the top left of the screen, above its title, and it shows the destination the way the sidebar shows it: the same small mark, the same name. Back to Matters, back to the Directory, back to Conflicts Check. You can tell where it lands before you click it.

Screen titles across the application also read the same way now, in the same place, at the same size — the headers had drifted apart one screen at a time, and they have been brought back together.
