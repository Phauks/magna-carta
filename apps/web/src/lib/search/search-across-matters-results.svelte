<script lang="ts">
  /*
   * The answer to a search across matters, rendered as one list, newest first.
   *
   * Every record names the place it came from and the matter it is on, so a list mixing notes,
   * files and time still reads at a glance. Matters and people found by name have no date, so
   * where the reader ticked them they come first, in their own short lists, before the dated ones.
   *
   * NO TOTALS. The list says when a place holds more than it answered with, which the server
   * measured by reading one row past the limit. It never says "3 of 14": nothing counted to
   * fourteen.
   *
   * THE READER'S WORDS ARE MARKED WHERE THE SERVER FOUND THEM. Each hit says where they are in its
   * title and its excerpt, and a long text arrives already cut to the stretch they are in. This
   * component draws those marks and looks for nothing itself.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { SAMPLE_SENTENCE } from "@magna-carta/design-system/loading-fixtures";
  import {
    formatDate,
    formatInstant,
    instantAttribute,
  } from "@magna-carta/design-system/formatters";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import Users from "@lucide/svelte/icons/users";
  import type { Component, Snippet } from "svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { DirectorySearchHit } from "$lib/directory/directory-api.ts";
  import { entityRecordHref } from "$lib/directory/entity-presentation.ts";
  import { presentationFor } from "$lib/matters/matter-search-presentation.ts";
  import { matterStatusPresentation } from "$lib/matters/matter-status.ts";
  import type { MatterSummary } from "$lib/matters/matters-api.ts";
  import MarkedText from "$lib/search/marked-text.svelte";
  import {
    listedHits,
    tickedPlacesHoldMore,
    type NameGroup,
    type SearchAnswer,
  } from "$lib/search/search-across-matters.svelte.ts";
  import { MATTERS_PLACE, PEOPLE_PLACE, placeTicked } from "$lib/search/search-address.ts";

  let {
    answer,
    failure,
    busy,
    authorName,
    onRetry,
  }: {
    answer: SearchAnswer | null;
    failure: StatedFailure | null;
    busy: boolean;
    /** Who a member is called, for the line under a record. Empty where the roster cannot say. */
    authorName: (userId: string) => string;
    onRetry?: () => void;
  } = $props();

  const listed = $derived(answer === null ? [] : listedHits(answer, answer.filters));
  const holdsMore = $derived(answer === null ? false : tickedPlacesHoldMore(answer, answer.filters));

  function shownNames<Row>(group: NameGroup<Row>, place: string): boolean {
    return answer !== null && placeTicked(answer.filters, place) && group.standing !== "not-searched";
  }

  const foundSomething = $derived(
    listed.length > 0 ||
      (answer !== null &&
        ((shownNames(answer.matters, MATTERS_PLACE) && answer.matters.rows.length > 0) ||
          (shownNames(answer.people, PEOPLE_PLACE) && answer.people.rows.length > 0))),
  );

  function matterLabel(matter: { title: string; number: string | null }): string {
    return matter.number === null ? matter.title : `${matter.number} ${matter.title}`;
  }

  function matterNumber(matter: MatterSummary): string | null {
    return matter.matterNumber ?? matter.consultationNumber ?? matter.intakeNumber;
  }

  function nameStandingLine(standing: NameGroup<unknown>["standing"], what: string): string {
    if (standing === "no-access") return `Your role does not include reading ${what}.`;
    return `${what.charAt(0).toUpperCase()}${what.slice(1)} could not be searched just now.`;
  }

  /** How a person's matched name should be explained, where it is not the name on the row. */
  function matchedNameLine(hit: DirectorySearchHit): string | null {
    if (hit.matchedNameIsCurrent || hit.matchedName === hit.displayName) return null;
    return `Matched on ${hit.matchedNameRole} name: ${hit.matchedName}`;
  }

  /** The day a record is listed by, as the list shows it. A day stays a day; a moment is shown whole. */
  function listedDate(sortKey: string): string {
    return sortKey.length === 10 ? formatDate(sortKey) : formatInstant(sortKey);
  }

  const SEARCH_FIXTURE = ["Engagement letter.pdf", "Status conference", "Discovery plan.docx"];
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

