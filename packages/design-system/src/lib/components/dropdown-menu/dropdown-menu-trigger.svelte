<script lang="ts">
  /* DropdownMenu.Trigger — the button that opens the menu. Thin pass-through over Bits UI
     DropdownMenu.Trigger with NO built-in look, so the caller styles it (typically an mc-button
     variant) without a default recipe fighting their chosen background/border. Like a popover, a
     dropdown menu is opened by a deliberate button. */
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<DropdownMenuPrimitive.TriggerProps> = $props();
</script>

<DropdownMenuPrimitive.Trigger bind:ref class={mergeClasses(className)} {...restProps} />
