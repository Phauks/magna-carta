<script lang="ts">
  /* Sheet.Title — the panel heading; Bits wires it as the dialog's aria-labelledby target. Thin
     wrapper over Bits UI Dialog.Title (`level` sets the heading level, default 3); the look is the
     mc-sheet-title recipe. */
  import { Dialog as DialogPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<DialogPrimitive.TitleProps> = $props();
</script>

<DialogPrimitive.Title bind:ref class={mergeClasses("mc-sheet-title", className)} {...restProps} />
