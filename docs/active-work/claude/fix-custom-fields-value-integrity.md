# claude/fix-custom-fields-value-integrity

**Branch:** `claude/fix-custom-fields-value-integrity` · **Off:** main (06f14fa) · **Owner:** Trevor Goldsmith · **Started:** 2026-08-04

## Scope

Two money-integrity defects in the typed extra-attributes engine, plus the adjacent value-write
hardening they open up. No new feature surface, no OpenAPI contract change.

1. **Convert now re-expresses numeric values at the target kind's scale.** A kind change between
   scale-bearing kinds (number ↔ currency, checkbox/text/picklist → currency, currency → text) moved
   the stored integer across unchanged, so a plain number field holding 500 read as $5.00 after being
   retyped to currency while every later write stored $500 as 50000 — one field permanently mixing two
   scales. The classifier now takes both minor-unit exponents, shifts decimals exactly (no float
   multiply), and parks a value that cannot be re-expressed exactly. Preview and apply run the same
   classification, so the counts an admin approves are the ones that commit.
2. **A value write now loads the field's definition and enforces it.** `setCustomFieldValue` composed
   its statements without ever reading the field, so a value stored against a nonexistent field, a
   value whose shape disagreed with the field's kind, a fractional `value_number`, an archived field,
   and a picklist option belonging to another field all succeeded. Each is now a named refusal.

## Files I expect to touch

- `packages/custom-fields/src/number-scale.ts` (new — the scale arithmetic), `coercion.ts`,
  `convert.ts`, `custom-field-value-service.ts`, `custom-field-service.ts`, `limits.ts`, `types.ts`,
  `package.json`
- `packages/custom-fields/CLAUDE.md`
- `apps/worker/src/routes/custom-fields.ts` (the boundary scaling now reuses the package's scale rule;
  the error-code comment gains the new codes — no schema change)
- tests: `packages/custom-fields/test/{number-scale,coercion,convert,custom-field-value-service}.test.ts`
- `changelog.d/fix-custom-fields-value-integrity.md`

## Coordination

No overlap with any other registered stream. `apps/worker/src/routes/custom-fields.ts` is touched only
inside the custom-fields helpers; the request/response schemas, the OpenAPI snapshot, and the generated
client are all untouched.
