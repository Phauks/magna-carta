<script lang="ts">
  /*
   * Sidebar.Trigger — toggles the collapsed icon rail and SAYS which it does: a full-width control
   * styled like a menu button, with a state icon + a "Collapse" / "Expand" label. In the rail the
   * label goes sr-only (the button keeps its accessible name) and a Tooltip surfaces "Expand", same as
   * the nav items. aria-expanded reflects the state. Lives in the footer's pinned region.
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
    class: className,
    onclick,
    ...restProps
  }: WithElementRef<HTMLButtonAttributes, HTMLButtonElement> = $props();

  const sidebar = getSidebarContext();
</script>

{#snippet trigger(triggerProps: Record<string, unknown>)}
  <button
    bind:this={ref}
    type="button"
    aria-label={sidebar.collapsed ? "Expand sidebar" : "Collapse sidebar"}
    aria-expanded={!sidebar.collapsed}
    class={mergeClasses("mc-sidebar-menu-button mc-sidebar-trigger w-full", className)}
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
    <span class={mergeClasses("mc-sidebar-label", sidebar.collapsed && "sr-only")}>
      {sidebar.collapsed ? "Expand" : "Collapse"}
    </span>
  </button>
{/snippet}

{#if sidebar.collapsed}
  <Tooltip.Root>
    <TooltipPrimitive.Trigger>
      {#snippet child({ props })}
        {@render trigger(props)}
      {/snippet}
    </TooltipPrimitive.Trigger>
    <Tooltip.Content side="right">Expand</Tooltip.Content>
  </Tooltip.Root>
{:else}
  {@render trigger({})}
{/if}
