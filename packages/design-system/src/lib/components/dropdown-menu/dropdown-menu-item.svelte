<script lang="ts">
  /* DropdownMenu.Item — one actionable row. Behaviour + a11y (role="menuitem", keyboard highlight,
     typeahead, `onSelect`, `closeOnSelect`, `disabled`) come from Bits; the look is the
     mc-dropdown-menu-item recipe keyed off `data-highlighted` (hover/keyboard) and `data-disabled`.
     Thin wrapper over Bits UI DropdownMenu.Item. */
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<DropdownMenuPrimitive.ItemProps> = $props();
</script>

<DropdownMenuPrimitive.Item
  bind:ref
  class={mergeClasses("mc-dropdown-menu-item", className)}
  {...restProps}
/>
