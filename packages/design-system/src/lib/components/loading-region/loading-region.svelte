<script lang="ts">
  /*
   * LoadingRegion — the ONE way a region of a screen says its data has not arrived (Tier 1, native
   * elements). The component is its own skeleton: while `loading`, the region renders the `fixture`
   * snippet (representative content in the real components — two or three rows from a factory, a
   * card with sample words) under the mc-loading recipe, which turns every text, media and control
   * leaf into a bone and leaves the frame, the headings, the labels and the rules real. Nothing is
   * measured and nothing is drawn by hand, so the placeholder cannot drift from the screen it
   * stands in for: it IS the screen. Once `loading` is false the children render in its place.
   *
   * When no fixture is given the children themselves render under the recipe — right for a surface
   * whose resting furniture is already the shape (a labelled-field group, a header) and whose
   * children can render before their data exists. A surface that cannot render on null data gives
   * a fixture.
   *
   * The loading STATE is announced once, here, by the sentence for assistive technology and the
   * region's aria-busy; the fixture is `inert`, so nothing in it can be focused, pressed, selected
   * or read as if it were real. `aria-busy` alone is honoured by few screen readers, which is why
   * the sentence exists and the bones are hidden from the accessibility tree rather than relied on.
   *
   * What this component owns, it owns by having no prop for it: the pulse, the bone colour, the
   * announcement's mechanics. A caller supplies the two facts only it knows — whether it is loading
   * and what it is reading — and the shape, which is its own markup.
   */
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    loading,
    label,
    fixture,
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    /** True while the region's data has not arrived. */
    loading: boolean;
    /**
     * The sentence assistive technology hears while loading, in the house voice — "Reading this
     * record's names", "Looking for near matches". Required: a loading region that says nothing is
     * the defect this component exists to end.
     */
    label: string;
    /**
     * Representative content rendered as the shape while loading, in the same components the real
     * content uses. Absent, the children render as the shape.
     */
    fixture?: Snippet;
    children: Snippet;
  } = $props();
</script>

{#if loading}
  <p class="sr-only">{label}</p>
{/if}
<div
  bind:this={ref}
  class={mergeClasses("mc-loading-region", className)}
  data-mc-loading={loading ? "" : undefined}
  inert={loading}
  aria-busy={loading ? "true" : undefined}
  {...restProps}
>
  {#if loading && fixture}
    {@render fixture()}
  {:else}
    {@render children()}
  {/if}
</div>
