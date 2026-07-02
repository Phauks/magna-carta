---
category: Added
---

**`@magna-carta/design-tokens` — `border-width.default` (1px) hairline primitive** (slice 0·7a Phase D): a mode-invariant dimension token the Tier 1 control recipes consume for the design language's 1px hairline structure (design-language doc §6), so `components.css` carries no literal border widths. Mirrors the focus-ring width/offset precedent; the design-system boundary self-check already anticipated `--mc-border-width-default`. Regenerated `generated/tokens.css` and re-pinned the golden in the same commit (`tailwind-theme.css` unchanged — recipes consume the var directly); all five token gates green.
