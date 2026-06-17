<script lang="ts">
  /*
   * Resizable.Handle — the draggable divider between two Panes. Wraps paneforge's PaneResizer, which
   * supplies the drag + keyboard-resize behaviour and the role="separator"/aria-* wiring; the look is
   * the mc-resizable-handle recipe (a hairline that thickens to the focus colour on hover/drag).
   * `withHandle` renders a centred grip so the affordance is visible on a flat divider.
   */
  import { PaneResizer } from "paneforge";
  import GripVertical from "@lucide/svelte/icons/grip-vertical";
  import type { ComponentProps } from "svelte";
  import { mergeClasses } from "../../internal/merge-classes.ts";

  let {
    ref = $bindable(null),
    class: className,
    withHandle = false,
    ...restProps
  }: ComponentProps<typeof PaneResizer> & { withHandle?: boolean } = $props();
</script>

<PaneResizer bind:ref class={mergeClasses("mc-resizable-handle", className)} {...restProps}>
  {#if withHandle}
    <div class="mc-resizable-grip">
      <GripVertical class="mc-resizable-grip-icon" aria-hidden="true" />
    </div>
  {/if}
</PaneResizer>
