<script lang="ts">
  /*
   * Sidebar.MenuButton — a nav destination: a leading icon (the `icon` snippet) and a label (the
   * children). Renders an <a> when `href` is given, else a <button>. `isActive` marks the current
   * route (data-active drives the highlight). In the collapsed icon rail the label is hidden by the
   * recipe and the destination's name is surfaced on hover/focus via a Tooltip (its text is the
   * `tooltip` prop) — so the rail stays usable. The element doubles as the Tooltip trigger through
   * Bits' `child` snippet, which keeps the anchor/button semantics (no extra wrapping button).
   *
   * A Tooltip.Provider must sit above the sidebar (app root / Storybook decorator).
   */
  import type { Snippet } from "svelte";
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
  import { Tooltip as TooltipPrimitive } from "bits-ui";
  import * as Tooltip from "../tooltip/index.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import { getSidebarContext } from "./context.ts";

  // Relaxed INTERSECTION of button + anchor attributes (the Button pattern) — a discriminated
  // `href` union explodes into "union type too complex" under svelte-check. href/type/disabled are
  // pulled out so each lands on the right element (an anchor cannot be a button-type or disabled).
  type Props = WithElementRef<HTMLButtonAttributes> &
    WithElementRef<HTMLAnchorAttributes> & {
      /** Marks the current route — drives the active highlight. */
      isActive?: boolean;
      /** Label shown on hover/focus when the sidebar is the collapsed icon rail. */
      tooltip?: string;
      /** Leading icon (sized by the recipe via the mc-sidebar-icon class). */
      icon?: Snippet;
      /** A destination URL. When set, the item renders as an `<a href>` instead of a `<button>`. */
      href?: string;
    };

  let {
    ref = $bindable(null),
    isActive = false,
    tooltip,
    icon,
    href,
    type = "button",
    disabled,
    class: className,
    children,
    ...restProps
  }: Props = $props();

  const sidebar = getSidebarContext();
</script>

{#snippet button(triggerProps: Record<string, unknown>)}
  {#if href}
    <a
      bind:this={ref}
      {href}
      data-active={isActive ? "true" : undefined}
      class={mergeClasses("mc-sidebar-menu-button w-full", className)}
      {...restProps}
      {...triggerProps}
    >
      {@render icon?.()}
      <span class="mc-sidebar-label">{@render children?.()}</span>
    </a>
  {:else}
    <button
      bind:this={ref}
      {type}
      {disabled}
      data-active={isActive ? "true" : undefined}
      class={mergeClasses("mc-sidebar-menu-button w-full", className)}
      {...restProps}
      {...triggerProps}
    >
      {@render icon?.()}
      <span class="mc-sidebar-label">{@render children?.()}</span>
    </button>
  {/if}
{/snippet}

{#if sidebar.collapsed && !sidebar.peeking && tooltip}
  <!-- Only the resting icon rail needs the tooltip; while it is floated open on hover the labels
       are visible, so a hover tooltip would double the name. -->
  <Tooltip.Root>
    <TooltipPrimitive.Trigger>
      {#snippet child({ props })}
        {@render button(props)}
      {/snippet}
    </TooltipPrimitive.Trigger>
    <Tooltip.Content side="right">{tooltip}</Tooltip.Content>
  </Tooltip.Root>
{:else}
  {@render button({})}
{/if}
