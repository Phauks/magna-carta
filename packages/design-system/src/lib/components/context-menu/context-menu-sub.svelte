<script lang="ts">
  /* ContextMenu.Sub — owns the open state of a nested submenu and pairs its SubTrigger with the
     SubContent; renders no DOM of its own. Thin pass-through over Bits UI ContextMenu.Sub. */
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";

  let { ...restProps }: ContextMenuPrimitive.SubProps = $props();
</script>

<ContextMenuPrimitive.Sub {...restProps} />
