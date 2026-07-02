<script lang="ts">
  /* Command.Viewport — the inner content element of the List. Bits points the search Input's
     `aria-controls` at this node, so it must be present for the combobox to be correctly described.
     No recipe of its own (the List owns scroll + padding). Thin pass-through over Bits UI
     Command.Viewport. */
  import { Command as CommandPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<CommandPrimitive.ViewportProps> = $props();
</script>

<CommandPrimitive.Viewport bind:ref class={mergeClasses(className)} {...restProps} />
