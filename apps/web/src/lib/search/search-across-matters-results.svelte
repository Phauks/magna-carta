<script lang="ts">
  /*
   * The answer to a search across matters, rendered: one group to a place, never one merged list.
   *
   * It is the matter search's results ($lib/matters/matter-search-results.svelte) with the one
   * thing a reader standing outside a matter needs added: every record names the matter it is on.
   * The two share the presentation registry, so a place wears the same icon and heading in both.
   *
   * THE OVERVIEW SHOWS A FEW FROM EACH PLACE THAT ANSWERED, and a place with nothing in it is left
   * to the list of places beside the results, where it reads as a zero. A CHOSEN PLACE shows a
   * full page from that place alone.
   *
   * NO TOTALS. A group says how many results are on screen and whether there are more, which the
   * server measured by reading one row past the limit. It never says "3 of 14": nothing counted
   * to fourteen.
   *
   * THE READER'S WORDS ARE MARKED WHERE THE SERVER FOUND THEM. Each hit says where they are in its
   * title and its excerpt, and a long text arrives already cut to the stretch they are in. This
   * component draws those marks and looks for nothing itself.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { SAMPLE_SENTENCE } from "@magna-carta/design-system/loading-fixtures";
  import { formatInstant, instantAttribute } from "@magna-carta/design-system/formatters";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import Users from "@lucide/svelte/icons/users";
  import type { Component, Snippet } from "svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { DirectorySearchHit } from "$lib/directory/directory-api.ts";
  import { entityRecordHref } from "$lib/directory/entity-presentation.ts";
  import { emptyGroupLine, presentationFor } from "$lib/matters/matter-search-presentation.ts";
  import { matterStatusPresentation } from "$lib/matters/matter-status.ts";
  import type { MatterSummary } from "$lib/matters/matters-api.ts";
  import MarkedText from "$lib/search/marked-text.svelte";
  import type { AcrossMattersGroup } from "$lib/search/search-across-matters-api.ts";
  import {
    OVERVIEW_LIMIT,
    PEOPLE_NOT_SEARCHED_REASON,
    PLACE_LIMIT,
    type NameGroup,
    type SearchOverview,
  } from "$lib/search/search-across-matters.svelte.ts";
  import {
    ALL_PLACES,
    MATTERS_PLACE,
    PEOPLE_PLACE,
    isRecordPlace,
    searchAddress,
  } from "$lib/search/search-address.ts";

  let {
    overview,
    placeGroup,
    chosen,
    failure,
    busy,
    onRetry,
  }: {
    overview: SearchOverview | null;
    /** A full page from the chosen record place, or null where none is chosen or it has not landed. */
    placeGroup: AcrossMattersGroup | null;
    /** The place the address names. */
    chosen: string;
    failure: StatedFailure | null;
    busy: boolean;
    onRetry?: () => void;
  } = $props();

  const everyPlace = $derived(chosen === ALL_PLACES);
  const nameLimit = $derived(everyPlace ? OVERVIEW_LIMIT : PLACE_LIMIT);

  // The record groups on screen: in the overview, each place that found something; with a place
  // chosen, that place's own page once it has landed.
  const recordGroups = $derived.by((): readonly AcrossMattersGroup[] => {
    if (overview === null) return [];
    if (everyPlace) {
      return (overview.records?.groups ?? []).filter((group) => group.hits.length > 0);
    }
    if (!isRecordPlace(chosen)) return [];
    return placeGroup !== null && placeGroup.source === chosen ? [placeGroup] : [];
  });

  const showsMatters = $derived(everyPlace || chosen === MATTERS_PLACE);
  const showsPeople = $derived(everyPlace || chosen === PEOPLE_PLACE);

  function nameGroupVisible<Row>(group: NameGroup<Row>): boolean {
    // In the overview a place with nothing to show is left to the list beside the results, and so
    // is one the reader's choice of matters set aside: the list beside the results names it. A
    // chosen place always renders, because the reader asked for it and the absence is the answer.
    if (group.standing === "not-searched") return !everyPlace;
    return !everyPlace || group.rows.length > 0 || group.standing !== "answered";
  }

  const foundSomething = $derived(
    overview !== null &&
      (overview.matters.rows.length > 0 ||
        overview.people.rows.length > 0 ||
        (overview.records?.groups ?? []).some((group) => group.hits.length > 0)),
  );

  // A chosen record place whose page has not landed yet, over an overview that has.
  const placePending = $derived(
    overview !== null && isRecordPlace(chosen) && recordGroups.length === 0 && busy,
  );

  // "file names and folder names", the way a sentence lists two things.
  const FIELD_LIST = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

  function matterLabel(matter: { title: string; number: string | null }): string {
    return matter.number === null ? matter.title : `${matter.number} ${matter.title}`;
  }

  function matterNumber(matter: MatterSummary): string | null {
    return matter.matterNumber ?? matter.consultationNumber ?? matter.intakeNumber;
  }

  function nameStandingLine(standing: NameGroup<unknown>["standing"], what: string): string {
    if (standing === "no-access") return `Your role does not include reading ${what}.`;
    if (standing === "not-searched") return PEOPLE_NOT_SEARCHED_REASON;
    return `${what.charAt(0).toUpperCase()}${what.slice(1)} could not be searched just now.`;
  }

  /** How a person's matched name should be explained, where it is not the name on the row. */
  function matchedNameLine(hit: DirectorySearchHit): string | null {
    if (hit.matchedNameIsCurrent || hit.matchedName === hit.displayName) return null;
    return `Matched on ${hit.matchedNameRole} name: ${hit.matchedName}`;
  }

  const SEARCH_FIXTURE = [
    { source: "files", titles: ["Engagement letter.pdf", "Discovery plan.docx"] },
    { source: "notes", titles: ["Status conference"] },
  ] as const;
