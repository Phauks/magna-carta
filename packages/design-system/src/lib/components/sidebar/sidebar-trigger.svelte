<script lang="ts">
  /* Sidebar.Trigger — toggles the collapsed icon rail. Defaults to a PanelLeft icon button;
     aria-expanded reflects the state. Lives in the footer's pinned region. See sidebar.svelte. */
  import type { HTMLButtonAttributes } from "svelte/elements";
  import PanelLeft from "@lucide/svelte/icons/panel-left";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import { getSidebarContext } from "./context.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    onclick,
    ...restProps
  }: WithElementRef<HTMLButtonAttributes, HTMLButtonElement> = $props();

  const sidebar = getSidebarContext();
</script>

<button
  bind:this={ref}
  type="button"
  aria-label="Toggle sidebar"
  aria-expanded={!sidebar.collapsed}
  class={mergeClasses("mc-sidebar-trigger", className)}
  onclick={(event) => {
    sidebar.toggle();
    onclick?.(event);
  }}
  {...restProps}
>
  {#if children}
    {@render children()}
  {:else}
    <PanelLeft class="mc-sidebar-trigger-icon" aria-hidden="true" />
  {/if}
</button>
