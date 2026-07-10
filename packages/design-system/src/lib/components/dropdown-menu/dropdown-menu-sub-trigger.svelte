<script lang="ts">
  /*
   * DropdownMenu.SubTrigger — the row that opens a nested submenu. Behaviour + a11y (highlight on
   * hover/keyboard, aria-haspopup, arrow-right to open) come from Bits; the look is the
   * mc-dropdown-menu-item recipe (same row as a plain Item). The caller passes the label as
   * children.
   *
   * `submenuSide` keeps the pointer honest: the default trailing ChevronRight is right only when
   * the submenu opens to the right. A menu hugging the viewport's right edge must open its
   * submenu LEFT (pass side="left" on the SubContent), and then the trigger renders a LEADING
   * ChevronLeft at the label's start edge instead — the arrow and the motion agree (owner review
   * 2026-07-02). The caller sets both, since only it knows where the menu lives.
   */
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { Snippet } from "svelte";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    submenuSide = "right",
    ...restProps
  }: WithoutChild<DropdownMenuPrimitive.SubTriggerProps> & {
    children?: Snippet;
    /** Which side the paired SubContent opens on; drives the chevron's direction and edge. */
    submenuSide?: "right" | "left";
  } = $props();
</script>

<DropdownMenuPrimitive.SubTrigger
  bind:ref
  class={mergeClasses("mc-dropdown-menu-item", className)}
  {...restProps}
>
  {#if submenuSide === "left"}
    <ChevronLeft
      class="mc-dropdown-menu-sub-trigger-icon mc-dropdown-menu-sub-trigger-icon-start"
      aria-hidden="true"
    />
  {/if}
  {@render children?.()}
  {#if submenuSide === "right"}
    <ChevronRight class="mc-dropdown-menu-sub-trigger-icon" aria-hidden="true" />
  {/if}
</DropdownMenuPrimitive.SubTrigger>
