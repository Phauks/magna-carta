<script lang="ts">
  /* AlertDialog.Trigger — the button that opens the alert dialog. Thin pass-through over Bits UI
     AlertDialog.Trigger with NO built-in look, so the caller styles it (typically an mc-button
     variant) without a default recipe fighting their chosen background/border. */
  import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<AlertDialogPrimitive.TriggerProps> = $props();
</script>

<AlertDialogPrimitive.Trigger bind:ref class={mergeClasses(className)} {...restProps} />
