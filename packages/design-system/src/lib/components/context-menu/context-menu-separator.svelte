<script lang="ts">
  /* ContextMenu.Separator — a hairline rule between groups of items (role="separator"). The look is
     the mc-context-menu-separator recipe. Thin wrapper over Bits UI ContextMenu.Separator. */
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<ContextMenuPrimitive.SeparatorProps> = $props();
</script>

<ContextMenuPrimitive.Separator
  bind:ref
  class={mergeClasses("mc-context-menu-separator", className)}
  {...restProps}
/>
