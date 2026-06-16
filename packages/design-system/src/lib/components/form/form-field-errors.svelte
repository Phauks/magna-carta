<script lang="ts">
  /* Form.FieldErrors — renders the field's validation errors and wires their aria association (the
     control points at them via aria-describedby when invalid). formsnap supplies the messages; the
     mc-form-errors recipe styles them. */
  import { FieldErrors as FormsnapFieldErrors } from "formsnap";
  import type { ComponentProps } from "svelte";
  import { mergeClasses } from "../../internal/merge-classes.ts";

  let { class: className, ...restProps }: ComponentProps<typeof FormsnapFieldErrors> = $props();
</script>

<FormsnapFieldErrors class={mergeClasses("mc-form-errors", className)} {...restProps} />
