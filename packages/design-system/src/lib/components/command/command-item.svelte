<script lang="ts">
  /* Command.Item — one selectable row (role="option"). Behaviour + a11y (keyboard highlight, onSelect,
     disabled, filtering by `value`/`keywords`) come from Bits; the look is the mc-command-item recipe
     keyed off `data-selected` (the active/highlighted row) and `data-disabled`. Thin pass-through over
     Bits UI Command.Item — the caller's children are the row content. */
  import { Command as CommandPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<CommandPrimitive.ItemProps> = $props();
</script>

<CommandPrimitive.Item bind:ref class={mergeClasses("mc-command-item", className)} {...restProps} />
