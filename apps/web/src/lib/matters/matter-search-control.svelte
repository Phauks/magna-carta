<script lang="ts">
  /*
   * The matter's search, seated in the matter header's action rail. It renders from the matter
   * LAYOUT, so every section inherits it and no section can mount a second one — which is the
   * mechanical half of "the search is on every screen".
   *
   * It is the design system's ScreenSearch with its `scope` seam filled, and it is that seam's first
   * production consumer: the component ships the seam naming a matter scope dropdown as the thing
   * that would sit there, and this is it. Nothing in the design system changed to build this.
   *
   * IT SITS ABOVE THE SECTION STRIP, NOT ON ITS ROW, and that is measured rather than aesthetic:
   * ScreenSearch always grows toward the inline start, so sharing the strip's row would shove the
   * tabs sideways on the first keystroke and make the strip's measured fold re-run mid-typing. That
   * is the file-manager ruling about New keeping its place, applied to a right-aligned rail.
   *
   * The panel is the fast path; most searches end in it. "Open full results" sits on the scope line,
   * where the ruling puts it, and leads to the matter's own results page — the query rides in the
   * address, so a search survives a reload and can be handed to a colleague.
   */
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import * as Select from "@magna-carta/design-system/select";
  import Badge from "@magna-carta/design-system/badge";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import MatterSearchResults from "$lib/matters/matter-search-results.svelte";
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
  const scopeLabel = $derived(
    options.find((option) => option.value === search.scope)?.label ?? "Scope",
  );

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
   * The panel opens with the FIELD, not with the first keystroke. Two things live in its header
   * that a person needs before they have typed anything — the scope, and the way through to the
   * full search — and gating the panel on a query put both behind a search you had to start in
   * order to change where it looked. Expanded and empty, the panel is its header row and nothing
   * else; the results region below only exists once there is a query to answer.
   */
  const panelOpen = $derived(expanded);
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

<div class="relative">
  <ScreenSearch
    bind:value={query}
    bind:expanded
    bind:busy={search.busy}
    label="Search this matter"
    placeholder={placeholderOf("Search this matter")}
    searchOn="pause"
    fieldClass="w-2xs sm:w-xs"
    matchSummary={search.answer === null ? undefined : String(totalHits(search.answer))}
    onsearch={run}
    onsubmit={openFullResults}
  >
    {#snippet scope()}
      <!-- The vocabulary names the matter and no wider: searching everything is the top bar's job,
           not this control's. A section with no source is present and DISABLED with the line saying
           what it waits on, never omitted. -->
      <Select.Root
        type="single"
        items={options.map((option) => ({ value: option.value, label: option.label }))}
        allowDeselect={false}
        bind:value={() => search.scope, (next) => reRunForScope(next as string)}
      >
        <Select.Trigger aria-label="Search in">
          <Select.Value placeholder={placeholderOf("Scope")} />
        </Select.Trigger>
        <Select.Content>
          {#each options as option (option.value)}
            <Select.Item
              value={option.value}
              label={option.label}
              disabled={option.waitingOn !== undefined}
            >
              {option.label}
              {#if option.waitingOn !== undefined}
                <Badge variant="neutral" class="ms-auto">Soon</Badge>
              {/if}
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    {/snippet}
  </ScreenSearch>

  {#if panelOpen}
    <!-- The panel hangs from the field's own edge. It is not a dialog: the field keeps focus, so
         typing keeps narrowing what is underneath. -->
    <div
      class="absolute end-0 mt-4 rounded-md border border-border-default bg-surface-raised shadow-lg"
      style="z-index: var(--mc-z-dropdown);
             inline-size: min(var(--mc-size-prose), calc(100vw - var(--mc-space-32)))"
    >
      <div
        class="flex items-center gap-8 px-12 py-8"
        class:border-b={hasQuery}
        class:border-border-default={hasQuery}
      >
        <span class="text-xs text-text-muted">{scopeLabel}</span>
        {#if search.deletedOptionApplies}
          <!-- Off by default, and offered only where a selected source has a deleted set to offer —
               which the SERVER says, on the answer, rather than this control keeping its own list.
               A deleted record joins the results marked as deleted; it never comes back looking
               live, because somebody would act on a document that is no longer in the matter. -->
          <label class="flex items-center gap-4 text-xs text-text-muted">
            <Checkbox
              bind:checked={
                () => search.includeDeleted,
                (next) => {
                  search.includeDeleted = next === true;
                  if (query.trim() !== "") void run(query);
                }
              }
            />
            Include deleted
          </label>
        {/if}
        <!-- On the scope line, where the ruling puts it: a reader may want to act on the whole
             result set, and a panel cannot carry that. -->
        <a
          href={resultsHref}
          class="{buttonClasses({ variant: 'ghost', size: 'sm' })} ms-auto"
          onclick={(event) => {
            event.preventDefault();
            openFullResults();
          }}
        >
          {hasQuery ? "Open full results" : "Open full search"}
          <ArrowRight class="size-16" aria-hidden="true" />
        </a>
      </div>
      {#if hasQuery}
        <div class="overflow-y-auto p-8" style="max-block-size: var(--mc-size-record-pane)">
          <MatterSearchResults
            answer={search.answer}
            failure={search.failure}
            busy={search.busy}
            density="compact"
            onnavigate={() => (expanded = false)}
          />
        </div>
      {/if}
    </div>
  {/if}
</div>
