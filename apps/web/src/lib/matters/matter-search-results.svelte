<script lang="ts">
  /*
   * The answer, rendered. One component for the panel under the field and for the full results
   * page, so the two are the same reading of the same answer rather than two that agree by
   * coincidence — only the density differs.
   *
   * It is generic over the server's registry: it renders whatever groups arrive, in the order they
   * arrive, and asks the presentation registry only for an icon and a heading. A source with no
   * presentation entry still renders under its own key. Adding a searchable section changes nothing
   * in this file.
   *
   * GROUPS, NEVER ONE MERGED LIST. A listing and a ranked answer are two different objects and must
   * not be presented alike, and there is no honest way to rank a substring hit against a relevance
   * score — a false ordering would read as an authoritative one.
   *
   * A GROUP THAT CONTRIBUTED NOTHING STILL RENDERS, carrying why. "No matches here" and "you cannot
   * see this section" are different answers, and collapsing them teaches a reader the matter holds
   * nothing when it may hold a great deal they are not permitted to see.
   */
  import Badge from "@magna-carta/design-system/badge";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { SAMPLE_SENTENCE } from "@magna-carta/design-system/loading-fixtures";
  import { formatInstant, instantAttribute } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    emptyGroupLine,
    presentationFor,
    skippedBadge,
  } from "$lib/matters/matter-search-presentation.ts";
  import type { MatterSearchAnswer } from "$lib/matters/matter-search-api.ts";
  import MarkedText from "$lib/search/marked-text.svelte";

  let {
    answer,
    failure,
    onRetry,
    busy,
    density = "comfortable",
    onnavigate,
  }: {
    answer: MatterSearchAnswer | null;
    /** The whole failure record with this search's own words, never a sentence squeezed out of it. */
    failure: StatedFailure | null;
    /** Ask the same question again; the caller owns the search, so it supplies the re-ask. */
    onRetry?: () => void;
    busy: boolean;
    /** "compact" is the panel under the field; "comfortable" is the results page. */
    density?: "compact" | "comfortable";
    onnavigate?: () => void;
  } = $props();

  const compact = $derived(density === "compact");

  // Whether anything at all was found, across every group that answered. It decides the one line at
  // the top rather than any group's own rendering — a group still says its own piece either way.
  const foundSomething = $derived(
    answer !== null && answer.groups.some((group) => group.hits.length > 0),
  );

  // The shape drawn while the search is in flight: two groups from the real registry, each with a
  // hit or two of sample words, in the same rows the answer renders in. The excerpt is the sample
  // vocabulary's sentence; the titles are file and setting names, which it does not carry.
  const SEARCH_FIXTURE = [
    {
      source: "files",
      hits: [
        { title: "Engagement letter.pdf", snippet: SAMPLE_SENTENCE },
        { title: "Discovery plan.docx", snippet: SAMPLE_SENTENCE },
      ],
    },
    {
      source: "calendar",
      hits: [{ title: "Status conference", snippet: SAMPLE_SENTENCE }],
    },
  ] as const;
</script>

