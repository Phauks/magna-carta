---
category: Fixed
---

- **Retyping a custom field no longer shifts its amounts by a factor of a hundred.** Convert moved each
  stored integer to the new kind untouched, but what that integer means depends on the kind: a plain
  number field counts whole units while a currency field counts minor units. A number field holding
  `500` therefore read as **$5.00** the moment it was retyped to currency, while every later write of
  $500 stored `50000` — one field permanently holding two different scales, with no error anywhere.
  Convert now re-expresses every numeric value at the target kind's scale, moving the decimal point
  exactly rather than multiplying (no rounding, no floating-point remainder), and **parks** any value
  that cannot be re-expressed exactly — $500.50 retyped to a whole-unit number field is held aside for
  review instead of being quietly rounded, with its original preserved in history as always. The same
  rule now covers every scale-crossing pair: a checkbox or typed text converted to currency reads as the
  amount a person wrote (`"1,234.56"` becomes $1,234.56, not $12.34), and a currency field converted to
  text renders `"500.00"` rather than `"50000"`, so converting back restores the original amount. The
  preview runs the identical classification, so the clean/parked counts an administrator approves are
  exactly what applying commits.

- **A custom-field value is now checked against the field's definition before it is stored.** The value
  write composed its statements without ever reading the field it was writing to, so the "typed" field
  engine accepted values it had no type agreement with: a value stored against a field that does not
  exist (an orphan row, answered `200`), a text value on a currency field, a fractional number in a
  column that must hold whole minor units, a value written to an archived field, and a picklist choice
  that belonged to a different field or had been archived — the last of which stored a value that
  rendered blank and was destroyed the moment a later conversion read it. Each is now refused before
  anything is written, with its own reason: an unknown field is a `404`, and a kind disagreement, a
  fractional amount, an archived field, a foreign or archived picklist option, and an over-long text
  value are each a `422` naming what was wrong. A per-value text ceiling and a bound on a field's
  declared number scale keep a single record from pushing hundreds of kilobytes into a row, and keep a
  wild scale from turning every write into a rounded or infinite number.

- **Two adjacent custom-field refusals that used to surface as server errors or silent overload.**
  Previewing or applying a conversion on a reference field (or to one) raised an untyped error that
  reached the client as a `500` for an ordinary administrative action, and a reference field holding no
  values "converted" successfully into a kind that cannot hold references; both directions are now a
  clear refusal that does not depend on how many values the field holds. Retyping a field whose value
  count exceeds what one atomic pass can carry is likewise refused with the count and the ceiling, rather
  than being attempted as a single enormous commit — the background pass for larger fields is still to
  come. The confirmed-rule coercion path ("500k" → 500000) now also produces a whole number at the
  target field's scale, or refuses, instead of a fractional amount.
