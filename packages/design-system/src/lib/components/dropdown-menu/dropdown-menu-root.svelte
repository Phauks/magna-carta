<script lang="ts">
  /* DropdownMenu.Root — owns the open state and pairs the Trigger with its Content; renders no DOM
     of its own. Thin wrapper over Bits UI DropdownMenu.Root. `open` is bindable. */
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";

  let { ...restProps }: DropdownMenuPrimitive.RootProps = $props();
</script>

<DropdownMenuPrimitive.Root {...restProps} />
