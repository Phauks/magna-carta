<script lang="ts">
  /* Sheet.Close — a close affordance the CALLER styles and places (e.g. a "Cancel" button in the
     footer). Thin pass-through over Bits UI Dialog.Close with NO built-in look or positioning, so
     it sits wherever the caller puts it and takes whatever classes the caller gives it (typically
     the mc-button recipes). Distinct from Content's built-in corner dismiss ✕, which owns the
     mc-sheet-close recipe directly in sheet-content.svelte. */
  import { Dialog as DialogPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<DialogPrimitive.CloseProps> = $props();
</script>

<DialogPrimitive.Close bind:ref class={mergeClasses(className)} {...restProps} />