<!-- The failure band, not a bare sentence: it carries the Error ID as a copyable chip and the
     remedy, which is what golden rule 4 requires of every error surface. The region renders it
     first, so a failed search never leaves the shape standing. -->
{#snippet failureNotice()}
  {#if failure !== null}
    <FailureNotice
      failure={failure.failure}
      subject="This matter"
      title="This Matter Could Not Be Searched"
      fallback={failure.fallback}
      whenSilent={failure.whenSilent}
    />
  {/if}
{/snippet}

<!-- A search typed over an answer already on screen is a re-read of that answer: the groups stay
     where the reader is looking and the region says it is busy. -->
<LoadingRegion
  loading={answer === null && busy}
  failed={failure !== null}
  {onRetry}
  refreshing={answer !== null && busy}
  label="Searching this matter"
  failure={failureNotice}
>
  {#snippet fixture()}
    <ul class="flex flex-col gap-4" class:gap-16={!compact}>
      {#each SEARCH_FIXTURE as group (group.source)}
        {@const presentation = presentationFor(group.source)}
        {@const Icon = presentation.icon}
        <li>
          <div class="flex items-center gap-8 px-8 py-4">
            <Icon class="size-16 text-text-muted" aria-hidden="true" />
            <h3 class="text-xs font-semibold text-text-default">{presentation.heading}</h3>
            <span class="text-xs text-text-subtle">{group.hits.length}</span>
          </div>
          <ul>
            {#each group.hits as hit (hit.title)}
              <li>
                <span class="flex flex-col gap-2 rounded-sm px-8 py-8">
                  <span class="text-sm font-medium text-text-default">{hit.title}</span>
                  <span class="line-clamp-2 text-xs text-text-muted">{hit.snippet}</span>
                </span>
              </li>
            {/each}
          </ul>
        </li>
      {/each}
    </ul>
  {/snippet}
  {#if answer !== null}
    {#if !foundSomething}
      <p class="px-8 py-12 text-sm text-text-muted">
        Nothing on this matter matches “{answer.query}”.
      </p>
    {/if}
    <ul class="flex flex-col gap-4" class:gap-16={!compact}>
      {#each answer.groups as group (group.source)}
        {@const presentation = presentationFor(group.source)}
        {@const Icon = presentation.icon}
        <!-- A group with nothing in it is only worth a row when it has something to SAY: a reason it
             could not answer. An ordinary empty group on a page full of groups is noise, so on the
             panel it is dropped and on the results page it stays, where the reader is looking at the
             whole answer and the absence is part of it. -->
        {#if group.hits.length > 0 || group.skipped !== null || !compact}
          <li>
            <div class="flex items-center gap-8 px-8 py-4">
              <Icon class="size-16 text-text-muted" aria-hidden="true" />
              <h3 class="text-xs font-semibold text-text-default">{presentation.heading}</h3>
              {#if group.hits.length > 0}
                <span class="text-xs text-text-subtle">
                  {group.hits.length}{group.hasMore ? "+" : ""}
                </span>
              {/if}
              {#if group.skipped !== null}
                <Badge variant="neutral" class="ms-auto">{skippedBadge(group.skipped)}</Badge>
              {/if}
            </div>

            {#if group.hits.length === 0}
              <p class="px-8 pb-8 text-xs text-text-muted">{emptyGroupLine(group.skipped, group.source)}</p>
            {:else}
              <ul>
                {#each group.hits as hit (hit.id)}
                  <li>
                    <a
                      href={hit.link}
                      onclick={() => onnavigate?.()}
                      class="flex flex-col gap-2 rounded-sm px-8 py-8 transition-colors
                             duration-fast ease-standard hover:bg-surface-subtle"
                    >
                      <span class="text-sm font-medium text-text-default">
                        {#if presentation.titleKind === "instant"}
                          <!-- A note has no name: what a reader recognizes it by is when it was
                               written, and the excerpt below carries the words. -->
                          <time datetime={instantAttribute(hit.title)}>
                            {formatInstant(hit.title)}
                          </time>
                        {:else}
                          <MarkedText text={hit.title} marks={hit.titleMarks} />
                        {/if}
                      </span>
                      {#if hit.snippet !== null}
                        <!-- Already cut by the server to the stretch the words are in, and marked
                             where it found them. Nothing is searched for here. -->
                        <span class="line-clamp-2 text-xs text-text-muted">
                          <MarkedText text={hit.snippet} marks={hit.snippetMarks} />
                        </span>
                      {/if}
                      {#if hit.secondary !== null}
                        <span class="text-xs text-text-subtle">{hit.secondary}</span>
                      {/if}
                    </a>
                  </li>
                {/each}
              </ul>
              {#if group.hasMore}
                <!-- "There is more", measured by reading one row past the limit. Never a total: this
                     surface has not counted the whole answer and will not imply that it has. -->
                <p class="px-8 pb-4 text-xs text-text-subtle">
                  More matches than shown. Narrow the search or open all results.
                </p>
              {/if}
              {#if group.matchedFields.length > 0 && !compact}
                <p class="px-8 pb-8 text-xs text-text-subtle">
                  Matched on {group.matchedFields.join(", ")}.
                </p>
              {/if}
            {/if}
          </li>
        {/if}
      {/each}
    </ul>
  {/if}
</LoadingRegion>
