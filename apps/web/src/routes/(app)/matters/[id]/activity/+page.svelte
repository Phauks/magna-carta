<script lang="ts">
  /*
   * The matter's activity: what has happened on this case, in order, from every part of the platform
   * that records anything.
   *
   * ONE READ, FOURTEEN SUBSYSTEMS, AND NO SECOND TIMELINE TABLE. The server federates each declared
   * source in place — mail saved to the matter, documents added and assembled, events, deadlines,
   * time, costs, client money, items in custody, conflicts checks, notes, and the matter's own
   * opening and closing — under one sort key and one cursor. Nothing is copied into an activity
   * table, so this screen cannot disagree with the register behind it, and a subsystem joining the
   * timeline reaches this page without a line of work here.
   *
   * IT IS THE PRODUCT'S TABLE. Sorting, per-column filtering, the set filter with its counts,
   * show/hide/pin/reorder/resize, the search, the footer that says how many rows a filter is hiding
   * — all of it is the shared grid's, on the owner's direction, rather than a filter bar written
   * again above a hand-built list. Narrowing to notes is the Kind column; narrowing to last month is
   * the Date column; narrowing to one person is Who.
   *
   * EVERY ROW SAYS WHAT THE THING IS. The federated read carries almost no words, because it spans
   * matters; this screen names its rows by following the deep link EAGERLY instead — one bounded
   * read of each owning subsystem's own listing, through that subsystem's own access gate, joined on
   * the row identity the timeline already carries. That is what keeps a per-seat permission honest
   * without the timeline having to know about one: a member who may not read notes gets a refusal
   * from the notes read and rows that state what happened without saying what was written.
   *
   * ADDING A SOURCE IS ONE ENTRY IN activity-presentation.ts (and, where it can name its rows, one
   * loader in activity-detail.svelte.ts) — this file names no source and switches on none.
   */
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import { goto } from "$app/navigation";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { listMatterActivity, type ActivityEntry } from "$lib/matters/activity-api.ts";
  import {
    ACTIVITY_COLUMN_IDENTIFIERS,
    activityColumns,
    activityRows,
    type ActivityRow,
  } from "$lib/matters/activity-columns.ts";
  import { ActivityDetails } from "$lib/matters/activity-detail.svelte.ts";
  import { presentationFor } from "$lib/matters/activity-presentation.ts";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import { FirmRoster } from "$lib/members/firm-roster.svelte.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  const list = new PagedList<ActivityEntry>("This matter's activity could not be read.");
  const roster = new FirmRoster();
  // What each row's own subsystem says about it, read once per matter through that subsystem's own
  // access gate. A source with no loader keeps the platform's own sentence.
  const details = new ActivityDetails();

  const entries = $derived(list.items);
  const failure = $derived(list.failure);
  // Bumped to re-read after a failure. Nothing else re-reads: narrowing belongs to the table now.
  let reloadToken = $state(0);

  /*
   * The activity read, and nothing else in this effect. A screen whose only subject is one read must
   * not let anything else stand between the subject changing and the read being asked for.
   */
  $effect(() => {
    const matterId = matter.id;
    const subject = `${matterId}:${String(reloadToken)}`;
    if (list.showing(subject)) return;
    list.reset(subject);
    if (isSample) {
      list.settleEmpty();
      return;
    }
    void list.load((cursor) => listMatterActivity(fetch, matterId, cursor));
  });

  // The roster resolves an actor into a person. Its own effect: a firm whose member list cannot be
  // read still gets its activity, with the Who column empty rather than the page failing.
  $effect(() => {
    if (isSample) return;
    void roster.load(fetch);
  });

  /*
   * The detail behind the rows, read once per matter and kept across pages. Its own effect for the
   * same reason the roster has one: a subsystem that will not answer costs its rows their name,
   * never the chronology.
   */
  $effect(() => {
    const matterId = matter.id;
    if (isSample || details.showing(matterId)) return;
    details.reset(matterId);
    void details.load(fetch, matterId, {
      money: (amount, currency) => formatMoney(amount, { currency }),
    });
  });

  function nameOf(userId: string | null): string | null {
    if (userId === null) return null;
    const member = (roster.members ?? []).find((candidate) => candidate.userId === userId);
    return member?.displayName ?? null;
  }

  const rows = $derived(
    activityRows(entries ?? [], {
      detailFor: (sourceKey, rowId) => details.detailFor(sourceKey, rowId),
      nameOf,
    }),
  );

  const grid = DataTable.createDataTableGrid<ActivityRow>({
    columns: activityColumns,
    rows: () => rows,
    rowKey: (row) => row.key,
    initialSort: { columnId: ACTIVITY_COLUMN_IDENTIFIERS.date, direction: "descending" },
    itemNoun: { singular: "entry", plural: "entries" },
    // Opening a row opens the record itself, in the section that holds it. A row whose section is
    // not built yet activates to nothing rather than to a screen that cannot honour it.
    onActivate: (row) => {
      if (row.href !== null) void goto(row.href);
    },
  });
