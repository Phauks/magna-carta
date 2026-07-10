<script lang="ts">
  /*
   * The "what does this number mean" affordance: a hover-and-focus tooltip carrying prose only.
   * It holds no link — a link inside a hover tooltip is unreachable, because the tooltip closes as
   * the pointer crosses to it; any "learn more" link lives visibly beside the heading instead.
   */
  import Info from "@lucide/svelte/icons/info";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import type { Snippet } from "svelte";

  let { label, children }: { label: string; children: Snippet } = $props();
</script>

<Tooltip.Root>
  <Tooltip.Trigger aria-label={label} class="text-text-muted">
    <Info class="size-12" aria-hidden="true" />
  </Tooltip.Trigger>
  <Tooltip.Content class="max-w-xs text-sm">
    {@render children()}
  </Tooltip.Content>
</Tooltip.Root>
