<script lang="ts">
  /* AlertDialog.Description — the panel's supporting line; Bits wires it as the alert dialog's
     aria-describedby target. Thin wrapper over Bits UI AlertDialog.Description; the look is the
     mc-alert-dialog-description recipe. */
  import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<AlertDialogPrimitive.DescriptionProps> = $props();
</script>

<AlertDialogPrimitive.Description
  bind:ref
  class={mergeClasses("mc-alert-dialog-description", className)}
  {...restProps}
/>
