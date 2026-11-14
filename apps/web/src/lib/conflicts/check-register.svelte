<script lang="ts">
  /*
   * The check register — the firm's own log of every conflicts check it has run, as one table.
   *
   * WHY THE LOG IS THE SCREEN. A conflicts check is a professional-responsibility act, and what a
   * firm has to be able to produce months later is the RECORD of the acts: what was searched, when,
   * by whom, and how wide. So the standing surface is the log, and running a new check is a create
   * act reached from the header's own control — the same arrangement as the custody register, where
   * the register is the destination and logging a packet is the act performed over it.
   *
   * IT IS ONE TABLE AT THE FULL WIDTH. No status strip above the rows, no tab per trigger: what
   * narrows the log is the columns' own filters, summoned from a column's header, which is the one
   * home for them (docs/conventions/design-corrections.md, the list-screen rulings).
   *
   * WHAT IS NARROWED IS A DIFFERENT QUESTION, NOT A DIFFERENT PAGE. A change of the matter PROP
   * resets the read rather than filtering the rows on screen: the listing is cursor-paged, so
   * filtering what has been loaded would answer confidently about a fraction of the log.
   *
   * THE CHROME IS THE SURFACE'S. The clear-filters control belongs to the screen's one action row,
   * so the grid is lent back to whoever mounted this listing rather than being fenced behind a
   * second strip of controls above the table.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import type { Snippet } from "svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import { listConflictsChecks, type ConflictsCheckSummary } from "./conflicts-api.ts";
  import { runStatusVocabulary } from "./conflicts-vocabulary.ts";
  import {
    checkRegisterVocabulary,
    conflictsCheckColumns,
    CHECK_REGISTER_INITIAL_SORT,
    EMPTY_CHECK_VOCABULARY,
    FLOOR_RAISED,
    RAN_AUTOMATICALLY,
    SOURCE_UNRECORDED,
  } from "./check-columns.ts";

  let {
    matterId = null,
    caption,
    emptyTitle,
    emptyBody,
    emptyActions,
    grid = $bindable(null),
    reread = $bindable(() => {}),
    onOpenCheck,
    search = "",
  }: {
    /** Narrow the log to one matter, or null for everything the firm has run. */
    matterId?: string | null;
    /** The table's accessible caption — what this particular listing is. */
    caption: string;
    /** The heading when the firm genuinely has no check at this scope. */
    emptyTitle: string;
    /** What belongs here, said to somebody looking at nothing. */
    emptyBody: Snippet;
    /** The way out of an empty log, which is the same primary action the surface carries. */
    emptyActions?: Snippet;
    /**
     * The grid, handed back to the surface. The clear-filters control belongs to the screen's one
     * action row rather than to a second strip above the table, and it needs this.
     */
    grid?: DataTable.DataTableGridState<ConflictsCheckSummary> | null;
    /** Read the log again, handed back so a surface can refresh after it writes. */
    reread?: () => void;
    /** Open one check. Where that leads belongs to the surface, not to this listing. */
    onOpenCheck: (checkId: string) => void;
    /**
     * What the log is being asked, as the server was last asked for it. Bound IN from the surface,
     * because the control that carries it belongs in the screen's one action row while the read it
     * narrows is here. It is part of the read's SUBJECT below, so a new question replaces the rows
     * rather than appending to them.
     */
    search?: string;
  } = $props();

  const list = new PagedList<ConflictsCheckSummary>("Couldn't load the firm's conflicts log.");
  const checks = $derived(list.items);
  const loadFailure = $derived(list.failure);

  // The roster is what turns an actor handle into the member who asked. It is read once per
  // session and shared, so mounting this listing twice does not ask twice.
  $effect(() => {
    void firmRoster.load(fetch);
  });

  // The query is part of what identifies the rows on screen: asking a different question is a
  // different listing, not more of the same one.
  const subject = $derived(`${matterId ?? ""}:${search.trim()}`);

  function read(cursor?: string) {
    return listConflictsChecks(fetch, {
      ...(matterId === null ? {} : { matterId }),
      ...(search.trim() === "" ? {} : { search: search.trim() }),
      ...(cursor === undefined ? {} : { cursor }),
    });
  }

  $effect(() => {
    const asked = subject;
    if (list.showing(asked)) return;
    list.reset(asked);
    void list.load(read);
  });

  function loadMore(): void {
    void list.loadMore(read);
  }

  reread = () => {
    list.reset(subject);
    void list.load(read);
  };

  const vocabulary = $derived(
    firmRoster.members === null
      ? EMPTY_CHECK_VOCABULARY
      : checkRegisterVocabulary(firmRoster.members),
  );

  grid = DataTable.createDataTableGrid<ConflictsCheckSummary>({
    columns: () => conflictsCheckColumns(vocabulary),
    rows: () => checks ?? [],
    rowKey: (check) => check.id,
    initialSort: CHECK_REGISTER_INITIAL_SORT,
    itemNoun: { singular: "check", plural: "checks" },
    onActivate: (check) => onOpenCheck(check.id),
  });
  // Bound out above, and read back here so the markup below does not have to narrow a nullable
  // prop on every reference. The grid is created once, at init, and never replaced.
  const ownGrid = grid;

  // A search narrows the log exactly as a column filter does — the reader cannot tell which half is
  // holding rows back, and should not have to — so the empty state answers for both.
  const narrowed = $derived((grid?.activeFilterCount ?? 0) > 0 || search.trim() !== "");
</script>

{#snippet checkCell({ column, text, row }: DataTable.GridCellContext<ConflictsCheckSummary>)}
  {#if column.id === "runState" && row.runStatus !== null}
    <!-- Where the latest run is. A settled run wears the calm word; a failed one the open-question
         tone, because a check whose last run stopped short is one somebody has to look at. -->
    {@const word = runStatusVocabulary(row.runStatus)}
    <Badge variant={word.tone} title={word.meaning}>{word.label}</Badge>
  {:else if column.id === "floorRaised"}
    {#if text === FLOOR_RAISED}
      <!-- It searched WIDER than asked. Worth saying, because it explains a result set larger than
           whoever asked for it expected. -->
      <Badge variant="neutral">{text}</Badge>
    {:else}
      <span class="text-text-muted">{text}</span>
    {/if}
  {:else if text === RAN_AUTOMATICALLY || text === SOURCE_UNRECORDED}
    <!-- Neither is a person, so neither is set in a person's register. -->
    <span class="text-text-muted">{text}</span>
  {:else if text === ""}
    <span class="text-text-muted">&mdash;</span>
  {:else}
    {text}
  {/if}
{/snippet}

<div class="flex min-h-0 flex-1 flex-col gap-16">
  {#if loadFailure !== null}
    <FailureNotice
      failure={loadFailure}
      title="Couldn't Load the Conflicts Log"
      fallback={list.failureMessage ?? undefined}
      onRetry={reread}
    />
  {:else}
    <DataTable.Grid
      grid={ownGrid}
      class="min-h-0 flex-1"
      {caption}
      cell={checkCell}
      loading={checks === null}
    >
    </DataTable.Grid>

    <!-- The counts strip: how much of the log is on screen, and the way to the rest of it. One
         line at a fixed height, so it never reflows. -->
    <DataTable.GridFooter grid={ownGrid}>
      {#snippet end()}
        <DataTable.LoadMore
          noun="checks"
          more={list.nextCursor !== null}
          loading={list.loadingMore}
          onLoad={loadMore}
        />
      {/snippet}
    </DataTable.GridFooter>
  {/if}
</div>
