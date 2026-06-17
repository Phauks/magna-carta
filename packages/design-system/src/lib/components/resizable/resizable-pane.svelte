<script lang="ts">
  /* Resizable.Pane — one resizable region. Pass `defaultSize`/`minSize`/`maxSize` (percentages of
     the group) and optionally `collapsible`. Thin wrapper over paneforge's Pane. */
  import { Pane } from "paneforge";
  import type { ComponentProps } from "svelte";
  import { mergeClasses } from "../../internal/merge-classes.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: ComponentProps<typeof Pane> = $props();
</script>

<Pane bind:ref class={mergeClasses("mc-resizable-pane", className)} {...restProps} />
