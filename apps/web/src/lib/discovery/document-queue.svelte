<script lang="ts">
  /*
   * The reviewer's left region — the walk, and where in it you are.
   *
   * IT IS NOT A FILTER RAIL, and the distinction is the reason this presentation earns a shape the
   * list screen is not allowed. A rail that narrows is a filter wearing the costume of navigation,
   * and the Custodian register lost one for exactly that. A queue is the task itself: a reviewer
   * codes one document and moves to the next, thousands of times, and the position marker in that
   * walk is the surface.
   *
   * IT IS THE SAME READ, WITH THE SAME CRITERIA. Whatever the list was narrowed to is what this
   * walks, in the same order, which is what makes "narrow, then review what you found" one gesture
   * rather than two screens. It pages the same way the list does, because a corpus is added to while
   * it is being read and a numbered page would silently show a document twice or skip one.
   */
  import Badge from "@magna-carta/design-system/badge";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import { listReviewDocuments, type ReviewDocument } from "./discovery-api.ts";
  import { composeDocumentQuery, type CriteriaSet } from "./criteria.ts";
  import { processingStateEntry } from "./discovery-vocabulary.ts";

  let {
    reviewSetId,
    criteria,
    documentId,
    href,
    onWalk,
  }: {
    reviewSetId: string;
    /** The narrowing the list was on. The queue is that narrowing, walked. */
    criteria: CriteriaSet;
    /** Where the reader is now. */
    documentId: string;
    /** The address one document in the queue opens at, criteria carried. */
    href: (id: string) => string;
    /** The walk, handed back so the reviewer's own keys and buttons can move along it. */
    onWalk?: (walk: { readonly previous: string | null; readonly next: string | null }) => void;
  } = $props();

  const list = new PagedList<ReviewDocument>("The queue could not be read.");
  const documents = $derived(list.items);

  const query = $derived(composeDocumentQuery(criteria));
  const subject = $derived(
    [
      reviewSetId,
      query.recordCustodianId ?? "",
      query.discoveryLoadId ?? "",
      query.familyId ?? "",
      query.processingState ?? "",
      query.exceptionCode ?? "",
    ].join("|"),
  );

  function read(cursor?: string) {
    return listReviewDocuments(fetch, reviewSetId, { ...query, cursor });
  }

  $effect(() => {
    const asked = subject;
    if (list.showing(asked)) return;
    list.reset(asked);
    void list.load(read);
  });

  const position = $derived((documents ?? []).findIndex((one) => one.id === documentId));

  /*
   * Where the walk goes next.
   *
   * `next` is null at the end of what has been LOADED rather than at the end of the corpus, and the
   * reviewer's own control loads more when it runs out. Reporting the loaded end as the corpus's end
   * would tell somebody they had finished a review they were partway through, which is the one
   * mistake this surface must not make.
   */
  const walk = $derived.by(() => {
    const rows = documents ?? [];
    if (position < 0) return { previous: null, next: null };
    return {
      previous: position > 0 ? (rows[position - 1]?.id ?? null) : null,
      next: position < rows.length - 1 ? (rows[position + 1]?.id ?? null) : null,
    };
  });

  $effect(() => {
    onWalk?.(walk);
  });
</script>

<div class="flex min-h-0 flex-col gap-8">
  <div class="flex items-baseline justify-between gap-8">
    <h2 class="text-sm font-semibold">Queue</h2>
    {#if documents !== null && position >= 0}
      <span class="text-text-muted text-sm tabular-nums">
        {position + 1} of {documents.length}{list.nextCursor === null ? "" : "+"}
      </span>
    {/if}
  </div>

  {#if list.failure !== null}
    <FailureNotice
      failure={list.failure}
      title="The Queue Could Not Be Read"
      fallback={list.failureMessage ?? undefined}
      onRetry={() => {
        list.reset(subject);
        void list.load(read);
      }}
    />
  {:else if documents !== null && documents.length === 0}
    <EmptyState title="Nothing To Walk">
      No document in this review set answers to what is asked.
    </EmptyState>
  {:else}
    <ul class="min-h-0 flex-1 overflow-y-auto">
      {#each documents ?? [] as one (one.id)}
        {@const state = processingStateEntry(one.processingState)}
        {@const here = one.id === documentId}
        <li>
          <a
            href={href(one.id)}
            aria-current={here ? "page" : undefined}
            class="flex flex-col gap-4 border-b border-border px-8 py-8 {here
              ? 'bg-surface-sunken font-semibold'
              : 'hover:bg-surface-sunken'}"
          >
            <span class="truncate text-sm">{one.sourceName ?? "Unnamed"}</span>
            <span class="flex items-center gap-8">
              <Badge variant={state.tone} title={state.meaning}>{state.label}</Badge>
              <span class="text-text-muted text-sm">
                {one.sortDate === null ? "No date" : new Date(one.sortDate).toLocaleDateString()}
              </span>
            </span>
          </a>
        </li>
      {/each}
    </ul>

    {#if list.nextCursor !== null}
      <button
        type="button"
        class="text-text-muted py-8 text-sm underline underline-offset-2"
        disabled={list.loadingMore}
        onclick={() => void list.loadMore(read)}
      >
        {list.loadingMore ? "Loading" : "Load more"}
      </button>
    {/if}
  {/if}
</div>
