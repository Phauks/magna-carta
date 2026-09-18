<script lang="ts">
  /*
   * The matter's search results, as a page rather than only a panel — a reader may want to act on
   * or download the whole result set, and a panel under a field cannot carry that.
   *
   * THE QUERY RIDES IN THE ADDRESS. `?q=` and `?in=` are the state, so a search survives a reload
   * and can be handed to a colleague, and the browser's own back button walks a reader's searches.
   * The trade taken with it, stated rather than glossed: a fragment of a matter's text lands in
   * browser history, on a URL that already names the matter.
   *
   * The field sits in the view's own header, where the ruling puts it, with the scope and the match
   * count on the row BENEATH it — never in the middle of the page above however many rows came
   * back. That stacking is the header control's arrangement applied to a page: writing the query
   * above, aiming it below, through the one MatterSearchSettings both surfaces render.
   */
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import MatterSearchResults from "$lib/matters/matter-search-results.svelte";
  import MatterSearchSettings from "$lib/matters/matter-search-settings.svelte";
  import {
    EVERYTHING_SCOPE,
    MatterSearch,
    scopeOptions,
    totalHits,
  } from "$lib/matters/matter-search.svelte.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";
  import { matterSections } from "$lib/matters/sections.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  /** The results page pays for depth where the panel does not. */
  const PAGE_LIMIT = 50;

  const matter = $derived(data.matter);
  // Empty at construction and bound in the effect below — reading the id once here would capture
  // the matter the page first rendered for rather than the one it is showing.
  const search = new MatterSearch("");

  // The address is the state. Reading the query and scope FROM it rather than holding a second copy
  // is what makes a reload, a shared link and the back button all land on the same search.
  const addressQuery = $derived(page.url.searchParams.get("q") ?? "");
  const addressScope = $derived(page.url.searchParams.get("in") ?? EVERYTHING_SCOPE);

  let field = $state("");
  $effect(() => {
    field = addressQuery;
  });

  // The scope list here names no "this section": a reader on the results page is not standing on a
  // section, so the first option would be a fiction.
  const options = $derived(scopeOptions(undefined));

  function addressFor(query: string, scope: string): string {
    const parameters = new URLSearchParams({ q: query.trim() });
    if (scope !== EVERYTHING_SCOPE) parameters.set("in", scope);
    return `/matters/${matter.id}/search?${parameters.toString()}`;
  }

  $effect(() => {
    const query = addressQuery;
    const scope = addressScope;
    search.matterId = matter.id;
    search.scope = scope;
    if (query.trim() === "") {
      search.clear();
      return;
    }
    const sources = options.find((option) => option.value === scope)?.sources ?? [];
    void search.run(fetch, query, sources, PAGE_LIMIT);
  });

  /** The same question again, for the region's stalled line and the notice's Retry. */
  function retrySearch(): void {
    const sources = options.find((option) => option.value === addressScope)?.sources ?? [];
    void search.run(fetch, addressQuery, sources, PAGE_LIMIT);
  }

  // Typing in the header field rewrites the address, which re-runs the search through the effect
  // above. One path, so the field and the address can never say different things.
  function submit(next: string): void {
    if (next.trim() === addressQuery.trim()) return;
    void goto(addressFor(next, addressScope), { replaceState: true, keepFocus: true });
  }

  const scopeLabel = $derived(
    options.find((option) => option.value === addressScope)?.label ?? "Everything on this matter",
  );
  const sectionLabel = $derived(
    matterSections.find((section) => section.slug === addressScope)?.label ?? null,
  );
</script>

<svelte:head>
  <title>Search · {matter.title} · Magna Carta</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col">
  <!--
    THE VIEW'S HEADER, in the SAME arrangement as the header control: the field on top, and
    everything that decides what it reaches on the row beneath. The control expresses "beneath" as
    its downward panel and this page as a row, because a page has no popover to open — but the order
    and the component are one, so a person who learns where the scope lives in the header finds it
    in the same place here.
  -->
  <div class="flex flex-col gap-12 border-b border-border-default pb-12">
    <ScreenSearch
      bind:value={field}
      expanded
      busy={search.busy}
      label="Search this matter"
      searchOn="pause"
      fieldClass="w-xs sm:w-sm"
      onsearch={submit}
    />

    <MatterSearchSettings
      scope={addressScope}
      {options}
      onScope={(next) => void goto(addressFor(field, next), { replaceState: true })}
      includeDeleted={search.includeDeleted}
      deletedApplies={search.deletedOptionApplies}
      onIncludeDeleted={(next) => {
        search.includeDeleted = next;
        // Re-running rather than filtering what is on screen: the deleted rows were never
        // fetched, so there is nothing here to filter.
        if (addressQuery.trim() !== "") {
          const sources = options.find((option) => option.value === addressScope)?.sources ?? [];
          void search.run(fetch, addressQuery, sources, PAGE_LIMIT);
        }
      }}
    >
      {#snippet trailing()}
        {#if search.answer !== null}
          <span class="text-sm text-text-muted">
            {totalHits(search.answer)} on this page, in {scopeLabel.toLowerCase()}
          </span>
        {/if}
      {/snippet}
    </MatterSearchSettings>
  </div>

  <!-- The result region is furniture: it holds its shape at rest, so arriving results fill a frame
       the reader already has rather than appearing out of nothing. -->
  <div class="mc-scrollbar min-h-0 flex-1 overflow-y-auto pt-16">
    {#if addressQuery.trim() === ""}
      <p class="text-sm text-text-muted">
        {#if sectionLabel === null}
          Search everything on this matter — files, parties, notes and what the firm holds in
          custody.
        {:else}
          Searching {sectionLabel} on this matter.
        {/if}
      </p>
    {:else}
      <MatterSearchResults
        answer={search.answer}
        failure={search.failure}
        busy={search.busy}
        onRetry={retrySearch}
        density="comfortable"
      />
    {/if}
  </div>
</div>
