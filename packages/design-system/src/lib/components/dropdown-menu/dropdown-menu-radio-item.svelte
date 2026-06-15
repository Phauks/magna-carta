<script lang="ts">
  /*
   * DropdownMenu.RadioItem — one option in a RadioGroup. Behaviour + a11y (role="menuitemradio",
   * aria-checked, keyboard) come from Bits. The wrapper renders a leading indicator box that, when
   * selected, shows a filled Lucide dot (Circle, deep-imported) — mirroring the CheckboxItem idiom.
   * The row styling is the mc-dropdown-menu-item recipe; the indicator box is
   * mc-dropdown-menu-item-indicator. The caller passes the label as children; `value` is required.
   */
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import Circle from "@lucide/svelte/icons/circle";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { Snippet } from "svelte";
  import type { WithoutChildrenOrChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    // A radio is a stateful toggle (you may re-sort several times), so selecting one keeps the menu
    // open instead of Bits' default of closing on select; a caller can still pass closeOnSelect={true}.
    closeOnSelect = false,
    class: className,
    children: label,
    ...restProps
  }: WithoutChildrenOrChild<DropdownMenuPrimitive.RadioItemProps> & { children?: Snippet } =
    $props();
</script>

<DropdownMenuPrimitive.RadioItem
  bind:ref
  {closeOnSelect}
  class={mergeClasses("mc-dropdown-menu-item", className)}
  {...restProps}
>
  {#snippet children({ checked: isChecked })}
    <span class="mc-dropdown-menu-item-indicator">
      {#if isChecked}
        <Circle class="mc-dropdown-menu-item-indicator-dot" aria-hidden="true" />
      {/if}
    </span>
    {@render label?.()}
  {/snippet}
</DropdownMenuPrimitive.RadioItem>
