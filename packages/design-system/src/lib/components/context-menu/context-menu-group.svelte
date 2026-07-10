<script lang="ts">
  /* ContextMenu.Group — a semantic grouping of items (role="group"), associated with its
     GroupHeading for assistive tech. Renders no look of its own. Thin pass-through over Bits UI
     ContextMenu.Group. */
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<ContextMenuPrimitive.GroupProps> = $props();
</script>

<ContextMenuPrimitive.Group bind:ref class={mergeClasses(className)} {...restProps} />
