<script lang="ts">
  /* DropdownMenu.Separator — a hairline rule between groups of items (role="separator"). The look is
     the mc-dropdown-menu-separator recipe. Thin wrapper over Bits UI DropdownMenu.Separator. */
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<DropdownMenuPrimitive.SeparatorProps> = $props();
</script>

<DropdownMenuPrimitive.Separator
  bind:ref
  class={mergeClasses("mc-dropdown-menu-separator", className)}
  {...restProps}
/>
