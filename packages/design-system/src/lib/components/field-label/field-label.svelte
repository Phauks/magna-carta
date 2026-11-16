<script lang="ts">
  /*
   * FieldLabel — the label naming the read-only fact beneath it (Tier 1: a native element, no
   * Bits UI). Styling is the mc-field-label recipe (field-label.css); mergeClasses is the single
   * class seam, so a consumer `class` still wins last.
   *
   * IT DOES NOT PICK ITS OWN ELEMENT, because the right element is the caller's document structure
   * and not this component's business: a label over a figure is a `p`, the term in a definition
   * list is a `dt`, and a label that genuinely heads a section is a heading. Rendering one fixed
   * tag would have forced the callers that need another to keep hand-writing the register — which
   * is the thing this exists to stop. The default is `span`, the element that assumes least.
   *
   * It is a LABEL, not a control and not a legend: it names, it does not act, and it carries no
   * `for`. A form field's own label is the Label component, which is a different question.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import type { FieldLabelElement } from "./element.ts";

  let {
    as = "span",
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>, HTMLElement> & {
    /** Which element to render. Pick the one the surrounding document structure requires. */
    as?: FieldLabelElement;
  } = $props();
</script>

<svelte:element
  this={as}
  bind:this={ref}
  class={mergeClasses("mc-field-label", className)}
  {...restProps}
>
  {@render children?.()}
</svelte:element>
