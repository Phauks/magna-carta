<script lang="ts">
  /*
   * The matter's search, seated in the matter header's action rail. It renders from the matter
   * LAYOUT, so every section inherits it and no section can mount a second one — which is the
   * mechanical half of "the search is on every screen".
   *
   * TWO DIRECTIONS, TWO JOBS (owner's ruling, 2026-09-02). The icon opens to the inline START into
   * the field, which is for writing the query; and DOWNWARD into a settings block, which is for
   * aiming it — the scope, and whether deleted records join the answer. It deliberately does NOT
   * fill ScreenSearch's `scope` seam, which seats a scope control inside the field's leading edge:
   * spelling out "Everything on this matter" there took most of the width the field had on the
   * header line, and aiming a search is not part of typing it. That seam stays unwired.
   *
   * IT SITS ABOVE THE SECTION STRIP, NOT ON ITS ROW, and that is measured rather than aesthetic:
   * ScreenSearch always grows toward the inline start, so sharing the strip's row would shove the
   * tabs sideways on the first keystroke and make the strip's measured fold re-run mid-typing. That
   * is the file-manager ruling about New keeping its place, applied to a right-aligned rail.
   *
   * The panel is the fast path; most searches end in it. "Open full results" sits on the settings
   * row rather than under the results, so it cannot scroll away beneath a long answer, and leads to
   * the matter's own results page — the query rides in the address, so a search survives a reload
   * and can be handed to a colleague.
   */
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import MatterSearchResults from "$lib/matters/matter-search-results.svelte";
  import MatterSearchSettings from "$lib/matters/matter-search-settings.svelte";
  import {
    MatterSearch,
    defaultScope,
    scopeOptions,
    totalHits,
  } from "$lib/matters/matter-search.svelte.ts";
  import { sectionForPathname } from "$lib/matters/sections.ts";

  let { matterId }: { matterId: string } = $props();

  /** How many hits per source the panel asks for. The results page pays for depth; this does not. */
  const PANEL_LIMIT = 5;

  // Constructed empty and bound below, rather than from the prop: this control renders from the
  // matter LAYOUT, which SURVIVES a move between two matters, so reading the id once here would
  // leave a live search pointed at the matter the reader just left.
  const search = new MatterSearch("");
  let query = $state("");
  let expanded = $state(false);

  const currentSection = $derived(sectionForPathname(matterId, page.url.pathname));
  const options = $derived(scopeOptions(currentSection));
  // Moving to another matter resets the control outright. A query is about ONE case: carrying
  // "easement" from the Herrera file onto the Brown estate would answer a question nobody asked,
  // and carrying only the id while leaving the results on screen would be worse — the rows would
  // still name the previous matter.
  $effect(() => {
    const id = matterId;
    if (search.matterId === id) return;
    search.matterId = id;
    query = "";
    expanded = false;
    search.clear();
  });

  // The scope follows the reader between sections while the field is idle, so opening the search on
  // Files searches Files. Once there is a live query it stays put: re-scoping somebody's running
  // search underneath them because they navigated would throw away the answer they were reading.
  $effect(() => {
    const section = currentSection;
    if (query.trim() !== "") return;
    search.scope = defaultScope(section);
  });

  function run(next: string): Promise<void> {
    return search.run(fetch, next, search.sourcesForScope(options), PANEL_LIMIT);
  }

  function reRunForScope(next: string): void {
    search.scope = next;
    if (query.trim() === "") return;
    void run(query);
  }

  const resultsHref = $derived.by(() => {
    const parameters = new URLSearchParams({ q: query.trim() });
    if (search.scope !== "everything") parameters.set("in", search.scope);
    return `/matters/${matterId}/search?${parameters.toString()}`;
  });

  /*
   * The panel opens with the FIELD, not with the first keystroke — ScreenSearch renders the `panel`
   * snippet whenever it is expanded. Everything that decides where a query looks lives in there, and
   * gating it on a query put all of it behind a search you had to start in order to change where it
   * looked. Empty, the panel is its settings row and nothing else; the results region below only
   * exists once there is a query to answer.
   */
  const hasQuery = $derived(query.trim() !== "");

  /*
   * Through to the full search — from Enter, and from the panel's own link. Enter has to mean the
   * next thing rather than "search again": the panel is the fast path and is already showing by the
   * time a person could press it, so the whole result set, with room to act on it, is the only
   * thing left to go to.
   *
   * It works on an EMPTY field too, which is the point of the panel opening before anything is
   * typed. The results page carries its own empty state inviting a search, so arriving there with
   * no query lands on a screen that says what to do rather than a blank one.
   */
  function openFullResults(): void {
    expanded = false;
    void goto(resultsHref);
  }
</script>

<ScreenSearch
    bind:value={query}
    bind:expanded
    bind:busy={search.busy}
    label="Search this matter"
    searchOn="pause"
    fieldClass="w-2xs sm:w-xs"
    matchSummary={search.answer === null ? undefined : String(totalHits(search.answer))}
    onsearch={run}
    onsubmit={openFullResults}
  >
  {#snippet panel()}
    <!-- Not a dialog: the field keeps focus, so typing keeps narrowing what is underneath. The
         panel shrink-wraps this, so the width set here is the panel's own width. -->
    <div style="inline-size: min(var(--mc-size-prose), calc(100vw - var(--mc-space-32)))">
      <!--
        THE SETTINGS, which is what the control opens DOWNWARD into (owner's ruling, 2026-09-02).
        The field grows to the inline start and holds typing; everything that decides WHAT a query
        reaches sits under it. That split is why the scope is not on the field's leading edge: it is
        not part of writing the query, it is part of aiming it, and on the header line it took most
        of the width the field had.
      -->
      <div class="px-12 py-8">
        <MatterSearchSettings
          scope={search.scope}
          {options}
          onScope={reRunForScope}
          includeDeleted={search.includeDeleted}
          deletedApplies={search.deletedOptionApplies}
          onIncludeDeleted={(next) => {
            search.includeDeleted = next;
            if (hasQuery) void run(query);
          }}
        >
          {#snippet trailing()}
            <!-- The way out of the panel, on the settings row rather than below the results: a
                 reader may want to act on the whole result set, and this must not scroll away
                 under them. -->
            <a
              href={resultsHref}
              class={buttonClasses({ variant: "ghost", size: "sm" })}
              onclick={(event) => {
                event.preventDefault();
                openFullResults();
              }}
            >
              {hasQuery ? "Open full results" : "Open full search"}
              <ArrowRight class="size-16" aria-hidden="true" />
            </a>
          {/snippet}
        </MatterSearchSettings>
      </div>

      {#if hasQuery}
        <div
          class="mc-scrollbar overflow-y-auto border-t border-border-default p-8"
          style="max-block-size: var(--mc-size-record-pane)"
        >
          <MatterSearchResults
            answer={search.answer}
            failure={search.failure}
            busy={search.busy}
            onRetry={() => void run(query)}
            density="compact"
            onnavigate={() => (expanded = false)}
          />
        </div>
      {/if}
    </div>
  {/snippet}
</ScreenSearch>
