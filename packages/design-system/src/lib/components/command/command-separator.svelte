<script lang="ts">
  /* Command.Separator — a hairline between groups (Bits hides it while filtering). The look is the
     mc-command-separator recipe. Thin wrapper over Bits UI Command.Separator. */
  import { Command as CommandPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<CommandPrimitive.SeparatorProps> = $props();
</script>

<CommandPrimitive.Separator
  bind:ref
  class={mergeClasses("mc-command-separator", className)}
  {...restProps}
/>