</script>

{#snippet failureNotice()}
  {#if failure !== null}
    <FailureNotice
      failure={failure.failure}
      subject="The firm's records"
      title="The Search Could Not Be Run"
      fallback={failure.fallback}
      whenSilent={failure.whenSilent}
    />
  {/if}
{/snippet}

{#snippet groupFrame(
  Icon: Component,
  heading: string,
  detail: string | null,
  body: Snippet,
  more: string | null,
)}
  <section class="rounded-md border border-border-default bg-surface-raised">
    <header class="flex items-baseline gap-12 border-b border-border-default px-16 py-12">
      <Icon class="size-16 self-center text-text-muted" aria-hidden="true" />
      <h2 class="text-sm font-semibold text-text-default">{heading}</h2>
      {#if detail !== null}
        <span class="text-xs text-text-muted">{detail}</span>
      {/if}
    </header>
    {@render body()}
    {#if more !== null}
      <footer class="border-t border-border-default px-16 py-8">
        <a
          href={more}
          class="text-sm font-medium text-text-default underline-offset-4 hover:underline"
        >
          Show More {heading}
        </a>
      </footer>
    {/if}
  </section>
{/snippet}

<LoadingRegion
  loading={overview === null && busy}
  failed={failure !== null}
  {onRetry}
  refreshing={overview !== null && busy}
  label="Searching the matters you can see"
  failure={failureNotice}
>
  {#snippet fixture()}
    <div class="flex flex-col gap-16">
      {#each SEARCH_FIXTURE as group (group.source)}
        {@const presentation = presentationFor(group.source)}
        <section class="rounded-md border border-border-default bg-surface-raised">
          <header class="flex items-baseline gap-12 border-b border-border-default px-16 py-12">
            <h2 class="text-sm font-semibold text-text-default">{presentation.heading}</h2>
          </header>
          <ul class="divide-y divide-border-default">
            {#each group.titles as title (title)}
              <li class="flex flex-col gap-4 px-16 py-12">
                <span class="text-sm font-medium text-text-default">{title}</span>
                <span class="line-clamp-2 text-xs text-text-muted">{SAMPLE_SENTENCE}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/snippet}

  {#if overview !== null}
    <div class="flex flex-col gap-16">
      {#if overview.records?.broad === true}
        <Alert.Root variant="info">
          <Alert.Title>Showing The Most Recent Matches</Alert.Title>
          <Alert.Description>
            These words appear in too many records to search at once, so only the most recent matches are shown. Add a word to narrow the search.
          </Alert.Description>
        </Alert.Root>
      {/if}

      {#if everyPlace && !foundSomething && failure === null}
        <p class="text-sm text-text-muted">No Results</p>
      {/if}

      {#if showsMatters && nameGroupVisible(overview.matters)}
        {@const matters = overview.matters}
        {#snippet mattersBody()}
          {#if matters.standing !== "answered"}
            <p class="px-16 py-12 text-sm text-text-muted">
              {nameStandingLine(matters.standing, "matters")}
            </p>
          {:else if matters.rows.length === 0}
            <p class="px-16 py-12 text-sm text-text-muted">No Results</p>
          {:else}
            <ul class="divide-y divide-border-default">
              {#each matters.rows.slice(0, nameLimit) as matter (matter.id)}
                {@const status = matterStatusPresentation(matter.status)}
                {@const number = matterNumber(matter)}
                <li>
                  <a
                    href={`/matters/${matter.id}`}
                    class="flex flex-col gap-4 px-16 py-12 transition-colors duration-fast
                           ease-standard hover:bg-surface-subtle"
                  >
                    <span class="text-sm font-medium text-text-default">{matter.title}</span>
                    <span class="flex flex-wrap items-center gap-8 text-xs text-text-muted">
                      {#if number !== null}
                        <Badge variant="neutral">{number}</Badge>
                      {/if}
                      <Badge variant={status.variant}>{status.label}</Badge>
                      {#if matter.clientDisplayName !== null}
                        <span>Client: {matter.clientDisplayName}</span>
                      {/if}
                    </span>
                  </a>
                </li>
              {/each}
            </ul>
          {/if}
        {/snippet}
        {@render groupFrame(
          FolderOpen,
          "Matters",
          "Matched on title, number and client",
          mattersBody,
          everyPlace && (matters.rows.length > OVERVIEW_LIMIT || matters.more)
            ? searchAddress(overview.query, MATTERS_PLACE, overview.reach)
            : null,
        )}
      {/if}

      {#if showsPeople && nameGroupVisible(overview.people)}
        {@const people = overview.people}
        {#snippet peopleBody()}
          {#if people.standing !== "answered"}
            <p class="px-16 py-12 text-sm text-text-muted">
              {nameStandingLine(people.standing, "the directory")}
            </p>
          {:else if people.rows.length === 0}
            <p class="px-16 py-12 text-sm text-text-muted">No Results</p>
          {:else}
            <ul class="divide-y divide-border-default">
              {#each people.rows.slice(0, nameLimit) as hit (hit.entityId)}
                {@const matched = matchedNameLine(hit)}
                <li>
                  <a
                    href={entityRecordHref(hit.entityId)}
                    class="flex flex-col gap-4 px-16 py-12 transition-colors duration-fast
                           ease-standard hover:bg-surface-subtle"
                  >
                    <span class="text-sm font-medium text-text-default">{hit.displayName}</span>
                    {#if matched !== null}
                      <span class="text-xs text-text-muted">{matched}</span>
                    {/if}
                  </a>
                </li>
              {/each}
            </ul>
          {/if}
        {/snippet}
        {@render groupFrame(
          Users,
          "People",
          "Matched on every name the directory holds, current and former",
          peopleBody,
          everyPlace && (people.rows.length > OVERVIEW_LIMIT || people.more)
            ? searchAddress(overview.query, PEOPLE_PLACE, overview.reach)
            : null,
        )}
      {/if}

      {#each recordGroups as group (group.source)}
        {@const presentation = presentationFor(group.source)}
        {#snippet recordsBody()}
          {#if group.hits.length === 0}
            <p class="px-16 py-12 text-sm text-text-muted">
              {#if group.skipped === null}
                No Results
              {:else if group.skipped === "one-matter-only"}
                {presentation.heading} is searched from inside a matter, with that matter's own
                search.
              {:else}
                {emptyGroupLine(group.skipped, group.source)}
              {/if}
            </p>
          {:else}
            <ul class="divide-y divide-border-default">
              {#each group.hits as hit (hit.id)}
                <li>
                  <a
                    href={hit.link}
                    class="flex flex-col gap-4 px-16 py-12 transition-colors duration-fast
                           ease-standard hover:bg-surface-subtle"
                  >
                    <span class="text-sm font-medium text-text-default">
                      {#if presentation.titleKind === "instant"}
                        <time datetime={instantAttribute(hit.title)}>
                          {formatInstant(hit.title)}
                        </time>
                      {:else}
                        <MarkedText text={hit.title} marks={hit.titleMarks} />
                      {/if}
                    </span>
                    {#if hit.snippet !== null}
                      <span class="line-clamp-2 text-sm text-text-muted">
                        <MarkedText text={hit.snippet} marks={hit.snippetMarks} />
                      </span>
                    {/if}
                    <span class="flex flex-wrap items-center gap-8 text-xs text-text-muted">
                      <Badge variant="neutral">{matterLabel(hit.matter)}</Badge>
                      {#if hit.secondary !== null}
                        <span>{hit.secondary}</span>
                      {/if}
                    </span>
                  </a>
                </li>
              {/each}
            </ul>
            {#if !everyPlace && group.hasMore}
              <p class="border-t border-border-default px-16 py-8 text-xs text-text-muted">
                More matches than shown. Add a word to narrow the search.
              </p>
            {/if}
          {/if}
        {/snippet}
        {@render groupFrame(
          presentation.icon,
          presentation.heading,
          group.matchedFields.length > 0
            ? `Matched on ${FIELD_LIST.format(group.matchedFields)}`
            : null,
          recordsBody,
          everyPlace && group.hasMore
            ? searchAddress(overview.query, group.source, overview.reach)
            : null,
        )}
      {/each}

      {#if placePending}
        <p class="text-sm text-text-muted">Reading this place.</p>
      {/if}
    </div>
  {/if}
</LoadingRegion>
