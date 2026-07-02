<script lang="ts">
  /* Accordion.Item — one section (its `value` identifies it). Thin wrapper over Bits UI
     Accordion.Item; the hairline divider between sections is the mc-accordion-item recipe. */
  import { Accordion as AccordionPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<AccordionPrimitive.ItemProps> = $props();
</script>

<AccordionPrimitive.Item bind:ref class={mergeClasses("mc-accordion-item", className)} {...restProps} />
