<script lang="ts">
  /*
   * Accordion.Root (Tier 2) — over Bits UI Accordion.Root. `type` is "single" or "multiple";
   * behaviour, a11y, and keyboard come from Bits. Compose with Accordion.Item/Trigger/Content.
   *
   * NOTE: the expand/collapse HEIGHT animation is deferred. It needs Bits' runtime
   * `--bits-accordion-content-height` var, which the purity-gated components.css cannot reference
   * (var(--mc-…)/keywords only, no escape), so it has to be a JS-driven animation. The motion gate
   * it would have to consult now exists (`prefersReducedMotion` in ../../internal/motion-preference.ts,
   * the same reader signature motion and view transitions call), so only the animation itself is
   * outstanding. The chevron rotation marks open/closed in the meantime.
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
