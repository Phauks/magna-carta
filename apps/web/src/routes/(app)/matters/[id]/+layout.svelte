<script lang="ts">
  /*
   * The matter detail chrome: ONE header band (the ceremonial edge on the reading edge, the
   * actions and the section strip in the column at its inline end) over every page under
   * /matters/[id]. The pages render below through children. The chrome is identical for every
   * matter status — status shapes only what the header showcases, never which sections exist or
   * where they lead.
   */
  import MatterHeader from "$lib/matters/matter-header.svelte";
  import type { LayoutProps } from "./$types";

  let { data, children }: LayoutProps = $props();
</script>

<svelte:head>
  <title>{data.matter.title} · Magna Carta</title>
</svelte:head>

<!-- A full-height flex column, so a section that manages its own scrolling (Files) can take
     exactly the remaining viewport height and pin its own footer to the bottom of the screen.
     Sections that scroll normally are unaffected: min-h-full lets content grow past the fold. -->
<div class="flex min-h-full flex-col">
  <div class="mb-24 flex-none">
    <MatterHeader matter={data.matter} />
  </div>

  {@render children()}
</div>
