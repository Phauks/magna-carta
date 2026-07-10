<script lang="ts">
  /* ContextMenu.Trigger — the region that opens the menu on right-click (or the context-menu key).
     Unlike a dropdown's button trigger, this is the area the menu is summoned OVER; Bits anchors the
     floating menu to the pointer position. Thin pass-through with NO built-in look, so the caller
     styles the region (a table row, a file card) without a default recipe fighting it. */
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<ContextMenuPrimitive.TriggerProps> = $props();
</script>

<ContextMenuPrimitive.Trigger bind:ref class={mergeClasses(className)} {...restProps} />
