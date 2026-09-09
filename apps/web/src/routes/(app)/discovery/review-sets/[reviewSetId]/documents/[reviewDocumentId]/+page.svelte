<script lang="ts">
  /*
   * The reviewer — the second presentation of the same read.
   *
   * THE LIST AND THIS ARE ONE SCREEN IN TWO SHAPES, and the criteria set is what makes that true: it
   * rides the address, so opening a document from a narrowed list walks exactly that narrowing, in
   * exactly that order. "Narrow, then review what you found" is one gesture rather than two screens
   * that have to be kept in step.
   *
   * WHY THIS PRESENTATION EARNS A SHAPE THE LIST SCREEN IS NOT ALLOWED. A list screen is one table
   * at the full width, and a rail down its side has to earn the difference — the Custodian register
   * kept one and lost it, because a rail that NARROWS is a filter wearing the costume of navigation.
   * A queue is not that. It is the position marker in a walk, and the walk is the task: a reviewer
   * codes one document and moves to the next, thousands of times. The panels are where the work is
   * written. That is a different object from a list, and it is why the three regions are here and
   * nowhere else in the product.
   *
   * THE PANELS ARE A REGISTRY, so every remaining sub-slice of the review workflow — coding,
   * privilege, redaction, near-duplicates, the coding history — is one entry and one component, and
   * nothing about this shell changes for any of them. The ones that are not built render visible and
   * disabled with what each waits on, which is how the shape of a finished reviewer is visible on
   * the day the first three panels ship.
   */
  import Button from "@magna-carta/design-system/button";
  import { MaturityBadge, soonDependencySentence } from "@magna-carta/design-system/maturity";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import List from "@lucide/svelte/icons/list";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import DocumentPane from "$lib/discovery/document-pane.svelte";
  import DocumentQueue from "$lib/discovery/document-queue.svelte";
  import FactsPanel from "$lib/discovery/panels/facts-panel.svelte";
  import FamilyPanel from "$lib/discovery/panels/family-panel.svelte";
  import OccurrencesPanel from "$lib/discovery/panels/occurrences-panel.svelte";
  import {
    assertReviewPanels,
    panelIsBuilt,
    reviewPanels,
  } from "$lib/discovery/review-panels.ts";
  import {
    criteriaFromSearchParameters,
    criteriaToSearchParameters,
  } from "$lib/discovery/criteria.ts";
  import type { ReviewSet } from "$lib/discovery/discovery-api.ts";

  let { data }: { data: { reviewSet: ReviewSet } } = $props();

  const reviewSet = $derived(data.reviewSet);
  const documentId = $derived(page.params.reviewDocumentId ?? "");
  const criteria = $derived(criteriaFromSearchParameters(page.url.searchParams));

  const panels = reviewPanels({
    facts: FactsPanel,
    family: FamilyPanel,
    occurrences: OccurrencesPanel,
  });
  // Checked before anything renders: a panel that cannot say why it is empty, or two sharing an id,
  // is a failure now rather than a stack that silently drops one.
  assertReviewPanels(panels);

  let openPanel = $state("facts");
  let walk = $state<{ previous: string | null; next: string | null }>({
    previous: null,
    next: null,
  });

  /** One document's address, carrying whatever the list was narrowed to. */
  function documentHref(id: string): string {
    const search = criteriaToSearchParameters(criteria).toString();
    const base = `/discovery/review-sets/${reviewSet.id}/documents/${id}`;
    return search === "" ? base : `${base}?${search}`;
  }

  function listHref(): string {
    const search = criteriaToSearchParameters(criteria).toString();
    const base = `/discovery/review-sets/${reviewSet.id}/documents`;
    return search === "" ? base : `${base}?${search}`;
  }

  /*
   * The walk on the keyboard, because a reviewer's hands do not leave it.
   *
   * Only when nothing is being typed into: a reviewer naming a tag or writing a claim must be able
   * to type a bracket without the document under them changing. Brackets rather than the arrow keys,
   * which belong to whatever list or text region has focus.
   */
  function onKeydown(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement) {
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
        return;
      }
    }
    const to = event.key === "[" ? walk.previous : event.key === "]" ? walk.next : null;
    if (to === null) return;
    event.preventDefault();
    void goto(documentHref(to));
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- Three regions on a wide canvas, stacked on a narrow one. The queue and the panels take a fixed
     width from the token scale and the document takes what is left, because the document is the
     thing being read and the other two are its edges. -->
<div class="flex min-h-0 flex-1 flex-col gap-16 lg:flex-row">
  <div class="flex min-h-0 flex-col gap-8 lg:w-2xs lg:shrink-0">
    <a class="text-text-muted flex items-center gap-8 text-sm underline underline-offset-2" href={listHref()}>
      <List class="size-16" aria-hidden="true" />
      Back to the list
    </a>
    <DocumentQueue
      reviewSetId={reviewSet.id}
      {criteria}
      {documentId}
      href={documentHref}
      onWalk={(next) => (walk = { previous: next.previous, next: next.next })}
    />
  </div>

  <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-8">
    <div class="flex items-center gap-8">
      <Button
        variant="ghost"
        disabled={walk.previous === null}
        title="Previous document (bracket left)"
        onclick={() => walk.previous !== null && void goto(documentHref(walk.previous))}
      >
        <ChevronLeft class="size-16" aria-hidden="true" />
        Previous
      </Button>
      <Button
        variant="ghost"
        disabled={walk.next === null}
        title="Next document (bracket right)"
        onclick={() => walk.next !== null && void goto(documentHref(walk.next))}
      >
        Next
        <ChevronRight class="size-16" aria-hidden="true" />
      </Button>
    </div>
    <DocumentPane reviewSetId={reviewSet.id} {documentId} />
  </div>

  <div class="flex min-h-0 flex-col gap-8 lg:w-xs lg:shrink-0">
    <!-- The panel stack's own strip. Every panel renders, including the ones nothing is behind: a
         reviewer should be able to see that coding is coming rather than wonder whether this
         product does it. -->
    <div class="flex flex-wrap gap-4 border-b border-border-strong pb-8">
      {#each panels as panel (panel.id)}
        {@const built = panelIsBuilt(panel)}
        <button
          type="button"
          disabled={!built}
          aria-pressed={built && openPanel === panel.id}
          title={built ? panel.answers : soonDependencySentence(panel.waitsOn)}
          class="rounded px-8 py-4 text-sm {openPanel === panel.id && built
            ? 'bg-surface-sunken font-semibold'
            : 'text-text-muted'} disabled:opacity-50"
          onclick={() => (openPanel = panel.id)}
        >
          {panel.label}
        </button>
      {/each}
    </div>

    {#each panels as panel (panel.id)}
      {#if openPanel === panel.id && panelIsBuilt(panel)}
        {@const Panel = panel.component}
        <div class="mc-scrollbar min-h-0 flex-1 overflow-y-auto">
          <p class="text-text-muted mb-8 text-sm">{panel.answers}</p>
          <Panel reviewSetId={reviewSet.id} {documentId} />
        </div>
      {/if}
    {/each}

    <ul class="flex flex-col gap-4 border-t border-border pt-8">
      {#each panels as panel (panel.id)}
        {#if !panelIsBuilt(panel)}
          <li class="flex flex-wrap items-center gap-8">
            <span class="text-sm font-medium">{panel.label}</span>
            <MaturityBadge stage="soon" />
            <span class="text-text-muted text-sm">{soonDependencySentence(panel.waitsOn)}</span>
          </li>
        {/if}
      {/each}
    </ul>
  </div>
</div>
