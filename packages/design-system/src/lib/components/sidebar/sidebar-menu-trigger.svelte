<script lang="ts">
  /*
   * Sidebar.MenuTrigger — a SUB-MENU's row: the fold inside a group.
   *
   * It wears the destination row's recipe exactly (same height, same icon column, same hover), and
   * differs in the one way that matters: pressing it opens and closes the rows beneath instead of
   * going anywhere. That is deliberate — a cluster is a fold, not a screen, and a row that looked
   * like a category but navigated like a destination would be the /tools index again in miniature.
   * The chevron is what says so, pointing down while the sub-menu is open and toward the inline
   * start while it is folded, the same disclosure convention the group heading uses.
   *
   * The chevron rides the trailing column, so a long cluster name truncates and the chevron stays.
   */
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import { Tooltip as TooltipPrimitive } from "bits-ui";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import * as Tooltip from "../tooltip/index.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import { getSidebarContext } from "./context.ts";

  let {
    ref = $bindable(null),
    expanded = true,
    tooltip,
    icon,
    class: className,
    children,
    onclick,
    ...restProps
  }: WithElementRef<HTMLButtonAttributes, HTMLButtonElement> & {
    /** Whether the sub-menu this heads is showing its rows. */
    expanded?: boolean;
    /** Label shown on hover/focus when the sidebar is the collapsed icon rail. */
    tooltip?: string;
    /** Leading icon (sized by the recipe via the mc-sidebar-icon class). */
    icon?: Snippet;
  } = $props();

  const sidebar = getSidebarContext();
</script>

{#snippet trigger(triggerProps: Record<string, unknown>)}
  <button
    bind:this={ref}
    type="button"
    class={mergeClasses("mc-sidebar-menu-button mc-sidebar-menu-trigger w-full", className)}
    aria-expanded={expanded}
    data-expanded={expanded ? "true" : "false"}
    {...restProps}
    {...triggerProps}
    onclick={(event) => {
      // Last, after the tooltip's own props: in the icon rail the tooltip trigger brings an onclick
      // of its own, and spread after ours it replaced the fold's, so the cluster would not open or
      // close there. Both run: the tooltip's first, then the fold's.
      (triggerProps.onclick as ((event: MouseEvent) => void) | undefined)?.(event);
      onclick?.(event as Parameters<NonNullable<typeof onclick>>[0]);
    }}
  >
    {@render icon?.()}
    <span class="mc-sidebar-label">{@render children?.()}</span>
    <span class="mc-sidebar-trailing">
      <ChevronDown
        class="mc-sidebar-group-chevron size-12 motion-reduce:transition-none {expanded
          ? ''
          : '-rotate-90'}"
        aria-hidden="true"
      />
    </span>
  </button>
{/snippet}

{#if sidebar.collapsed && !sidebar.peeking && tooltip}
  <Tooltip.Root>
    <TooltipPrimitive.Trigger>
      {#snippet child({ props })}
        {@render trigger(props)}
      {/snippet}
    </TooltipPrimitive.Trigger>
    <Tooltip.Content side="right">{tooltip}</Tooltip.Content>
  </Tooltip.Root>
{:else}
  {@render trigger({})}
{/if}
