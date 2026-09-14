<script lang="ts">
  /*
   * Reports — the catalogue of every report the platform declares, on the shared catalogue
   * framework ($lib/catalogue): grouped by family, as a card grid or a dense list, searchable from
   * the masthead's action row. A built report opens its run screen; a soon one is visible, goes
   * nowhere, and says what it waits on.
   *
   * It is the Tools screen's framework because a catalogue of things a member can open is the same
   * screen whatever the things are — which is the whole reason the framework was lifted out of the
   * two of them.
   *
   * It is the landing of a two-sided screen: the Reports layout draws the reports column beside
   * it, and this index fills the content column so the column is never beside nothing. The column
   * carries names; this screen carries the question each report answers, the search and the views.
   */
  import CatalogueScreen from "$lib/catalogue/catalogue-screen.svelte";
  import { createCatalogueViewPreference } from "$lib/catalogue/catalogue-view-preference.svelte.ts";
  import { reportCatalogueSections, REPORTS_VIEW_STORAGE_KEY } from "$lib/reports/report-catalogue.ts";

  const sections = reportCatalogueSections();
  const viewPreference = createCatalogueViewPreference(REPORTS_VIEW_STORAGE_KEY);
</script>

<svelte:head><title>Reports · Magna Carta</title></svelte:head>

<CatalogueScreen
  title="Reports"
  {sections}
  {viewPreference}
  searchLabel="Search reports"
  noun="reports"
/>
