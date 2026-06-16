<script lang="ts">
  /* Command.Empty — the message shown when the query matches nothing (Bits mounts it only then). The
     look is the mc-command-empty recipe (centred, muted). Thin wrapper over Bits UI Command.Empty. */
  import { Command as CommandPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<CommandPrimitive.EmptyProps> = $props();
</script>

<CommandPrimitive.Empty bind:ref class={mergeClasses("mc-command-empty", className)} {...restProps} />
