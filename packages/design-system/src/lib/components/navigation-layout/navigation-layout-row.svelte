<script lang="ts">
  /*
   * NavigationLayout.Row — one choice inside the navigation column of a two-sided screen.
   *
   * The layout imposes no structure on what the navigation HOLDS, and that stays true: a column
   * is free to draw bands, group headers, a sort control, whatever it needs. What it is not free
   * to do is re-invent the ROW, because the row is the thing a reader learns once. The treatment
   * had been written by hand three times — the settings nav, the catalogue column shared by Tools
   * and Reports, and the inline styling in both — and a fourth two-sided screen is already
   * foreseen (the file manager's folder tree), so the three copies became this one part.
   *
   * WHAT THE PART OWNS: the control height as a MINIMUM, the rounded shape, the resting muted ink,
   * the hover tint, the chosen row's selected fill with its gilt start-edge bar, the focus ring,
   * and the slot for a trailing mark. What it does not own is where the row goes or what it says.
   *
   * A NAME WRAPS RATHER THAN TRUNCATES. The column is the popover measure wide and a name beside a
   * Soon mark does not always fit one line; a row that reads "Property Listin..." has stopped
   * naming the thing, which is the one job a navigation row has. So the name takes a second line
   * where it needs one and the row grows to hold it. Both consumers wrapped already; making it the
   * part's single behaviour is what keeps them from drifting apart again.
   *
   * WHAT ELEMENT IT RENDERS follows from `href`, and the part never guesses:
   *   - a string      -> an <a>: a destination.
   *   - omitted       -> a <button>: an act, the shape a conversation rail takes.
   *   - null          -> a plain unlinked row: designed, with nowhere to go yet. It carries
   *                      aria-disabled and reads quieter, and is deliberately NOT dressed as a
   *                      disabled control — a greyed-out button reads as broken, where a quiet row
   *                      wearing a Soon mark in its `trailing` slot reads as not yet. `null` is
   *                      the same spelling the app's catalogue vocabulary already uses for it.
   */
  import type { Snippet } from "svelte";
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  // Relaxed INTERSECTION of button + anchor attributes (the Button and Sidebar.MenuButton pattern)
  // — a discriminated `href` union explodes into "union type too complex" under svelte-check.
  // href/type/disabled are pulled out so each lands on the element that can carry it.
  type Props = WithElementRef<HTMLButtonAttributes> &
    WithElementRef<HTMLAnchorAttributes> & {
      /**
       * Where the row goes. A string renders an `<a>`; omitting it renders a `<button>`; `null`
       * says the row is designed and has nowhere to go yet, and renders it unlinked and quiet.
       */
      href?: string | null;
      /** The row the reader is standing on: the selected fill, the firmer ink and the gilt bar. */
      current?: boolean;
      /** The leading glyph, sized by the `mc-navigation-layout-row-icon` class it applies itself. */
      icon?: Snippet;
      /** A mark at the row's inline end — a standing chip, a Soon badge. Never shrinks. */
      trailing?: Snippet;
      /** The name of the thing this row leads to. */
      children: Snippet;
    };

  let {
    ref = $bindable(null),
    href,
    current = false,
    icon,
    trailing,
    children,
    type = "button",
    disabled,
    class: className,
    ...restProps
  }: Props = $props();

  const rowClasses = $derived(mergeClasses("mc-navigation-layout-row w-full", className));
</script>

<!--
  The name carries `min-w-0 grow` so it takes the free width (pushing a trailing mark to the inline
  end) and may wrap inside it rather than forcing the row wider than its column.
-->
{#snippet body()}
  {#if icon}
    <span class="mc-navigation-layout-row-icon" aria-hidden="true">{@render icon()}</span>
  {/if}
  <span class="min-w-0 grow">{@render children()}</span>
  {#if trailing}
    <span class="shrink-0">{@render trailing()}</span>
  {/if}
{/snippet}

{#if typeof href === "string"}
  <a
    bind:this={ref}
    {href}
    aria-current={current ? "page" : undefined}
    data-current={current ? "true" : undefined}
    class={rowClasses}
    {...restProps}
  >
    {@render body()}
  </a>
{:else if href === null}
  <span
    bind:this={ref}
    aria-disabled="true"
    data-current={current ? "true" : undefined}
    class={rowClasses}
    {...restProps}
  >
    {@render body()}
  </span>
{:else}
  <button
    bind:this={ref}
    {type}
    {disabled}
    aria-current={current ? "true" : undefined}
    data-current={current ? "true" : undefined}
    class={rowClasses}
    {...restProps}
  >
    {@render body()}
  </button>
{/if}
