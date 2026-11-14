---
category: Added
audience: public
---

**The PDF Editor's Bates tab.** Prefix, suffix, first number, digits, position, typeface and size are set beside a preview of the first and last pages, then `stampBates` runs in the operations worker and the numbered copy is filed beside the original as `<name> (<first> to <last>).pdf`. The settings are checked before the engine is asked (`apps/web/src/lib/pdf-editor/bates.ts`), including the characters the engine's Windows Latin font encoding can print, so a refusal names the field instead of failing the run.

## Public

**Bates-number a PDF.** In the PDF Editor's Bates tab, set a prefix, the first number and how many digits to pad to, choose where the number goes, and see it on the first and last pages before you commit. The numbered copy is saved beside the original, named with its number range, and Magna Carta tells you where the next production should start.
