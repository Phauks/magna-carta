<script lang="ts">
  /* ContextMenu.RadioGroup — a single-select grouping of RadioItems; `value` is bindable and names
     the currently-selected item. Renders no look of its own. Thin pass-through over Bits UI
     ContextMenu.RadioGroup. */
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    value = $bindable(""),
    class: className,
    ...restProps
  }: WithoutChild<ContextMenuPrimitive.RadioGroupProps> = $props();
</script>

<ContextMenuPrimitive.RadioGroup
  bind:ref
  bind:value
  class={mergeClasses(className)}
  {...restProps}
/>
