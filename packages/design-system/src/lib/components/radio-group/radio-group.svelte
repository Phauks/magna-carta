<script lang="ts">
  /*
   * RadioGroup.Root (Tier 2) — a styled radio group over Bits UI RadioGroup.Root. Compose with
   * RadioGroup.Item per option. Behaviour + a11y (role="radiogroup", roving focus, arrow keys)
   * come from Bits; `value` is bindable.
   */
  import { RadioGroup as RadioGroupPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    value = $bindable(""),
    class: className,
    ...restProps
  }: WithoutChild<RadioGroupPrimitive.RootProps> = $props();
</script>

<RadioGroupPrimitive.Root
  bind:ref
  bind:value
  class={mergeClasses("mc-radio-group", className)}
  {...restProps}
/>
