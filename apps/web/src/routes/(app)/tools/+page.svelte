<script lang="ts">
  /*
   * Tools — the ethereal workbench's directory, on the shared catalogue framework
   * ($lib/catalogue): every tool the firm offers, grouped by subject, as a card grid or a dense
   * list, searchable from the masthead's action row. Runs outside any matter.
   *
   * It is the landing of a two-sided screen: the Tools layout draws the tools column beside it,
   * and this index fills the content column so the column is never beside nothing. The column
   * carries names; this screen carries what each tool does, the search and the views.
   *
   * The screen decides nothing about how a catalogue looks or narrows — that is the framework's,
   * shared with Reports — and nothing about what a tool is, which is the catalog's and its
   * presentation layer's. What is left is which catalogue this is: its sections, its title, and
   * where this browser's view choice is kept.
   */
  import CatalogueScreen from "$lib/catalogue/catalogue-screen.svelte";
  import { createCatalogueViewPreference } from "$lib/catalogue/catalogue-view-preference.svelte.ts";
  import { toolCatalogueSections, TOOLS_VIEW_STORAGE_KEY } from "$lib/tools/tool-catalogue.ts";

  const sections = toolCatalogueSections();
  const viewPreference = createCatalogueViewPreference(TOOLS_VIEW_STORAGE_KEY);
</script>

<svelte:head><title>Tools · Magna Carta</title></svelte:head>

<CatalogueScreen
  title="Tools"
  {sections}
  {viewPreference}
  searchLabel="Search tools"
  noun="tools"
/>
