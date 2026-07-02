<script lang="ts">
  /* Tooltip.Provider — shares the open/close delay across the tooltips beneath it; renders no DOM.
     Place once near the app root; the Storybook stories wrap their own. */
  import { Tooltip as TooltipPrimitive } from "bits-ui";

  let { ...restProps }: TooltipPrimitive.ProviderProps = $props();
</script>

<TooltipPrimitive.Provider {...restProps} />
