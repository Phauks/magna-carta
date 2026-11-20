<script lang="ts">
  /*
   * Search: one question, asked of every matter the reader may see, narrowed by the filters in the
   * panel beside the results.
   *
   * It is reached from the top bar. The palette there finds the application's own screens as it
   * always has; its last row sends whatever was typed here, where the firm's records are searched.
   * A matter's own search stays where it is, inside the matter, and reaches more of that one
   * matter than this page does: its calendar, among others. The panel marks those places.
   *
   * THE QUESTION AND THE FILTERS RIDE IN THE ADDRESS (search-address.ts), so a search survives a
   * reload, the back button walks a reader's searches, and a search can be sent to a colleague.
   * The trade taken with it: the words searched for land in browser history.
   *
   * THE READER MAY ASK FEWER MATTERS, NEVER MORE. Every filter takes away; the server decides what
   * the reader may see and composes the filters inside that.
   *
   * ON A NARROW SCREEN THE PANEL FOLDS AWAY above the results, opened by a Filters button that says
   * how many are set, so the results come first.
   */
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { untrack } from "svelte";
  import Button from "@magna-carta/design-system/button";
  import { formatDate } from "@magna-carta/design-system/formatters";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
  import X from "@lucide/svelte/icons/x";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import SearchAcrossMattersResults from "$lib/search/search-across-matters-results.svelte";
  import { SearchAcrossMatters, panelPlaces } from "$lib/search/search-across-matters.svelte.ts";
  import {
    EVERYTHING,
    NO_FILTERS,
    filtersFromAddress,
    searchAddress,
    type SearchDays,
    type SearchFilters,
  } from "$lib/search/search-address.ts";
  import SearchFilterPanel from "$lib/search/search-filter-panel.svelte";
  import { filterCount } from "$lib/search/search-filters.ts";

  const search = new SearchAcrossMatters();

  // The address is the state. Reading the question and the filters FROM it, and holding no second
  // copy, is what makes a reload, a shared link and the back button all land on the same search.
  const addressQuery = $derived(page.url.searchParams.get("q") ?? "");
  // Held by the address's own text, so a new URL object naming the same search does not ask again.
  const addressSearch = $derived(page.url.search);
  const filters = $derived.by((): SearchFilters => {
    void addressSearch;
    return filtersFromAddress(page.url.searchParams);
  });

  let field = $state("");
  $effect(() => {
    field = addressQuery;
  });

  // Only the address drives a search. The model reads its own answer to decide what to ask again,
  // and that read must not make the answer a reason to run once more.
  $effect(() => {
    const query = addressQuery;
    const chosen = filters;
    untrack(() => void search.run(fetch, query, chosen));
  });

  function retrySearch(): void {
    search.clear();
    void search.run(fetch, addressQuery, filters);
  }

  // Typing rewrites the address, which re-runs the search through the effect above. One path, so
  // the field and the address can never say different things. The filters stay: they were chosen
  // for the reader's work, not for one question.
  function submit(next: string): void {
    if (next.trim() === addressQuery.trim()) return;
    void goto(searchAddress(next, filters), { replace: true, reset: false });
  }

  // A change of filter is a step the back button returns from.
  function applyFilters(next: SearchFilters): void {
    void goto(searchAddress(addressQuery, next), { reset: false });
  }

  const places = $derived(panelPlaces(search.answer, filters));
  const asked = $derived(addressQuery.trim() !== "");
  const setCount = $derived(filterCount(filters));
  let filtersOpen = $state(false);

  $effect(() => {
    if (filters.by !== null) void firmRoster.load(fetch);
  });

  function memberName(userId: string): string {
    return firmRoster.members?.find((member) => member.userId === userId)?.displayName ?? "";
  }

  function daysLabel(days: SearchDays): string {
    if (days.from !== undefined && days.to !== undefined) {
      return days.from === days.to
        ? formatDate(days.from)
        : `${formatDate(days.from)} to ${formatDate(days.to)}`;
    }
    if (days.from !== undefined) return `Since ${formatDate(days.from)}`;
    return `Through ${formatDate(days.to ?? "")}`;
  }

  // The filters in force, one tag each, above the results: what is set, and a way to take it off.
  const tags = $derived.by(() => {
    const list: { key: string; label: string; clear: Partial<SearchFilters> }[] = [];
    if (filters.places !== null) {
      const count = filters.places.length;
      list.push({ key: "places", label: count === 1 ? "1 Place" : `${count} Places`, clear: { places: null } });
    }
    const reach = filters.reach;
    if (reach.kind === "mine") list.push({ key: "reach", label: "My Matters", clear: { reach: EVERYTHING } });
    if (reach.kind === "client") list.push({ key: "reach", label: "One Client", clear: { reach: EVERYTHING } });
    if (reach.kind === "matters") {
      const count = reach.matterIds.length;
      list.push({ key: "reach", label: count === 1 ? "1 Matter" : `${count} Matters`, clear: { reach: EVERYTHING } });
    }
    if (filters.days !== null) list.push({ key: "days", label: daysLabel(filters.days), clear: { days: null } });
    if (filters.by !== null) {
      const name = memberName(filters.by);
      list.push({ key: "by", label: name === "" ? "One Person" : `By ${name}`, clear: { by: null } });
    }
    return list;
  });
