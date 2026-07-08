<script lang="ts">
  /*
   * The matter detail chrome: one header (the ceremonial edge) and one section strip over every
   * page under /matters/[id]. The pages render below through children. The chrome is identical
   * for every matter status — status shapes only what the header showcases, never which sections
   * exist or where they lead.
   */
  import MatterHeader from "$lib/matters/matter-header.svelte";
  import MatterSectionNav from "$lib/matters/matter-section-nav.svelte";
  import type { LayoutProps } from "./$types";

  let { data, children }: LayoutProps = $props();
</script>

<svelte:head>
  <title>{data.matter.title} · Magna Carta</title>
</svelte:head>

<div class="mb-24 flex flex-col gap-16">
  <MatterHeader matter={data.matter} />
  <MatterSectionNav matterId={data.matter.id} />
</div>

{@render children()}
