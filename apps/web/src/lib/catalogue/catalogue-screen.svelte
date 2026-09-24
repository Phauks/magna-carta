<script lang="ts">
  /*
   * THE CATALOGUE SCREEN — the whole framework a catalogue is presented in, assembled once.
   *
   * A screen hands over its title, its sections and where its view choice is remembered, and gets
   * the arrangement every catalogue shares: the screen header, and in its action row the product's
   * own screen search followed by the view switch; below them the sections in the chosen view, or
   * the honest statement that nothing answers to what was asked.
   *
   * WHY THE HOST DOES NOT ASSEMBLE THIS ITSELF. Tools and Reports each drew their own arrangement
   * and had already drifted apart — one had two views and a switch, the other had one view and no
   * way to search at all. The shared parts were all there (the screen header, the multi-view shell,
   * ScreenSearch); what was missing was one place that says how they sit together, so a correction
   * to the catalogue's shape lands once instead of once per catalogue.
   *
   * THE SEARCH IS THE PRODUCT'S ONE SCREEN SEARCH, on the standing rule that everything above the
   * data that is not the data is a single row, with searching as an icon control that opens when it
   * is needed. It answers on the keystroke, because a catalogue is already in the browser and a
   * request that never leaves the machine has nothing to wait for; the count of what survived sits
   * inside the field's trailing edge, where the eye already is.
   *
   * THE NARROWING IS OVER THE SECTIONS, not inside a view, so both views narrow identically and
   * switching views mid-search keeps the answer. The shell is handed the narrowed sections as its
   * items; a view never sees the query and never learns to search.
   */
  import EmptyState from "@magna-carta/design-system/empty-state";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import LayoutGrid from "@lucide/svelte/icons/layout-grid";
  import List from "@lucide/svelte/icons/list";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import type { PersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
  import { createViewShell } from "$lib/view-shell/view-shell.svelte.ts";
  import type { ViewDefinition } from "$lib/view-shell/view-shell-types.ts";
  import ViewShellBody from "$lib/view-shell/view-shell-body.svelte";
  import ViewSwitch from "$lib/view-shell/view-switch.svelte";
  import { countCatalogueEntries, type CatalogueSection } from "./catalogue.ts";
  import { filterCatalogue, matchSummary } from "./catalogue-search.ts";
  import type { CatalogueView } from "./catalogue-view.ts";
  import CatalogueListView from "./catalogue-list-view.svelte";
  import CatalogueTilesView from "./catalogue-tiles-view.svelte";

  let {
    title,
    sections,
    viewPreference,
    searchLabel,
    noun,
  }: {
    /** The screen's name, which is the destination's own name. */
    title: string;
    /** Everything the catalogue holds, in the order its registry declares. */
    sections: readonly CatalogueSection[];
    /** Where this catalogue's view choice is read and persisted. */
    viewPreference: PersistedPreference<CatalogueView>;
    /** The search's accessible name, naming the surface: "Search tools". */
    searchLabel: string;
    /** What the catalogue holds, plural and lower-case, for the nothing-found sentence. */
    noun: string;
  } = $props();

  let query = $state("");
  // What the screen is actually narrowed by, which the control decides the moment for. The field's
  // own text is `query`; nothing reads it to filter, so the two can never disagree about timing.
  let appliedQuery = $state("");

  const visible = $derived(filterCatalogue(sections, appliedQuery));
  const searching = $derived(appliedQuery.trim() !== "");
  const total = $derived(countCatalogueEntries(sections));
  const matched = $derived(countCatalogueEntries(visible));

  const views: ViewDefinition<CatalogueSection, CatalogueView>[] = [
    { id: "tiles", label: "Tile view", icon: LayoutGrid, view: CatalogueTilesView },
    { id: "list", label: "List view", icon: List, view: CatalogueListView },
  ];

  // The preference is a process-lifetime store its catalogue creates once at module scope, and the
  // shell holds it for as long as this screen exists — so it is read once here on purpose. A screen
  // does not swap one catalogue's remembered view for another's mid-life; it is a different screen.
  // svelte-ignore state_referenced_locally
  const shell = createViewShell({
    views,
    activeViewPreference: viewPreference,
    items: () => visible,
    itemKey: (section) => section.id,
  });
</script>

<ScreenHeader {title} class="mb-24">
  {#snippet actions()}
    <ScreenSearch
      bind:value={query}
      label={searchLabel}
      matchSummary={searching ? matchSummary(matched, total) : undefined}
      fieldClass="w-2xs sm:w-xs"
      onsearch={(next) => {
        appliedQuery = next;
      }}
    />
    <ViewSwitch controller={shell} label="Choose a view" />
  {/snippet}
</ScreenHeader>

<!-- The two ways a catalogue can show nothing are different facts and are never said in the same
     words: a query that reached nothing is undone by clearing it, and a catalogue holding nothing
     is not. A tool catalogue reaches the second when a member holds no tool permission at all. -->
{#if visible.length === 0 && searching}
  <EmptyState title="Nothing Matches That">
    No {noun} answer to what is asked. Clearing the search brings the whole catalogue back.
  </EmptyState>
{:else if visible.length === 0}
  <EmptyState title="Nothing Here">
    No {noun} are available to you.
  </EmptyState>
{:else}
  <ViewShellBody controller={shell} />
{/if}
