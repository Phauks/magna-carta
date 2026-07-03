<script lang="ts">
  /* DropdownMenu.GroupHeading — the small label that titles a Group (wired to it for assistive tech
     by Bits). The look is the mc-dropdown-menu-group-heading recipe (a muted caption). Thin wrapper
     over Bits UI DropdownMenu.GroupHeading. */
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<DropdownMenuPrimitive.GroupHeadingProps> = $props();
</script>

<DropdownMenuPrimitive.GroupHeading
  bind:ref
  class={mergeClasses("mc-dropdown-menu-group-heading", className)}
  {...restProps}
/>
