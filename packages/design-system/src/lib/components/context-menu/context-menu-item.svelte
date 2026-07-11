<script lang="ts">
  /* ContextMenu.Item — one actionable row. Behaviour + a11y (role="menuitem", keyboard highlight,
     typeahead, `onSelect`, `closeOnSelect`, `disabled`) come from Bits; the look is the
     mc-context-menu-item recipe keyed off `data-highlighted` (hover/keyboard) and `data-disabled`.
     Thin wrapper over Bits UI ContextMenu.Item. */
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<ContextMenuPrimitive.ItemProps> = $props();
</script>

<ContextMenuPrimitive.Item
  bind:ref
  class={mergeClasses("mc-context-menu-item", className)}
  {...restProps}
/>
