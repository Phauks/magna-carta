<script lang="ts">
  /*
   * Command.Root — the command-palette container (a filterable list driven by a search Input). Bits
   * owns the filtering, keyboard navigation (roving highlight via aria-activedescendant, vim binds),
   * and the listbox/option a11y; the look is the mc-command recipe.
   *
   * The matcher is a SEAM: this defaults to a plain case-insensitive substring match (value +
   * keywords) — cheap and predictable — and a caller swaps in a richer scorer (or the firm search
   * index later) by passing `filter`. bits' own default is a fuzzy score (computeCommandScore).
   */
  import { Command as CommandPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  function includesFilter(value: string, search: string, keywords?: string[]): number {
    const haystack = [value, ...(keywords ?? [])].join(" ").toLowerCase();
    return haystack.includes(search.trim().toLowerCase()) ? 1 : 0;
  }

  let {
    ref = $bindable(null),
    class: className,
    filter = includesFilter,
    ...restProps
  }: WithoutChild<CommandPrimitive.RootProps> = $props();
</script>

<CommandPrimitive.Root
  bind:ref
  {filter}
  class={mergeClasses("mc-command", className)}
  {...restProps}
/>
