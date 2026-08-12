<script lang="ts">
  /* Other — no surface backs this section yet; the stub states what will live here. */
  import SectionStub from "$lib/matters/section-stub.svelte";
  import { matterSections } from "$lib/matters/sections.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);

  const section = matterSections.find((candidate) => candidate.slug === "other");
  if (!section) throw new Error('The matter section registry is missing "other".');
</script>

<svelte:head>
  <title>{section.label} · {matter.title} · Magna Carta</title>
</svelte:head>

<SectionStub {section} />
