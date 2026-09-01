<script lang="ts">
  /* ContextMenu.Trigger — the region that opens the menu on right-click (or the context-menu key).
     Unlike a dropdown's button trigger, this is the area the menu is summoned OVER; Bits anchors the
     floating menu to the pointer position. Thin pass-through with NO built-in look, so the caller
     styles the region (a table row, a file card) without a default recipe fighting it.

     Bits' `child` render delegation stays OPEN here, where most wrappers strip it: a trigger region
     is sometimes an element this wrapper cannot render for the caller — a table's `<th>`, which the
     HTML parser lets nothing wrap — so the caller renders the element and spreads the props it is
     handed. The delegated props carry Bits' handlers, its ref attachment and its inline style, so
     anything of the caller's that COLLIDES with those (a `style`) is passed to this component and
     merged; everything else goes straight on the caller's element. */
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: ContextMenuPrimitive.TriggerProps = $props();
</script>

<ContextMenuPrimitive.Trigger bind:ref class={mergeClasses(className)} {...restProps} />
