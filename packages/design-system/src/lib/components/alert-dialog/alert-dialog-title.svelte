<script lang="ts">
  /* AlertDialog.Title — the panel heading; Bits wires it as the alert dialog's aria-labelledby
     target. Thin wrapper over Bits UI AlertDialog.Title (`level` sets the heading level, default 3);
     the look is the mc-alert-dialog-title recipe. */
  import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<AlertDialogPrimitive.TitleProps> = $props();
</script>

<AlertDialogPrimitive.Title
  bind:ref
  class={mergeClasses("mc-alert-dialog-title", className)}
  {...restProps}
/>
