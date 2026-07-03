<script lang="ts">
  /* Accordion.Trigger — the section header button. Bundles Bits UI Accordion.Header + Trigger and
     appends a chevron that rotates on open (a Tailwind group-data variant — the angle is a utility,
     not an off-token literal in the recipe). Renders the caller's label as the children. */
  import { Accordion as AccordionPrimitive } from "bits-ui";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { mergeClasses } from "../../internal/merge-classes.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: AccordionPrimitive.TriggerProps = $props();
</script>

<AccordionPrimitive.Header class="mc-accordion-header">
  <AccordionPrimitive.Trigger
    bind:ref
    class={mergeClasses("mc-accordion-trigger group w-full", className)}
    {...restProps}
  >
    {@render children?.()}
    <ChevronDown
      class="mc-accordion-chevron group-data-[state=open]:rotate-180"
      aria-hidden="true"
    />
  </AccordionPrimitive.Trigger>
</AccordionPrimitive.Header>
