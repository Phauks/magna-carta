<script lang="ts">
  /* Accordion.Trigger — the section header button. Bundles Bits UI Accordion.Header + Trigger and
     appends a chevron that rotates on open (a Tailwind group-data variant — the angle is a utility,
     not an off-token literal in the recipe). Renders the caller's label as the children.

     `chevron="start"` leads the row with the chevron instead, pointing at the label while closed
     and turning down when open — the disclosure shape of a list a reader collapses by section,
     where the mark belongs beside the heading it opens rather than at the far edge of the row. */
  import { Accordion as AccordionPrimitive } from "bits-ui";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { mergeClasses } from "../../internal/merge-classes.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    chevron = "end",
    ...restProps
  }: AccordionPrimitive.TriggerProps & { chevron?: "start" | "end" } = $props();
</script>

<AccordionPrimitive.Header class="mc-accordion-header">
  <AccordionPrimitive.Trigger
    bind:ref
    class={mergeClasses(
      "mc-accordion-trigger group w-full",
      chevron === "start" ? "justify-start" : "",
      className,
    )}
    {...restProps}
  >
    {#if chevron === "start"}
      <ChevronDown
        class="mc-accordion-chevron -rotate-90 group-data-[state=open]:rotate-0"
        aria-hidden="true"
      />
      {@render children?.()}
    {:else}
      {@render children?.()}
      <ChevronDown
        class="mc-accordion-chevron group-data-[state=open]:rotate-180"
        aria-hidden="true"
      />
    {/if}
  </AccordionPrimitive.Trigger>
</AccordionPrimitive.Header>
