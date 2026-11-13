# The maturity family and the field primitives — CLAUDE.md

The maturity vocabulary, `LabelledField` and `FieldRow`. The package-wide rules are in [`../../../../CLAUDE.md`](../../../../CLAUDE.md).

## The maturity family, and the field primitives

- **`src/lib/components/maturity/` is the one home of the maturity vocabulary** — the stage model
  (`maturity.ts`: `MaturityStage`, `MATURITY_PRESENTATION`, `hasSurface`), `MaturityBadge`,
  `MaturityDot`, and `SoonAffordance` with its wording (`soon-affordance.ts`). It moved here from
  `apps/web/src/lib/maturity/` on 2026-09-02 because the ActionDialog shell renders the "soon" stage
  on a commit and a shell cannot import the app. The app imports `@magna-carta/design-system/maturity`
  and keeps only its registries' `stage` fields. `SoonAffordance` is in `lint:one-ui`'s
  one-implementation registry: a second composition of "disabled + badge + dependency" anywhere is
  the defect it exists to prevent. Only `soon` wears a mark (owner ruling in
  `docs/conventions/design-corrections.md`).
- **`LabelledField` is the label-over-control stack for a panel's own fields; `Form.Field` is for a
  superforms-validated form.** They are not interchangeable and one is not a shortcut for the other.
  `LabelledField` mints the control's id (`$props.id()`) unless given one, joins the hint and the
  error into `aria-describedby`, sets `aria-invalid` on an error, and hands the control its
  attributes as `children({ props })` to spread — formsnap's own idiom. Its recipe gap is space-8
  (the panels'); `mc-form-field` is space-4. That difference is deliberate and stated on the recipe;
  do not quietly align one to the other — it is the owner's to settle. The hint and error reuse
  `mc-form-description` / `mc-form-errors`, so the satellites are one recipe across both.
  **An error is never printed under the field** (owner ruling 2026-11-13: "if there are ever errors
  in a field, no text, but you can highlight them in red"): `LabelledField` renders it `sr-only`, so
  it stays the control's accessible description, and hands it to the control as `title`; the control
  turns red through `aria-invalid` (`input.css`, and `combobox.css` through `:has()`). A line
  appearing under one field of a row had pushed that field out of line with its neighbours. A HINT
  still prints.
- **`FieldRow` is utilities, not a recipe** (`grid gap-12 sm:grid-cols-2|3`), because a breakpoint
  cannot be expressed with a custom property inside a media query. Its class strings are literal in
  `field-row/variants.ts` for Tailwind's scanner.
