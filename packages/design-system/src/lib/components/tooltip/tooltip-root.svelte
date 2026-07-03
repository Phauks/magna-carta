<script lang="ts">
  /* Tooltip.Root — pairs a Trigger with its Content; renders no DOM of its own. */
  import { Tooltip as TooltipPrimitive } from "bits-ui";

  let { ...restProps }: TooltipPrimitive.RootProps = $props();
</script>

<TooltipPrimitive.Root {...restProps} />
