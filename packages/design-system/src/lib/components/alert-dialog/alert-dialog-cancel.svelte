<script lang="ts">
  /* AlertDialog.Cancel — the dismiss action; closes the dialog and, by Bits' default, is where focus
     lands when the panel opens. Thin pass-through over Bits UI AlertDialog.Cancel with NO built-in
     look or positioning, so the caller styles and places it (typically an mc-button variant) without
     a default recipe fighting their chosen variant or yanking it out of the footer. */
  import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<AlertDialogPrimitive.CancelProps> = $props();
</script>

<AlertDialogPrimitive.Cancel bind:ref class={mergeClasses(className)} {...restProps} />
