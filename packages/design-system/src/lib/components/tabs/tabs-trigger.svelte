<script lang="ts">
  /* Tabs.Trigger — one tab (a button; `value` selects its panel). Thin wrapper over Bits UI
     Tabs.Trigger; the active/inactive/disabled look is the `mc-tabs-trigger` recipe via data-state.
     The gold indicator is a real child element (not a pseudo-element — the recipe purity grammar
     has no `content` escape) so the recipe can position it and the gilt-draw can animate it. */
  import { Tabs as TabsPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithoutChild<TabsPrimitive.TriggerProps> = $props();
</script>

<TabsPrimitive.Trigger bind:ref class={mergeClasses("mc-tabs-trigger", className)} {...restProps}>
  {@render children?.()}
  <span class="mc-tabs-trigger-indicator" aria-hidden="true"></span>
</TabsPrimitive.Trigger>
