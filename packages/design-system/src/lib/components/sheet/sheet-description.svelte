<script lang="ts">
  /* Sheet.Description — the panel's supporting line; Bits wires it as the dialog's
     aria-describedby target. Thin wrapper over Bits UI Dialog.Description; the look is the
     mc-sheet-description recipe. */
  import { Dialog as DialogPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<DialogPrimitive.DescriptionProps> = $props();
</script>

<DialogPrimitive.Description
  bind:ref
  class={mergeClasses("mc-sheet-description", className)}
  {...restProps}
/>
