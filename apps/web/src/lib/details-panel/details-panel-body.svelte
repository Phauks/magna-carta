<script lang="ts">
  /*
   * DetailsPanel.Body — the scrolling column under the header. It is the only thing in the panel
   * that scrolls: the header stays put, so what the reader is looking at is always named.
   */
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<div class="mc-scrollbar flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto p-16">
  {@render children()}
</div>
