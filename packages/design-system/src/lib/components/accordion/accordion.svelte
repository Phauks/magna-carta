<script lang="ts">
  /*
   * Accordion.Root (Tier 2) — over Bits UI Accordion.Root. `type` is "single" or "multiple";
   * behaviour, a11y, and keyboard come from Bits. Compose with Accordion.Item/Trigger/Content.
   *
   * NOTE: the expand/collapse HEIGHT animation is deferred. It needs Bits' runtime
   * `--bits-accordion-content-height` var, which the purity-gated components.css cannot reference
   * (var(--mc-…)/keywords only, no escape), so it's a JS-driven animation — and the first JS
   * animation must introduce the `prefersReducedMotion` JS gate, which doesn't exist yet. The
   * chevron rotation marks open/closed in the meantime.
   */
  import { Accordion as AccordionPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<AccordionPrimitive.RootProps> = $props();
</script>

<AccordionPrimitive.Root bind:ref class={mergeClasses("mc-accordion", className)} {...restProps} />