{#snippet nameFrame(Icon: Component, heading: string, detail: string, body: Snippet)}
  <section class="rounded-md border border-border-default bg-surface-raised">
    <header class="flex items-baseline gap-12 border-b border-border-default px-16 py-12">
      <Icon class="size-16 self-center text-text-muted" aria-hidden="true" />
      <h2 class="text-sm font-semibold text-text-default">{heading}</h2>
      <span class="text-xs text-text-muted">{detail}</span>
    </header>
    {@render body()}
  </section>
{/snippet}

<LoadingRegion
  loading={answer === null && busy}
  failed={failure !== null}
  {onRetry}
  refreshing={answer !== null && busy}
  label="Searching the matters you can see"
  failure={failureNotice}
>
  {#snippet fixture()}
    <ul class="divide-y divide-border-default rounded-md border border-border-default bg-surface-raised">
      {#each SEARCH_FIXTURE as title (title)}
        <li class="flex flex-col gap-4 px-16 py-12">
          <span class="text-sm font-medium text-text-default">{title}</span>
          <span class="line-clamp-2 text-xs text-text-muted">{SAMPLE_SENTENCE}</span>
        </li>
      {/each}
    </ul>
  {/snippet}

  {#if answer !== null}
    <div class="flex flex-col gap-16">
      {#if answer.records?.broad === true}
        <Alert.Root variant="info">
          <Alert.Title>Showing The Most Recent Matches</Alert.Title>
          <Alert.Description>
            These words appear in too many records to search at once, so only the most recent matches are shown. Add a word or a filter to narrow the search.
          </Alert.Description>
        </Alert.Root>
      {/if}

      {#if !foundSomething && failure === null && !busy}
        <p class="text-sm text-text-muted">No Results</p>
      {/if}

      {#if shownNames(answer.matters, MATTERS_PLACE)}
        {@const matters = answer.matters}
        {#snippet mattersBody()}
          {#if matters.standing !== "answered"}
            <p class="px-16 py-12 text-sm text-text-muted">
              {nameStandingLine(matters.standing, "matters")}
            </p>
          {:else if matters.rows.length === 0}
            <p class="px-16 py-12 text-sm text-text-muted">No Results</p>
          {:else}
            <ul class="divide-y divide-border-default">
              {#each matters.rows as matter (matter.id)}
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
        {@render nameFrame(FolderOpen, "Matters", "Matched on title, number and client", mattersBody)}
      {/if}

      {#if shownNames(answer.people, PEOPLE_PLACE)}
        {@const people = answer.people}
        {#snippet peopleBody()}
          {#if people.standing !== "answered"}
            <p class="px-16 py-12 text-sm text-text-muted">
              {nameStandingLine(people.standing, "the directory")}
            </p>
          {:else if people.rows.length === 0}
            <p class="px-16 py-12 text-sm text-text-muted">No Results</p>
          {:else}
            <ul class="divide-y divide-border-default">
              {#each people.rows as hit (hit.entityId)}
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
        {@render nameFrame(
          Users,
          "People",
          "Matched on every name the directory holds, current and former",
          peopleBody,
        )}
      {/if}

      {#if listed.length > 0}
        <ul
          aria-label="Records found, newest first"
          class="divide-y divide-border-default rounded-md border border-border-default bg-surface-raised"
        >
          {#each listed as { place, hit } (`${place}:${hit.id}`)}
            {@const presentation = presentationFor(place)}
            {@const author = hit.actorUserId === null ? "" : authorName(hit.actorUserId)}
            <li>
              <a
                href={hit.link}
                class="flex flex-col gap-4 px-16 py-12 transition-colors duration-fast
                       ease-standard hover:bg-surface-subtle"
              >
                <span class="flex items-baseline justify-between gap-12">
                  <span class="min-w-0 text-sm font-medium text-text-default">
                    {#if presentation.titleKind === "instant"}
                      <time datetime={instantAttribute(hit.title)}>
                        {formatInstant(hit.title)}
                      </time>
                    {:else}
                      <MarkedText text={hit.title} marks={hit.titleMarks} />
                    {/if}
                  </span>
                  <span class="flex-none text-xs text-text-muted">{listedDate(hit.sortKey)}</span>
                </span>
                {#if hit.snippet !== null}
                  <span class="line-clamp-2 text-sm text-text-muted">
                    <MarkedText text={hit.snippet} marks={hit.snippetMarks} />
                  </span>
                {/if}
                <span class="flex flex-wrap items-center gap-8 text-xs text-text-muted">
                  <Badge variant="neutral">{presentation.heading}</Badge>
                  <Badge variant="neutral">{matterLabel(hit.matter)}</Badge>
                  {#if author !== ""}
                    <span>{author}</span>
                  {/if}
                  {#if hit.secondary !== null}
                    <span>{hit.secondary}</span>
                  {/if}
                </span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}

      {#if holdsMore}
        <p class="text-xs text-text-muted">
          Some places hold more matches than shown. Add a word or a filter to narrow the search.
        </p>
      {/if}
    </div>
  {/if}
</LoadingRegion>
