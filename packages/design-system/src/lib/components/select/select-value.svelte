<script lang="ts">
  /* Select.Value — the selected item's label inside the Trigger, falling back to `placeholder` when
     nothing is selected (Bits renders the label automatically; a child snippet can override). Thin
     pass-through over Bits UI Select.Value; `placeholder` is forwarded explicitly so the consumer
     gets it as a typed prop. No recipe of its own — it inherits the Trigger's text styling. */
  import { Select as SelectPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    placeholder,
    ...restProps
  }: WithoutChild<SelectPrimitive.ValueProps> & { placeholder?: string } = $props();
</script>

<SelectPrimitive.Value
  bind:ref
  {placeholder}
  class={mergeClasses("mc-select-value", className)}
  {...restProps}
/>
