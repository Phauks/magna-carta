<script lang="ts">
  /*
   * The Results section of a check's report: what the search surfaced, one card per result, with
   * the filters a reviewer narrows them by.
   *
   * A CARD SAYS WHY AND WHERE (owner's ruling, 2026-11-09). The name, how strong the evidence is in
   * a word, which search found it, what fired, and how it was reached — on the card, without
   * opening anything. The chevron opens the full account in place; Open hands it to the result's
   * window, which holds the reviewer's trail.
   *
   * THE REVIEW IS CHOSEN FROM THE CARD. A dropdown of review states replaces the Answer button:
   * picking one opens the answer dialog on that state, because an answer still needs a reviewer's
   * reasoning on the record. The current state is what the dropdown reads.
   *
   * FILTERS ARE CHIPS, each with its count, so a reviewer can see the shape of what came back
   * before narrowing it. Nothing is ever filtered out until somebody presses a chip.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Input from "@magna-carta/design-system/input";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Search from "@lucide/svelte/icons/search";
  import type { DispositionKind, EvidenceTier, HitDetail, SourceClass } from "./conflicts-api.ts";
  import {
    EVIDENCE_TIERS,
    dispositionVocabulary,
    edgeTypeLabel,
    evidenceTier,
    pathSummary,
  } from "./conflicts-vocabulary.ts";
  import { entityKindText, partyCellTitle, partyText } from "./hit-columns.ts";
  import {
    countBy,
    filterIsActive,
    filterResults,
    foundThroughText,
    NO_FILTER,
    resultCountText,
    REVIEW_LABELS,
    REVIEW_STATES,
    reviewStateOf,
    reviewText,
    STRENGTH_LABELS,
    STRENGTH_TONES,
    toggled,
    whereText,
    whyText,
    type ResultFilter,
    type ReviewState,
  } from "./check-results.ts";

  let {
    hits,
    mayReview = true,
    reviewRefusal,
    memberName,
    onOpen,
    onReview,
  }: {
    hits: readonly HitDetail[];
    /** Whether the signed-in member may record an answer. */
    mayReview?: boolean;
    /** Why they may not, where they may not. */
    reviewRefusal?: string;
    /** A member's name from their account handle, for a reviewer named on an expanded card. */
    memberName: (userId: string) => string;
    /** Open the result's own window, with its whole trail. */
    onOpen: (hit: HitDetail) => void;
    /** Record a review state for a result: opens the answer dialog on that state. */
    onReview: (hit: HitDetail, kind: DispositionKind) => void;
  } = $props();

  let filter = $state<ResultFilter>(NO_FILTER);
  let expanded = $state<ReadonlySet<string>>(new Set());

  const shown = $derived(filterResults(hits, filter));
  const sourceCounts = $derived(countBy(hits, (hit) => hit.sourceClass));
  const strengthCounts = $derived(countBy(hits, (hit) => hit.evidenceTier));
  const reviewCounts = $derived(countBy(hits, reviewStateOf));
  const sources = $derived([...sourceCounts.keys()] as SourceClass[]);

  function chipClass(on: boolean): string {
    return buttonClasses({ variant: on ? "secondary" : "ghost", size: "sm" });
  }

  function toggleExpanded(id: string): void {
    expanded = toggled(expanded, id);
  }
</script>