</script>

<svelte:head>
  <title>Search · Magna Carta</title>
</svelte:head>

<div class="flex h-full min-h-0 flex-col gap-16">
  <ScreenHeader title="Search" />

  <div class="flex flex-col gap-12 border-b border-border-default pb-12">
    <ScreenSearch
      bind:value={field}
      expanded
      busy={search.busy}
      label="Search every matter you can see"
      searchOn="pause"
      fieldClass="w-full sm:w-md"
      onsearch={submit}
    />
    {#if tags.length > 0 || asked}
      <div class="flex flex-wrap items-center gap-8">
        <Button
          variant="secondary"
          size="sm"
          class="lg:hidden"
          aria-expanded={filtersOpen}
          onclick={() => (filtersOpen = !filtersOpen)}
        >
          <SlidersHorizontal class="size-16" aria-hidden="true" />
          {setCount === 0 ? "Filters" : `Filters (${setCount})`}
        </Button>
        {#each tags as tag (tag.key)}
          <button
            type="button"
            class={[
              "inline-flex items-center gap-4 rounded-sm bg-surface-subtle px-8 py-4 text-xs",
              "font-medium whitespace-nowrap text-text-default transition-colors duration-fast",
              "ease-standard hover:bg-surface-selected",
            ]}
            aria-label="Remove filter: {tag.label}"
            onclick={() => applyFilters({ ...filters, ...tag.clear })}
          >
            {tag.label}
            <X class="size-12" aria-hidden="true" />
          </button>
        {/each}
        {#if tags.length > 0}
          <button
            type="button"
            class="text-xs text-text-default underline underline-offset-2 hover:text-text-muted"
            onclick={() => applyFilters(NO_FILTERS)}
          >
            Clear All
          </button>
        {/if}
      </div>
    {/if}
  </div>

  <div class="mc-scrollbar min-h-0 flex-1 overflow-y-auto">
    {#if !asked}
      <p class="text-sm text-text-muted">
        Type a name, a number or a few words. The filters beside the results narrow what is searched.
      </p>
    {:else}
      <div class="flex flex-col gap-24 lg:flex-row lg:items-start">
        <aside
          aria-label="Filters"
          class={[
            "w-full shrink-0 border-b border-border-default pb-16 lg:block lg:w-2xs lg:border-b-0 lg:pb-0",
            filtersOpen ? "block" : "hidden",
          ]}
        >
          <SearchFilterPanel {filters} {places} onChange={applyFilters} />
        </aside>

        <div class="min-w-0 flex-1 pb-24">
          <SearchAcrossMattersResults
            answer={search.answer}
            failure={search.failure}
            busy={search.busy}
            authorName={memberName}
            onRetry={retrySearch}
          />
        </div>
      </div>
    {/if}
  </div>
</div>
