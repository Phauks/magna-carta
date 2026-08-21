# Design lab — running notes

Working artifacts for the 0·7a craft re-evaluation. Static markups, cheap to discard;
winners get folded into `@magna-carta/design-system`.

## Owner reactions

- **2026-07-02 — Matters list, three registers (A/B/C):** A (Engraved Ledger) is best _for the
  list screen_ — owner appreciates the flow, likes the overall look. Explicitly NOT a decision
  for the matter workspace screen. B/C stay as vocabularies to steal from (B masthead register
  for page headers; C keyboard rail for tables) rather than whole-screen registers.

- **2026-07-02 — Home + Matter workspace in the A register:** "a solid win" — the voice is
  approved as the system register (serif masthead + citation metadata at the edges, ledger voice,
  small-caps labels, gilt draw). Contents/placement of items will evolve with the tool; that's
  expected and fine. Two corrections:
  - The Home greeting + quote header spends too much vertical space — content wants it back.
    Masthead must stay compact.
  - Quotes should NOT spend vertical space. Owner liked BOTH compact placements: the one-liner on
    the greeting's baseline (top) AND the colophon at the page foot — final placement "figure out
    later." Transitional places (loading, sign-in, empty states) + quote-of-the-day still the
    principle. The tall static quote block is dead.

## Direction vocabulary (from the inspiration research, 2026-07-01)

- Small-caps letterspaced label voice (11px, +0.09em) for every structural label.
- Ink-tinted hairlines (`rgba(35,33,26,…)`), never gray; structure from rules, not shadows.
- Ledger voice for money: tabular numerals, muted cents, single rule above / double rule below
  totals (the accountant's close).
- Gilt draw: gold never fades in — it draws (scaleY 140ms, ease-out `cubic-bezier(0.23,1,0.32,1)`).
- Grain on chrome only (SVG turbulence at 5%); never on work surfaces.
- Two easings total: out `cubic-bezier(0.23,1,0.32,1)`, in-out `cubic-bezier(0.77,0,0.175,1)`;
  no bounce anywhere. Micro 100–140ms · standard 160–220ms · structural 240–300ms.
- Serif display (Fraunces ~440–460, off-grid weight) at ceremonial edges: page mastheads,
  matter names in headers — never in dense workflow cells (that stays the reading sans).
- Heritage at ceremonial edges only (design-language law, owner re-confirmed 2026-07-01).

## Motion stack — anime.js (owner request, 2026-07-02)

Owner wants **anime.js** for animations ("replace or supplement"). Current state: NO JS animation
library is installed — functional motion is CSS keyframes (`animations.css`) + View Transitions;
the design language names GSAP for signature moments but it was never adopted. So anime.js v4
(MIT, modular, ~10kB core) can take the signature-moment / complex-choreography slot with nothing
to replace. Constraints it must respect: compositor-only law (transform/opacity via WAAPI or
element.style — both CSP-clean; never injected <style>), the reduced-motion structural guarantee
(the JS `prefersReducedMotion` gate the design-system CLAUDE.md says must accompany the first
JS-driven animation), and lazy-loading (signature moments only, never the hot path). Record as an
ADR when the first consumer lands (likely the written-live wordmark on the 0·7b auth screen).
The architecture audit agent was asked to propose the exact integration seam.

## Architecture audit (2026-07-02, full report: audit-2026-07-02.md)

Verdicts: tokens needs-attention · recipes sound · composition boundary needs-attention · theming
sound · motion sound · one must-fix (apps/web-worker never imports fonts.css). Fix-now items in flight.
Two decisions taken PROVISIONALLY while the owner was away (re-raise for confirmation):

- **Density axis: prove it fully** (re-plumb control recipes through density aliases + real
  compact values + the data-density overlay) rather than re-scoping the design-language claim.
- **Token namespace: rename type sizes** to `--mc-font-size-*` (semantic text colors keep
  `--mc-text-*`), killing the silent color/size collision while consumers are one package.

## Audit fix-now batch — status (2026-07-02)

All seven fix-now items landed: app fonts + stylesheet-mirror test; rem tracking; motion axis as
resolver modifier (+ signature 500ms rung, easing.settle/travel) with data-motion seam + boot
script; density axis proven (control.xs, density.control-sm/md/lg aliases, compact overlay,
recipes re-plumbed with min-block-size, data-row-density rename) with data-density seam;
surface.selected/field; grammar widenings (content:"" + physical-property RTL gate);
--mc-font-size-\* rename; anime.js 4.5.0 seam (signature-motion.ts + motion-preference.ts +
import-boundary gate). DEFERRED from the kit: the csp-spike extension for anime.js — the wrapper
is dormant (no consumer yet); extend the spike when the first signature moment lands with its
ADR (the audit's step 3).

## Owner decisions — 2026-07-02 (dark pass + chrome)

- **Design LIGHT-FIRST.** Dark mode may look good but "a light mode is always expected" and dark
  is wrong for certain audiences — light is the primary design target; dark is derived, verified,
  never the driver.
- **Smooth brand corner (law):** no hairline beneath or beside the brand corner — the chrome is
  one unbroken ink surface; the chrome<->canvas contrast is the edge. Landed in sidebar.css + all
  lab pages.
- **Gilt CTA: FILLED** in both modes (the one loud gold moment per screen).
- **Panel elevation: LIFTED** — "important for visual distinction." Note the register implication:
  in the lab, the light canvas is warm paper with WHITE cards lifted off it; the token layer
  currently has page=neutral.0 and raised DARKER — reconcile surface mapping when folding (the
  canvas should be the warm paper step, panels lifted above it) — this is the next token design
  conversation.
- **Table header fill in dark: re-evaluate later** (owner deferred).

## Open questions

- Matter workspace register (owner flagged the list decision doesn't carry over).
- Which details are system-wide law vs. per-archetype: double-rule totals, keyboard rail,
  serif mastheads.
- Dark mode pass for the A register (not yet mocked).
