<script lang="ts">
  /* Tooltip.Trigger — the element the tooltip anchors to (hover/focus). Thin wrapper over Bits UI
     Tooltip.Trigger; the flush focus ring is the mc-tooltip-trigger recipe.

     IT TAKES A `child` SNIPPET, because the thing a tooltip names is often already somebody else's
     trigger — the header's bell and download tray open popovers, and a control cannot be two
     elements. Bits' own composition answer is the child snippet: it hands its props to the caller's
     element instead of rendering one of its own, which is how the two triggers become one button.
     The sidebar's collapse control reached past this wrapper to the primitive to do it; app code
     cannot (bits-ui is importable only inside this package), so the seam belongs here. With a child
     the recipe class is the caller's business — the element is theirs. */
  import { Tooltip as TooltipPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";

  let {
    ref = $bindable(null),
    class: className,
    child,
    ...restProps
  }: TooltipPrimitive.TriggerProps = $props();
</script>

{#if child !== undefined}
  <TooltipPrimitive.Trigger bind:ref {child} {...restProps} />
{:else}
  <TooltipPrimitive.Trigger
    bind:ref
    class={mergeClasses("mc-tooltip-trigger", className)}
    {...restProps}
  />
{/if}
