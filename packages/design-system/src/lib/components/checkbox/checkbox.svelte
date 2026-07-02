<script lang="ts">
  /*
   * Checkbox (Tier 2) — a styled checkbox over Bits UI Checkbox.Root. Self-contained: the wrapper
   * renders the box and, by state, the Check mark (or a Minus for indeterminate) via Lucide icons.
   * Behaviour + a11y (role="checkbox", aria-checked, keyboard) come from Bits; the look is the
   * mc-checkbox recipe keyed off `data-state`. `checked`/`indeterminate` are bindable.
   */
  import { Checkbox as CheckboxPrimitive } from "bits-ui";
  import Check from "@lucide/svelte/icons/check";
  import Minus from "@lucide/svelte/icons/minus";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChildrenOrChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    checked = $bindable(false),
    indeterminate = $bindable(false),
    class: className,
    ...restProps
  }: WithoutChildrenOrChild<CheckboxPrimitive.RootProps> = $props();
</script>

<CheckboxPrimitive.Root
  bind:ref
  bind:checked
  bind:indeterminate
  class={mergeClasses("mc-checkbox", className)}
  {...restProps}
>
  {#snippet children({ checked: isChecked, indeterminate: isIndeterminate })}
    {#if isIndeterminate}
      <Minus class="mc-checkbox-icon" />
    {:else if isChecked}
      <Check class="mc-checkbox-icon" />
    {/if}
  {/snippet}
</CheckboxPrimitive.Root>
