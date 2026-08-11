<script lang="ts">
  /*
   * ChoiceRow (Tier 2) — a full-width row that IS the choice: a leading icon, a name over the
   * facts that tell two similar rows apart, and an optional trailing status. It is a plain
   * <button>, not a list item with a control inside it, so the whole row is one hit target and
   * one tab stop.
   *
   * The shape exists because several surfaces need the same row and would otherwise each grow
   * their own: picking a workspace after sign-in, picking which second factor to use, and
   * reviewing the methods already enrolled. Those rows are heterogeneous — a workspace, a phone
   * channel, a passkey — so the parts are snippets and the component prescribes none of them.
   *
   * `selected` drives aria-pressed and the selected surface, and is deliberately OPTIONAL: a row
   * that navigates is not a toggle, and announcing "not pressed" on a plain action misreports it.
   * Leave it undefined and no pressed state is exposed at all.
   */
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    selected,
    icon,
    detail,
    trailing,
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLButtonAttributes, HTMLButtonElement> & {
    /**
     * Whether this row is the chosen one. Omit entirely on a row that acts rather than toggles —
     * an undefined value renders no aria-pressed.
     */
    selected?: boolean;
    /** A leading icon. Rendered decorative: the row's name carries the meaning. */
    icon?: Snippet;
    /** The supporting facts under the name — where it is, when it was last used. */
    detail?: Snippet;
    /** A trailing status, usually a Badge. */
    trailing?: Snippet;
  } = $props();
</script>

<button
  bind:this={ref}
  type="button"
  aria-pressed={selected}
  class={mergeClasses("mc-choice-row w-full", className)}
  {...restProps}
>
  {#if icon}
    <span class="mc-choice-row-icon" aria-hidden="true">{@render icon()}</span>
  {/if}
  <span class="mc-choice-row-body">
    <span class="mc-choice-row-name">{@render children?.()}</span>
    {#if detail}
      <span class="mc-choice-row-detail">{@render detail()}</span>
    {/if}
  </span>
  {#if trailing}
    <span class="mc-choice-row-trailing">{@render trailing()}</span>
  {/if}
</button>
