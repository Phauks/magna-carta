<script lang="ts">
  /* DropdownMenu.RadioGroup — a single-select grouping of RadioItems; `value` is bindable and names
     the currently-selected item. Renders no look of its own. Thin pass-through over Bits UI
     DropdownMenu.RadioGroup. */
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    value = $bindable(""),
    class: className,
    ...restProps
  }: WithoutChild<DropdownMenuPrimitive.RadioGroupProps> = $props();
</script>

<DropdownMenuPrimitive.RadioGroup
  bind:ref
  bind:value
  class={mergeClasses(className)}
  {...restProps}
/>
