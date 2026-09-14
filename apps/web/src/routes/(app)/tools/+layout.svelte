<script lang="ts">
  /*
   * The Tools shell — a two-sided screen on the design system's NavigationLayout: every tool the
   * member may open in the navigation column, grouped by subject, with the one they are on lit;
   * the tool itself in the content column beside it. The owner's ruling of 2026-09-11 is that a
   * screen with a navigational menu on the left and content on the right is ONE component, and
   * that it reaches Tools and Reports as much as Settings and Magnus — which for Tools is a
   * redesign rather than a swap of frame, because until now a tool was reached through a landing
   * page and left through its header's way back, with nothing beside it.
   *
   * THE COLUMN READS THE SAME PROJECTION AS THE LANDING SCREEN (tool-catalogue.ts), so the
   * registry stays the one source: a tool added to the catalog appears in the column, on the
   * landing index and in the command palette with no edit here. The landing route keeps its
   * index in the content column — the descriptive line, the search and the two views live there,
   * where a reader goes to find out what a tool does — so the column is never beside nothing.
   *
   * WHO SCROLLS IS THE PAGE'S CALL. The content column is the page's scroll region by default. A
   * tool that stages its own full-height frame (the File Workbench, the Safe Website Viewer)
   * declares so in its route's page data (content-column.ts) and the column becomes a bare
   * full-height stack that the page fills; otherwise its middle would draw a second scrollbar
   * inside a column that had already reserved a gutter for one.
   *
   * THE WAY BACK STAYS ON EACH TOOL'S HEADER. A route inside a two-sided screen is still a screen
   * under a screen, and `back="tools"` on its ScreenHeader is what the back-navigation gate reads;
   * the column is a finding aid beside it, not a replacement for it.
   */
  import type { Snippet } from "svelte";
  import NavigationLayout from "@magna-carta/design-system/navigation-layout";
  import { page } from "$app/state";
  import CatalogueNavigation from "$lib/tools/catalogue-navigation.svelte";
  import { contentColumnScrolls } from "$lib/tools/content-column.ts";
  import { toolCatalogueSections } from "$lib/tools/tool-catalogue.ts";

  let { children }: { children: Snippet } = $props();

  const sections = toolCatalogueSections();
  const contentScrolls = $derived(contentColumnScrolls(page.data));
</script>

<NavigationLayout navigationLabel="Tools" navigationWidth="standard" {contentScrolls}>
  {#snippet navigation()}
    <CatalogueNavigation {sections} pathname={page.url.pathname} noun="tools" />
  {/snippet}

  {@render children()}
</NavigationLayout>
