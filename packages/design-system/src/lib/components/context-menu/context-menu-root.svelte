<script lang="ts">
  /* ContextMenu.Root — owns the open state and pairs the Trigger (the right-click region) with its
     Content; renders no DOM of its own. Thin wrapper over Bits UI ContextMenu.Root. `open` is
     bindable. */
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";

  let { ...restProps }: ContextMenuPrimitive.RootProps = $props();
</script>

<ContextMenuPrimitive.Root {...restProps} />