</script>

<svelte:head>
  <title>Activity · {matter.title} · Magna Carta</title>
</svelte:head>

{#snippet cell({ row, column, text }: DataTable.GridCellContext<ActivityRow>)}
  {#if column.id === ACTIVITY_COLUMN_IDENTIFIERS.date}
    <span class="whitespace-nowrap tabular-nums">{formatDate(row.day)}</span>
  {:else if column.id === ACTIVITY_COLUMN_IDENTIFIERS.time}
    <span class="whitespace-nowrap text-text-muted tabular-nums">{row.time}</span>
  {:else if column.id === ACTIVITY_COLUMN_IDENTIFIERS.kind}
    {@const presentation = presentationFor(row.entry.sourceKey)}
    <span class="flex items-center gap-4 whitespace-nowrap">
      {#if presentation !== undefined}
        {@const Glyph = presentation.icon}
        <Glyph aria-hidden="true" class="size-16 shrink-0 text-text-muted" />
      {/if}
      {row.kind}
    </span>
  {:else if column.id === ACTIVITY_COLUMN_IDENTIFIERS.what}
    <!-- The row's own name where its subsystem could give one, and the way out of it: a chronology
         is read to find something, and finding it is followed by opening it. -->
    {#if row.href === null}
      <span class="block truncate" title={row.what}>{row.what}</span>
    {:else}
      <a href={row.href} class="flex min-w-0 items-center gap-4" title={row.what}>
        <span class="truncate underline">{row.what}</span>
        <ArrowUpRight aria-hidden="true" class="size-12 shrink-0 text-text-muted" />
      </a>
    {/if}
  {:else if column.id === ACTIVITY_COLUMN_IDENTIFIERS.details}
    <span class="block truncate text-text-muted" title={row.details}>{row.details}</span>
  {:else}
    <span class="block truncate" title={text}>{text}</span>
  {/if}
{/snippet}

{#snippet emptyRegister()}
  <EmptyState title="Nothing has been recorded on this matter yet." />
{/snippet}

{#snippet footerEnd()}
  {#if list.nextCursor !== null}
    <!-- The table filters and sorts what is loaded; this loads more of the record to filter. The
         footer's count is therefore of what is loaded, and this control's presence says so. -->
    <Button
      variant="secondary"
      size="sm"
      disabled={list.loadingMore}
      onclick={() => void list.loadMore((cursor) => listMatterActivity(fetch, matter.id, cursor))}
    >
      {list.loadingMore ? "Loading" : "Load Older"}
    </Button>
  {/if}
{/snippet}

<section class="flex min-h-0 flex-1 flex-col gap-12">
  <div class="flex flex-wrap items-center justify-between gap-8 border-b border-border-strong pb-8">
    <h2 class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
      Activity
    </h2>
    <!-- No columns button and no hint: a column's controls are summoned from the column heading's
         own right-click, which the shared grid renders on every register. -->
  </div>

  {#if failure !== null}
    <FailureNotice
      {failure}
      title="Activity Unavailable"
      fallback="This matter's activity could not be read."
      onRetry={() => (reloadToken += 1)}
    />
  {/if}

  {#if isSample}
    <EmptyState title="This is a sample matter, so nothing has happened on it." />
  {:else}
    <DataTable.Grid
      {grid}
      {cell}
      class="max-h-svh"
      caption="Everything recorded on this matter, newest first"
      empty={emptyRegister}
      loading={entries === null}
    />
    <DataTable.GridFooter {grid} end={footerEnd} />
  {/if}
</section>
