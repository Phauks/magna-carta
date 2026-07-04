<script lang="ts">
  /*
   * Sidebar.Trigger — toggles the collapsed icon rail and SAYS which it does. Two shapes:
   *
   * - DEFAULT: a full-width control styled like a menu button, with a state icon + a
   *   "Collapse" / "Expand" label. In the rail the label goes sr-only (the button keeps its
   *   accessible name) and a Tooltip surfaces "Expand", same as the nav items.
   * - COMPACT (`compact`): a quiet ICON button for the rail-controls cluster — no inline label,
   *   the name carried by the tooltip in every state. Pairs with the shell's Customize control so
   *   the two rail CONTROLS read as a set, distinct from the destination rows above.
   *
   * aria-expanded reflects the state either way. Lives in the footer's pinned region.
   */
  import type { HTMLButtonAttributes } from "svelte/elements";
  import PanelLeftClose from "@lucide/svelte/icons/panel-left-close";
  import PanelLeftOpen from "@lucide/svelte/icons/panel-left-open";
  import { Tooltip as TooltipPrimitive } from "bits-ui";
  import * as Tooltip from "../tooltip/index.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import { getSidebarContext } from "./context.ts";

  let {
    ref = $bindable(null),
    compact = false,
    class: className,
    onclick,
    ...restProps
  }: WithElementRef<HTMLButtonAttributes, HTMLButtonElement> & { compact?: boolean } = $props();

  const sidebar = getSidebarContext();

  // The full-width shape shows the tooltip only in the rail (the label is otherwise visible); the
  // compact shape carries its name in the tooltip always. Never while peeking — the label shows.
  const showTooltip = $derived(compact || (sidebar.collapsed && !sidebar.peeking));
</script>

{#snippet trigger(triggerProps: Record<string, unknown>)}
  <button
    bind:this={ref}
    type="button"
    aria-label={sidebar.collapsed ? "Expand sidebar" : "Collapse sidebar"}
    aria-expanded={!sidebar.collapsed}
    class={mergeClasses(
      compact
        ? "mc-sidebar-control-button"
        : "mc-sidebar-menu-button mc-sidebar-trigger w-full",
      className,
    )}
    {...restProps}
    {...triggerProps}
    onclick={(event) => {
      sidebar.toggle();
      onclick?.(event);
    }}
  >
    {#if sidebar.collapsed}
      <PanelLeftOpen class="mc-sidebar-icon" aria-hidden="true" />
    {:else}
      <PanelLeftClose class="mc-sidebar-icon" aria-hidden="true" />
    {/if}
    {#if !compact}
      <span class="mc-sidebar-label">{sidebar.collapsed ? "Expand" : "Collapse"}</span>
    {/if}
  </button>
{/snippet}

{#if showTooltip}
  <Tooltip.Root>
    <TooltipPrimitive.Trigger>
      {#snippet child({ props })}
        {@render trigger(props)}
      {/snippet}
    </TooltipPrimitive.Trigger>
    <Tooltip.Content side="right">{sidebar.collapsed ? "Expand" : "Collapse"}</Tooltip.Content>
  </Tooltip.Root>
{:else}
  {@render trigger({})}
{/if}
