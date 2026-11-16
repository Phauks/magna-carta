---
category: Changed
audience: public
---

**Every field states whether it is needed; one setting decides the mark.** `Label`, `LabelledField`, `DatePicker` and `DateTimeField` take `necessity` (`"required"` or `"optional"`), read from the record's own rules: required where the commit refuses an empty value, optional where a blank becomes null. How that shows is the single constant `NECESSITY_MARKING` in `packages/design-system/src/lib/components/label/necessity.ts`: `"mark-optional"` (the default) writes "Optional" after an optional label; `"mark-required"` puts a star after a required one instead. A required field also sets `aria-required`. 381 fields across the app were marked, and the hint lines that only said "Optional" were trimmed.

## Public

**Optional fields are marked the same way everywhere.** A field you can leave empty now shows a light "Optional" after its name, in every window, instead of "(optional)" written different ways in different places.
