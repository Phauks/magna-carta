<script lang="ts">
  /* DropdownMenu.Sub — owns the open state of a nested submenu and pairs its SubTrigger with the
     SubContent; renders no DOM of its own. Thin pass-through over Bits UI DropdownMenu.Sub. */
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";

  let { ...restProps }: DropdownMenuPrimitive.SubProps = $props();
</script>

<DropdownMenuPrimitive.Sub {...restProps} />
