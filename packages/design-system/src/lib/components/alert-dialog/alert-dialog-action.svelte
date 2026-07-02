<script lang="ts">
  /* AlertDialog.Action — the confirm action; closes the dialog. Thin pass-through over Bits UI
     AlertDialog.Action with NO built-in look or positioning, so the caller styles and places it
     (typically an mc-button variant — destructive for a destructive confirmation) without a default
     recipe fighting their chosen variant or yanking it out of the footer. */
  import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<AlertDialogPrimitive.ActionProps> = $props();
</script>

<AlertDialogPrimitive.Action bind:ref class={mergeClasses(className)} {...restProps} />