{#snippet chip(label: string, count: number, on: boolean, press: () => void)}
  <button type="button" class={chipClass(on)} aria-pressed={on} onclick={press}>
    {label}
    <span class="text-text-muted tabular-nums">{String(count)}</span>
  </button>
{/snippet}

<div class="flex flex-col gap-16">
  {#if hits.length > 0}
    <div class="flex flex-col gap-8" role="group" aria-label="Filter results">
      <div class="flex flex-wrap items-center gap-8">
        <div class="relative min-w-0 flex-1">
          <Search
            class="pointer-events-none absolute start-8 top-1/2 size-16 -translate-y-1/2 text-text-muted"
            aria-hidden="true"
          />
          <Input
            class="ps-32"
            placeholder="Filter results"
            aria-label="Filter results"
            value={filter.text}
            oninput={(event: Event) =>
              (filter = { ...filter, text: (event.currentTarget as HTMLInputElement).value })}
          />
        </div>
        {#if filterIsActive(filter)}
          <Button variant="ghost" size="sm" onclick={() => (filter = NO_FILTER)}>Clear</Button>
        {/if}
      </div>
      <div class="flex flex-wrap items-center gap-4">
        <FieldLabel as="span" class="me-4">Found In</FieldLabel>
        {#each sources as source (source)}
          {@render chip(
            foundThroughText(source),
            sourceCounts.get(source) ?? 0,
            filter.sources.has(source),
            () => (filter = { ...filter, sources: toggled(filter.sources, source) }),
          )}
        {/each}
      </div>
      <div class="flex flex-wrap items-center gap-4">
        <FieldLabel as="span" class="me-4">Match</FieldLabel>
        {#each EVIDENCE_TIERS.filter((tier) => strengthCounts.has(tier)) as tier (tier)}
          {@render chip(
            STRENGTH_LABELS[tier],
            strengthCounts.get(tier) ?? 0,
            filter.strengths.has(tier),
            () => (filter = { ...filter, strengths: toggled(filter.strengths, tier) }),
          )}
        {/each}
        <FieldLabel as="span" class="ms-12 me-4">Review</FieldLabel>
        {#each REVIEW_STATES.filter((state) => reviewCounts.has(state)) as state (state)}
          {@render chip(
            REVIEW_LABELS[state],
            reviewCounts.get(state) ?? 0,
            filter.reviews.has(state),
            () => (filter = { ...filter, reviews: toggled(filter.reviews, state) }),
          )}
        {/each}
      </div>
    </div>
  {/if}

  {#if filterIsActive(filter)}
    <p class="text-xs text-text-muted">
      Showing {String(shown.length)} of {resultCountText(hits.length)}
    </p>
  {/if}
  <ul class="flex flex-col gap-8">
      {#each shown as hit (hit.id)}
        {@const open = expanded.has(hit.id)}
        {@const state: ReviewState = reviewStateOf(hit)}
        <li
          class="rounded-md border border-border-default bg-surface-raised"
          data-result={hit.id}
        >
          <div class="flex items-start gap-8 p-12">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-expanded={open}
              aria-label="{open ? 'Hide' : 'Show'} detail for {partyText(hit)}"
              onclick={() => toggleExpanded(hit.id)}
            >
              {#if open}
                <ChevronDown class="size-16" aria-hidden="true" />
              {:else}
                <ChevronRight class="size-16" aria-hidden="true" />
              {/if}
            </Button>
            <div class="flex min-w-0 flex-1 flex-col gap-4">
              <div class="flex flex-wrap items-baseline gap-8">
                <button
                  type="button"
                  class="text-start font-semibold underline-offset-2 hover:underline"
                  title={partyCellTitle(hit)}
                  onclick={() => onOpen(hit)}
                >
                  {partyText(hit)}
                </button>
                <span class="text-xs text-text-muted">{entityKindText(hit.entityId)}</span>
                <Badge
                  variant={STRENGTH_TONES[hit.evidenceTier as EvidenceTier]}
                  title={evidenceTier(hit.evidenceTier).meaning}
                >
                  {STRENGTH_LABELS[hit.evidenceTier as EvidenceTier]}
                </Badge>
                <Badge variant="outline">{foundThroughText(hit.sourceClass)}</Badge>
              </div>
              <p class="text-sm">{whyText(hit)}</p>
              <p class="text-xs text-text-muted">{whereText(hit)}</p>
            </div>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                class={buttonClasses({ variant: "secondary", size: "sm" })}
                disabled={!mayReview}
                title={mayReview ? undefined : reviewRefusal}
                aria-label="Review state for {partyText(hit)}: {reviewText(hit)}"
              >
                {reviewText(hit)}
                <ChevronDown class="size-16" aria-hidden="true" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                {#each REVIEW_STATES as option (option)}
                  {#if option === "unreviewed"}
                    <!-- Not a state anybody records: an answer is withdrawn by recording another. -->
                    <DropdownMenu.Item disabled>{REVIEW_LABELS.unreviewed}</DropdownMenu.Item>
                  {:else}
                    <DropdownMenu.Item
                      onSelect={() => onReview(hit, option)}
                      aria-current={state === option ? "true" : undefined}
                    >
                      {REVIEW_LABELS[option]}
                    </DropdownMenu.Item>
                  {/if}
                {/each}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>
          {#if open}
            <dl
              class="grid grid-cols-[max-content_1fr] gap-x-16 gap-y-8 border-t border-border-default p-12 ps-48 text-sm"
            >
              <dt class="text-text-muted">Matched On</dt>
              <dd>
                <ul class="flex flex-col gap-4">
                  {#each hit.matchedFields as field (field)}
                    <li>{field}</li>
                  {:else}
                    <li class="text-text-muted">No channel recorded</li>
                  {/each}
                </ul>
              </dd>
              <dt class="text-text-muted">Path</dt>
              <dd>
                {#if hit.graphPath.length === 0}
                  {pathSummary(hit.graphPath)}
                {:else}
                  <ol class="flex flex-col gap-4">
                    {#each hit.graphPath as step (step.edgeId)}
                      <li>
                        {edgeTypeLabel(step.edgeType)}{step.expiredAtCheck === true
                          ? " (ended before this check)"
                          : ""}
                      </li>
                    {/each}
                  </ol>
                {/if}
              </dd>
              {#if hit.disposition !== null}
                <dt class="text-text-muted">Review</dt>
                <dd>
                  {dispositionVocabulary(hit.disposition.kind).label} by
                  {memberName(hit.disposition.reviewerUserId)},
                  {formatInstant(hit.disposition.createdAt)}: {hit.disposition.rationale}
                </dd>
              {/if}
              {#if hit.previouslyAnswered !== null}
                <dt class="text-text-muted">Earlier Answer</dt>
                <dd>
                  <a
                    class="underline underline-offset-2"
                    href="/conflicts/checks/{hit.previouslyAnswered.checkId}"
                  >
                    {dispositionVocabulary(hit.previouslyAnswered.kind).label} on another check,
                    {formatInstant(hit.previouslyAnswered.createdAt)}
                  </a>
                </dd>
              {/if}
              <dd class="col-span-2">
                <Button variant="ghost" size="sm" onclick={() => onOpen(hit)}>Open</Button>
              </dd>
            </dl>
          {/if}
        </li>
      {:else}
        <li class="text-sm {hits.length === 0 ? '' : 'text-text-muted'}">
          {hits.length === 0 ? "0 results." : "No result matches these filters."}
        </li>
      {/each}
    </ul>
</div>
