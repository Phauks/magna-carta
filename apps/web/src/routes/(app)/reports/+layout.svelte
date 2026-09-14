<script lang="ts">
  /*
   * The Reports shell — a two-sided screen on the design system's NavigationLayout: every report
   * the platform declares in the navigation column, grouped by family as the registry groups
   * them, with the one the reader is on lit; the chosen report's run screen in the content column
   * beside it. The owner's ruling of 2026-09-11 is that a screen with a navigational menu on the
   * left and content on the right is ONE component, for Reports as much as for Settings.
   *
   * THE COLUMN READS THE SAME PROJECTION AS THE LANDING SCREEN (report-catalogue.ts), so the
   * registry stays the one source: a report declared there appears in the column and on the
   * landing index with no edit here. A report nobody has built yet stands in the column unlinked
   * with its Soon mark, exactly as it stands on the index — visible and honest, never omitted.
   * The landing route keeps its index in the content column, where the question each report
   * answers, the search and the two views live, so the column is never beside nothing.
   *
   * The run screen is a normal-flow page — controls, then the report's tables — so the content
   * column is its scroll region and no route here owns a scroller of its own. The way back stays
   * on the run screen's header (`back="reports"`): a route inside a two-sided screen is still a
   * screen under a screen, and the column is a finding aid beside it.
   */
  import type { Snippet } from "svelte";
  import NavigationLayout from "@magna-carta/design-system/navigation-layout";
  import { page } from "$app/state";
  import { reportCatalogueSections } from "$lib/reports/report-catalogue.ts";
  import CatalogueNavigation from "$lib/catalogue/catalogue-navigation.svelte";

  let { children }: { children: Snippet } = $props();

  const sections = reportCatalogueSections();
</script>

<NavigationLayout navigationLabel="Reports" navigationWidth="standard">
  {#snippet navigation()}
    <CatalogueNavigation {sections} pathname={page.url.pathname} noun="reports" />
  {/snippet}

  {@render children()}
</NavigationLayout>
