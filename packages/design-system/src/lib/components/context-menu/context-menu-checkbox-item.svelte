<script lang="ts">
  /*
   * ContextMenu.CheckboxItem — a toggleable row. Behaviour + a11y (role="menuitemcheckbox",
   * aria-checked, keyboard) come from Bits; `checked` is bindable. The wrapper renders a leading
   * indicator box that, when checked, shows the Lucide Check (deep-imported) — the same idiom as the
   * DropdownMenu.CheckboxItem. The row styling is the mc-context-menu-item recipe (highlight/disabled),
   * and the indicator box is mc-context-menu-item-indicator. The caller passes the label as children.
   */
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
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
  }: WithoutChildrenOrChild<ContextMenuPrimitive.CheckboxItemProps> & { children?: Snippet } =
    $props();
</script>

<ContextMenuPrimitive.CheckboxItem
  bind:ref
  bind:checked
  {closeOnSelect}
  class={mergeClasses("mc-context-menu-item", className)}
  {...restProps}
>
  {#snippet children({ checked: isChecked })}
    <span class="mc-context-menu-item-indicator">
      {#if isChecked}
        <Check class="mc-context-menu-item-indicator-icon" aria-hidden="true" />
      {/if}
    </span>
    {@render label?.()}
  {/snippet}
</ContextMenuPrimitive.CheckboxItem>
