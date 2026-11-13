<script lang="ts">
  /*
   * Select.Item — one selectable option. Behaviour + a11y (role="option", aria-selected, keyboard
   * highlight, typeahead match, disabled) come from Bits; the look is the mc-select-item recipe keyed
   * off `data-highlighted` (hover/keyboard), `data-selected` and `data-disabled`.
   *
   * The tick for the chosen row sits at the row's END, not its start. A leading tick box indented
   * every option by a gutter that only one row ever filled, so the options never lined up with the
   * field's own text above them; at the end the text starts where the field's text starts, and the
   * one chosen row carries its mark where the eye finishes reading it. The trailing box is always
   * there, empty on every other row, so a long label wraps the same whether or not it is chosen.
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
    <span class="mc-select-item-text">
      {#if rowContent}{@render rowContent()}{:else}{label}{/if}
    </span>
    <span class="mc-select-item-indicator">
      {#if selected}
        <Check class="mc-select-item-indicator-icon" aria-hidden="true" />
      {/if}
    </span>
  {/snippet}
</SelectPrimitive.Item>
