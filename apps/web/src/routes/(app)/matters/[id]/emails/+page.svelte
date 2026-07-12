<script lang="ts">
  /* Emails — no surface backs this section yet; the stub states what will live here. */
  import SectionStub from "$lib/matters/section-stub.svelte";
  import { matterSections } from "$lib/matters/sections.ts";
  import type { MatterFixture } from "$lib/matters/fixtures.ts";

  let { data }: { data: { matter: MatterFixture } } = $props();

  const matter = $derived(data.matter);

  const section = matterSections.find((candidate) => candidate.slug === "emails");
  if (!section) throw new Error('The matter section registry is missing "emails".');
</script>

<svelte:head>
  <title>{section.label} · {matter.title} · Magna Carta</title>
</svelte:head>

<SectionStub {section} />
