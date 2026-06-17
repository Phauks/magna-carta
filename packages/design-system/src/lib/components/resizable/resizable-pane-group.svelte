<script lang="ts">
  /*
   * Resizable.PaneGroup (Root) — a thin wrapper over paneforge's PaneGroup. `direction` is required
   * ("horizontal" | "vertical"); pass `autoSaveId` to persist the layout to localStorage. Holds the
   * Panes and the Handles between them. The look is the mc-resizable-group recipe (the group is just a
   * flex track; the panes and handles carry the visible chrome).
   */
  import { PaneGroup } from "paneforge";
  import type { ComponentProps } from "svelte";
  import { mergeClasses } from "../../internal/merge-classes.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: ComponentProps<typeof PaneGroup> = $props();
</script>

<PaneGroup bind:ref class={mergeClasses("mc-resizable-group h-full w-full", className)} {...restProps} />
