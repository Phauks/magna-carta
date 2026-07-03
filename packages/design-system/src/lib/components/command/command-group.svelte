<script lang="ts">
  /* Command.Group — groups related items under a heading (role="group"; Bits hides the whole group
     when none of its items match). No recipe of its own — spacing comes from the heading and items.
     Thin pass-through over Bits UI Command.Group. */
  import { Command as CommandPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<CommandPrimitive.GroupProps> = $props();
</script>

<CommandPrimitive.Group bind:ref class={mergeClasses(className)} {...restProps} />
