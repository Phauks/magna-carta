<script lang="ts">
  /*
   * The "what does this number mean" affordance. A popover, not a tooltip: the content carries a
   * link and must be reachable by keyboard, which a hover tooltip is not.
   */
  import Info from "@lucide/svelte/icons/info";
  import * as Popover from "@magna-carta/design-system/popover";
  import type { Snippet } from "svelte";

  let { label, children }: { label: string; children: Snippet } = $props();
</script>

<Popover.Root>
  <Popover.Trigger aria-label={label} class="text-text-muted">
    <Info class="size-16" aria-hidden="true" />
  </Popover.Trigger>
  <Popover.Content class="max-w-xs text-sm">
    {@render children()}
  </Popover.Content>
</Popover.Root>
