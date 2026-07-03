<script lang="ts">
  /* Command.GroupItems — wraps the items inside a Group so the heading is not treated as an item. No
     recipe of its own. Thin pass-through over Bits UI Command.GroupItems. */
  import { Command as CommandPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<CommandPrimitive.GroupItemsProps> = $props();
</script>

<CommandPrimitive.GroupItems bind:ref class={mergeClasses(className)} {...restProps} />
