<script lang="ts">
  /* Command.Input — the search field that filters the list (role="combobox"; `value` is the query,
     bindable). Wrapped with a leading Lucide Search icon (deep-imported); the input itself is
     borderless and fills the row (the mc-command-input-wrapper carries the divider), since the
     palette is the focused context and the highlighted option is the active-descendant cue. */
  import { Command as CommandPrimitive } from "bits-ui";
  import Search from "@lucide/svelte/icons/search";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    value = $bindable(""),
    class: className,
    ...restProps
  }: WithoutChild<CommandPrimitive.InputProps> = $props();
</script>

<div class="mc-command-input-wrapper">
  <Search class="mc-command-input-icon" aria-hidden="true" />
  <CommandPrimitive.Input
    bind:ref
    bind:value
    class={mergeClasses("mc-command-input grow min-w-0", className)}
    {...restProps}
  />
</div>
