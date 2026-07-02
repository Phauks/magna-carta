<script lang="ts">
  /*
   * DropdownMenu.CheckboxItem — a toggleable row. Behaviour + a11y (role="menuitemcheckbox",
   * aria-checked, keyboard) come from Bits; `checked` is bindable. The wrapper renders a leading
   * indicator box that, when checked, shows the Lucide Check (deep-imported) — the same idiom as the
   * Checkbox wrapper. The row styling is the mc-dropdown-menu-item recipe (highlight/disabled), and
   * the indicator box is mc-dropdown-menu-item-indicator. The caller passes the label as children.
   */
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import Check from "@lucide/svelte/icons/check";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { Snippet } from "svelte";
  import type { WithoutChildrenOrChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    checked = $bindable(false),
    // A checkbox is a stateful toggle (you may flip several at once), so toggling one keeps the menu
    // open instead of Bits' default of closing on select; a caller can still pass closeOnSelect={true}.
    closeOnSelect = false,
    class: className,
    children: label,
    ...restProps
  }: WithoutChildrenOrChild<DropdownMenuPrimitive.CheckboxItemProps> & { children?: Snippet } =
    $props();
</script>

<DropdownMenuPrimitive.CheckboxItem
  bind:ref
  bind:checked
  {closeOnSelect}
  class={mergeClasses("mc-dropdown-menu-item", className)}
  {...restProps}
>
  {#snippet children({ checked: isChecked })}
    <span class="mc-dropdown-menu-item-indicator">
      {#if isChecked}
        <Check class="mc-dropdown-menu-item-indicator-icon" aria-hidden="true" />
      {/if}
    </span>
    {@render label?.()}
  {/snippet}
</DropdownMenuPrimitive.CheckboxItem>
