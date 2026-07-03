<script lang="ts">
  /* Command.GroupHeading — the label for a Group (Bits links it via aria-labelledby). The look is the
     mc-command-group-heading recipe (muted, small). Thin wrapper over Bits UI Command.GroupHeading. */
  import { Command as CommandPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<CommandPrimitive.GroupHeadingProps> = $props();
</script>

<CommandPrimitive.GroupHeading
  bind:ref
  class={mergeClasses("mc-command-group-heading", className)}
  {...restProps}
/>
