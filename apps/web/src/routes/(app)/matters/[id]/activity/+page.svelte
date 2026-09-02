<script lang="ts">
  /*
   * The matter's activity: what has happened on this case, in order, from every part of the platform
   * that records anything.
   *
   * ONE READ, FIFTEEN SUBSYSTEMS, AND NO SECOND TIMELINE TABLE. The server federates each declared
   * source in place — mail saved to the matter, documents added and assembled, events, deadlines,
   * time, costs, client money, items in custody, conflicts checks, notes, and the matter's own
   * opening and closing — under one sort key and one cursor, and on this matter-scoped read each
   * source NAMES its rows through its own describe statement, behind its own read capability.
   * Nothing is copied into an activity table, so this screen cannot disagree with the register
   * behind it.
   *
   * THIS FILE NAMES NO SOURCE AND SWITCHES ON NONE. How a row reads, what glyph it wears, which
   * facts ride beside it, how it opens and how one is made are all declared by the subsystem that
   * owns the row, in an ActivityContribution beside that subsystem's own code
   * ($lib/activity/contribution.ts). This screen draws what the contributions say. A subsystem
   * joining the timeline reaches it with a describe on its source and a contribution in the
   * registry, and no line here.
   *
   * IT IS THE PRODUCT'S TABLE. Sorting, per-column filtering, the set filter with its counts,
   * show/hide/pin/reorder/resize through each column heading's own right-click menu, the footer
   * that says how many rows a filter is hiding — all of it is the shared grid's, rather than a
   * filter bar written again above a hand-built list. Narrowing to notes is the Section column;
   * narrowing to last month is the Date column; narrowing to one person is Who.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FileIcon from "@magna-carta/design-system/file-icon";
  import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Plus from "@lucide/svelte/icons/plus";
  import { goto } from "$app/navigation";
  import {
    ACTIVITY_COLUMN_IDENTIFIERS,
    activityColumns,
    activityRows,
    type ActivityRow,
  } from "$lib/activity/activity-columns.ts";
  import type { ActivityWindow } from "$lib/activity/contribution.ts";
  import { ACTIVITY_CREATE_VERBS } from "$lib/activity/contributions.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { listMatterActivity, type ActivityEntry } from "$lib/matters/activity-api.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";
  import NoteWindowHost from "$lib/matters/note-window-host.svelte";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import { FirmRoster } from "$lib/members/firm-roster.svelte.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  const list = new PagedList<ActivityEntry>("This matter's activity could not be read.");
  const roster = new FirmRoster();

  const entries = $derived(list.items);
  const failure = $derived(list.failure);
  // Bumped after a write or a failure, so the list re-reads what the server now holds.
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

  function nameOf(userId: string | null): string | null {
    if (userId === null) return null;
    const member = (roster.members ?? []).find((candidate) => candidate.userId === userId);
    return member?.displayName ?? null;
  }

  // Today where the reader is, for the one comparison a stored fact must not make: overdue.
  function todayHere(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${String(now.getFullYear())}-${month}-${day}`;
  }

  const rows = $derived(
    activityRows(entries ?? [], {
      nameOf,
      facts: {
        money: (amountMinor, currency) => formatMoney(amountMinor / 100, { currency }),
        date: formatDate,
        today: todayHere(),
      },
    }),
  );

  // --- opening and making records, through the contributions' own answers ---

  let noteWindowOpen = $state(false);
  let unattachedNames = $state<readonly string[]>([]);

  function openWindow(window: ActivityWindow): void {
    // One case today; a subsystem that adds a window adds its case here and nowhere else.
    if (window === "note") noteWindowOpen = true;
  }

  function openRow(row: ActivityRow): void {
    const target = row.target;
    if (target.kind === "navigate") void goto(target.href);
    else if (target.kind === "window") openWindow(target.window);
    // "none": the row's own title says why there is nowhere to go.
  }

  const grid = DataTable.createDataTableGrid<ActivityRow>({
    columns: activityColumns,
    rows: () => rows,
    rowKey: (row) => row.key,
    initialSort: { columnId: ACTIVITY_COLUMN_IDENTIFIERS.date, direction: "descending" },
    itemNoun: { singular: "entry", plural: "entries" },
    onActivate: openRow,
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
  {:else if column.id === ACTIVITY_COLUMN_IDENTIFIERS.type}
    <!-- The glyph is the owning subsystem's: a file wears the file manager's own icon over the same
         inputs the Files section draws it from; everything else wears its contribution's icon. -->
    <span class="flex items-center gap-4 whitespace-nowrap">
      {#if row.glyph?.kind === "file"}
        <FileIcon
          fileName={row.glyph.fileName}
          contentType={row.glyph.contentType ?? undefined}
          class="size-16 shrink-0"
        />
      {:else if row.glyph?.kind === "icon"}
        {@const Glyph = row.glyph.icon}
        <Glyph aria-hidden="true" class="size-16 shrink-0 text-text-muted" />
      {/if}
      {row.type}
    </span>
  {:else if column.id === ACTIVITY_COLUMN_IDENTIFIERS.name}
    <!-- The row's own name, and the way out of it: a chronology is read to find something, and
         finding it is followed by opening it — into the owning section, or in a window here. -->
    {#if row.target.kind === "navigate"}
      <a href={row.target.href} class="flex min-w-0 items-center gap-4" title={row.name}>
        <span class="truncate underline">{row.name}</span>
        <ArrowUpRight aria-hidden="true" class="size-12 shrink-0 text-text-muted" />
      </a>
    {:else if row.target.kind === "window"}
      <button
        type="button"
        class="block max-w-full truncate text-start underline"
        title={row.name}
        onclick={() => openRow(row)}
      >
        {row.name}
      </button>
    {:else}
      <span class="block truncate" title={row.target.reason}>{row.name}</span>
    {/if}
  {:else if column.id === ACTIVITY_COLUMN_IDENTIFIERS.details}
    <span class="block truncate" title={row.details}>
      {#each row.facts as fact, index (index)}
        {#if index > 0}<span class="text-text-muted"> · </span>{/if}
        {#if fact.label !== undefined}<span class="text-text-muted">{fact.label} </span>{/if}
        <span
          class={fact.tone === "danger"
            ? "text-status-danger"
            : fact.tone === "muted"
              ? "text-text-muted"
              : undefined}>{fact.value}</span
        >
      {/each}
    </span>
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
    <!-- A screen with no way to create the thing it lists is not built. This one lists everything,
         so its one primary control offers every record a contribution can make from here — one verb
         as a button, several as a menu. -->
    {#if ACTIVITY_CREATE_VERBS.length === 1}
      {@const verb = ACTIVITY_CREATE_VERBS[0]}
      {#if verb !== undefined}
        <Button variant="secondary" disabled={isSample} onclick={() => openWindow(verb.window)}>
          <Plus aria-hidden="true" />
          {verb.label}
        </Button>
      {/if}
    {:else if ACTIVITY_CREATE_VERBS.length > 1}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class={buttonClasses({ variant: "secondary", size: "default" })}
          disabled={isSample}
        >
          <Plus class="size-16" aria-hidden="true" />
          New
          <ChevronDown class="size-16" aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" style="min-inline-size: var(--mc-size-popover)">
          {#each ACTIVITY_CREATE_VERBS as verb (verb.sourceKey)}
            <DropdownMenu.Item onSelect={() => openWindow(verb.window)}>{verb.label}</DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
  </div>

  {#if unattachedNames.length > 0}
    <Alert.Root variant="warning">
      <Alert.Title>Note Written, Documents Not Attached</Alert.Title>
      <Alert.Description>
        The note is on the matter. {unattachedNames.length === 1
          ? "This document was not attached to it"
          : "These documents were not attached to it"}: {unattachedNames.join(", ")}. Open the note
        and attach {unattachedNames.length === 1 ? "it" : "them"} again.
      </Alert.Description>
    </Alert.Root>
  {/if}

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

    <NoteWindowHost
      bind:open={noteWindowOpen}
      matterId={matter.id}
      matterTitle={matter.title}
      onSaved={() => {
        unattachedNames = [];
        reloadToken += 1;
      }}
      onAttachmentsUnwritten={(names) => (unattachedNames = names)}
    />
  {/if}
</section>
