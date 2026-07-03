<script lang="ts">
  /*
   * Select.Item — one selectable option. Behaviour + a11y (role="option", aria-selected, keyboard
   * highlight, typeahead match, disabled) come from Bits; the look is the mc-select-item recipe keyed
   * off `data-highlighted` (hover/keyboard) and `data-disabled`. The wrapper renders a leading
   * indicator box that shows the Lucide Check (deep-imported) when the item is selected — the same
   * idiom as the Checkbox / DropdownMenu.CheckboxItem.
   *
   * `value` is the required form value; `label` is the string Bits displays in the trigger's Value
   * and matches for typeahead. The two differ by design, so the row text comes from `label` by
   * default — a plain option is `<Select.Item value="…" label="…" />`, one source feeding the row,
   * the trigger, and typeahead. Pass children only for a richer row (an icon, secondary text); then
   * keep `label` so the trigger and typeahead still read the option correctly.
   */
  import { Select as SelectPrimitive } from "bits-ui";
  import Check from "@lucide/svelte/icons/check";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { Snippet } from "svelte";
  import type { WithoutChildrenOrChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    label,
    children: rowContent,
    ...restProps
  }: WithoutChildrenOrChild<SelectPrimitive.ItemProps> & { children?: Snippet } = $props();
</script>

<SelectPrimitive.Item
  bind:ref
  {label}
  class={mergeClasses("mc-select-item", className)}
  {...restProps}
>
  {#snippet children({ selected })}
    <span class="mc-select-item-indicator">
      {#if selected}
        <Check class="mc-select-item-indicator-icon" aria-hidden="true" />
      {/if}
    </span>
    {#if rowContent}{@render rowContent()}{:else}{label}{/if}
  {/snippet}
</SelectPrimitive.Item>
