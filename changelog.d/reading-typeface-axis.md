---
category: Added
audience: public
---

**The reading typeface is a live user axis.** Settings · Text's Font Family row, a Soon seam until now, applies one of five faces instantly: Atkinson Hyperlegible Next (default), Lexend, OpenDyslexic, Literata (the one serif reading profile) and the system face. A `typeface` resolver modifier in `packages/design-tokens/resolver.json` emits `:root[data-typeface="…"]` overlays that re-point `--mc-font-sans` only; Tailwind's `--font-sans` now maps onto that variable in `tailwind.template.css` instead of the inlined stack, so `font-sans` and the document default follow the choice. The preference rides the existing theme-preference seam (`magna-carta.typeface`), the no-flash boot script in `apps/web/src/app.html` mirrors it, and the change ledger and Restore work as on Accessibility. The three new faces are self-hosted OFL Fontsource packages declared in `fonts.css`; a browser fetches their files only when a person picks one. The developer appearance module now passes the axes it has no switcher for through unchanged instead of resetting contrast and scroll-edge markers to their defaults.

## Public

**Choose the typeface you read in.** Settings · Text now lets you set the interface in Atkinson Hyperlegible, Lexend, OpenDyslexic, Literata or your computer's own font. It applies at once, follows you across your open tabs, and is yours alone: it never changes what anyone else at your firm sees.
