<script lang="ts">
  /* ContextMenu.GroupHeading — the small label that titles a Group (wired to it for assistive tech
     by Bits). The look is the mc-context-menu-group-heading recipe (a muted caption). Thin wrapper
     over Bits UI ContextMenu.GroupHeading. */
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<ContextMenuPrimitive.GroupHeadingProps> = $props();
</script>

<ContextMenuPrimitive.GroupHeading
  bind:ref
  class={mergeClasses("mc-context-menu-group-heading", className)}
  {...restProps}
/>
