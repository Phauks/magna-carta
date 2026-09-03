<script lang="ts">
  /*
   * The matter's Activity section: the one activity register ($lib/activity/activity-register.svelte)
   * in its full form — masthead, every column, the footer that loads older entries. The Overview's
   * Recent activity tile is the same register with a row budget; this page adds nothing of its own.
   */
  import ActivityRegister from "$lib/activity/activity-register.svelte";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
</script>

<svelte:head>
  <title>Activity · {matter.title} · Magna Carta</title>
</svelte:head>

<section class="flex min-h-0 flex-1 flex-col">
  <ActivityRegister
    matterId={matter.id}
    matterTitle={matter.title}
    isSample={matter.source === "sample"}
    variant="section"
  />
</section>
