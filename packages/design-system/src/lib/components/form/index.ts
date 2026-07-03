/*
 * Form is the field family over formsnap (+ superforms). Field / Control / Fieldset / Legend /
 * ElementField are pure logic (they wire name/id/aria/aria-describedby/aria-invalid and carry the
 * generic SuperForm typing), so they are re-exported from formsnap unchanged; Label / FieldErrors /
 * Description are our styled wrappers. Bare names plus Form-prefixed aliases, so both idioms work —
 * `import * as Form from ".../form"` then <Form.Field>, or `import { Form, FormControl }`. Field is
 * re-exported as `Form`. The field's vertical spacing is the mc-form-field recipe (a wrapper class).
 */
import { Field, Control, Fieldset, Legend, ElementField } from "formsnap";
import Label from "./form-label.svelte";
import FieldErrors from "./form-field-errors.svelte";
import Description from "./form-description.svelte";

export {
  Field,
  Control,
  Fieldset,
  Legend,
  ElementField,
  Label,
  FieldErrors,
  Description,
  //
  Field as Form,
  Field as FormField,
  Control as FormControl,
  Fieldset as FormFieldset,
  Legend as FormLegend,
  ElementField as FormElementField,
  Label as FormLabel,
  FieldErrors as FormFieldErrors,
  Description as FormDescription,
};
