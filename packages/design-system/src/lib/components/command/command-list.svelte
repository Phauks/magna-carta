<script lang="ts">
  /* Command.List — the scrollable results region (role="listbox"); the mc-command-list recipe bounds
     its height and scrolls. Thin wrapper over Bits UI Command.List. */
  import { Command as CommandPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<CommandPrimitive.ListProps> = $props();
</script>

<CommandPrimitive.List bind:ref class={mergeClasses("mc-command-list", className)} {...restProps} />
