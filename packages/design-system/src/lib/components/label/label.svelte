<script lang="ts">
  /*
   * Label — a styled native <label> (Tier 1: native element, no Bits UI; a label needs no
   * headless behavior). The native for/id association (or wrapping a control) is what links it
   * to its field; this component only styles it. Styling is the mc-label recipe
   * (src/lib/styles/components.css); callers layer Tailwind utilities via `class`, merged last
   * so they win (mergeClasses is the single class-merge path). WithElementRef adds `ref`.
   *
   * `necessity` says whether the field it names must be filled. The label draws the mark that
   * follows from it (see `necessity.ts`, the one place the marking is chosen), so no form ever
   * writes "(optional)" or a star into its own text.
   */
  import type { HTMLLabelAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import NecessityMark from "./necessity-mark.svelte";
  import type { FieldNecessity } from "./necessity.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    necessity,
    ...restProps
  }: WithElementRef<HTMLLabelAttributes, HTMLLabelElement> & {
    /** Whether the field this names must be filled. Leave it out for a field that is neither. */
    necessity?: FieldNecessity;
  } = $props();
</script>

<label bind:this={ref} class={mergeClasses("mc-label", className)} {...restProps}>
  {@render children?.()}
  <NecessityMark {necessity} />
</label>
