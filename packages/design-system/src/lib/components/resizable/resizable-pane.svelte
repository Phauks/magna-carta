<script lang="ts">
  /* Resizable.Pane — one resizable region. Pass `defaultSize`/`minSize`/`maxSize` (percentages of
     the group) and optionally `collapsible`. Thin wrapper over paneforge's Pane.

     The pane's imperative surface (collapse/expand/isCollapsed) is re-exported so a surface can
     close a side pane IN PLACE. Unmounting a pane instead makes the group re-lay out every pane
     proportionally — closing one sidebar visibly resizes the other — whereas collapsing hands the
     freed space to the adjacent pane and leaves the rest exactly where they were. */
  import { Pane } from "paneforge";
  import type { ComponentProps } from "svelte";
  import { mergeClasses } from "../../internal/merge-classes.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: ComponentProps<typeof Pane> = $props();

  let pane = $state<ReturnType<typeof Pane> | null>(null);

  export function collapse(): void {
    pane?.collapse();
  }

  export function expand(): void {
    pane?.expand();
  }

  export function isCollapsed(): boolean {
    return pane?.isCollapsed() ?? false;
  }

  export function resize(size: number): void {
    pane?.resize(size);
  }
</script>

<Pane
  bind:this={pane}
  bind:ref
  class={mergeClasses("mc-resizable-pane", className)}
  {...restProps}
/>
