<script lang="ts">
  /*
   * DropdownMenu.SubTrigger — the row that opens a nested submenu. Behaviour + a11y (highlight on
   * hover/keyboard, aria-haspopup, arrow-right to open) come from Bits; the look is the
   * mc-dropdown-menu-item recipe (same row as a plain Item). The wrapper renders a trailing
   * ChevronRight (Lucide, deep-imported) to signal the submenu. The caller passes the label as
   * children.
   */
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { Snippet } from "svelte";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithoutChild<DropdownMenuPrimitive.SubTriggerProps> & { children?: Snippet } = $props();
</script>

<DropdownMenuPrimitive.SubTrigger
  bind:ref
  class={mergeClasses("mc-dropdown-menu-item", className)}
  {...restProps}
>
  {@render children?.()}
  <ChevronRight class="mc-dropdown-menu-sub-trigger-icon" aria-hidden="true" />
</DropdownMenuPrimitive.SubTrigger>
