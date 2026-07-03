<script lang="ts">
  /* DropdownMenu.Root — owns the open state and pairs the Trigger with its Content; renders no DOM
     of its own. Thin wrapper over Bits UI DropdownMenu.Root. `open` is declared bindable and
     FORWARDED — a spread alone does not forward a two-way bind in Svelte 5, so a controlled menu
     would silently fail without the `$bindable`. */
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";

  let { open = $bindable(false), ...restProps }: DropdownMenuPrimitive.RootProps = $props();
</script>

<DropdownMenuPrimitive.Root bind:open {...restProps} />
