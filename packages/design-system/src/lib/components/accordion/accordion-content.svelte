<script lang="ts">
  /* Accordion.Content — the section panel (shown when its item is open). Thin wrapper over Bits UI
     Accordion.Content. */
  import { Accordion as AccordionPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<AccordionPrimitive.ContentProps> = $props();
</script>

<AccordionPrimitive.Content
  bind:ref
  class={mergeClasses("mc-accordion-content", className)}
  {...restProps}
/>
