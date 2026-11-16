<script lang="ts">
  /*
   * Label — a styled native <label> (Tier 1: native element, no Bits UI; a label needs no
   * headless behavior). The native for/id association (or wrapping a control) is what links it
   * to its field; this component only styles it. Styling is the mc-label recipe
   * (src/lib/styles/components.css); callers layer Tailwind utilities via `class`, merged last
   * so they win (mergeClasses is the single class-merge path). WithElementRef adds `ref`.
   *
   * `optional` marks a field that may be left empty with the word "Optional" after the name, in a
   * lighter voice. One marker everywhere, so a form never says "(optional)" in one label, "if you
   * want to say" in another and nothing in a third. Required fields carry no mark: in a form most
   * fields are needed, so the exception is what gets the word.
   */
  import type { HTMLLabelAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    optional = false,
    ...restProps
  }: WithElementRef<HTMLLabelAttributes, HTMLLabelElement> & {
    /** Says "Optional" after the name: the field may be left empty. */
    optional?: boolean;
  } = $props();
</script>

<label bind:this={ref} class={mergeClasses("mc-label", className)} {...restProps}>
  {@render children?.()}
  {#if optional}<span class="mc-label-optional">Optional</span>{/if}
</label>
