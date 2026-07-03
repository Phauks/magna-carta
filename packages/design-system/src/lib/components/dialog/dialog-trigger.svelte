<script lang="ts">
  /* Dialog.Trigger — the button that opens the dialog. Thin pass-through over Bits UI
     Dialog.Trigger with NO built-in look, so the caller styles it (typically an mc-button variant)
     without a default recipe fighting their chosen background/border. Unlike a tooltip's quiet
     trigger, a dialog is opened by a deliberate button. */
  import { Dialog as DialogPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<DialogPrimitive.TriggerProps> = $props();
</script>

<DialogPrimitive.Trigger bind:ref class={mergeClasses(className)} {...restProps} />
