<script lang="ts">
  /*
   * The matter's activity, as one register — the component every home of the chronology mounts.
   *
   * ONE COMPONENT, MORE THAN ONE HOME. The Activity section is this register with its masthead and
   * its footer; the Overview's Recent activity tile is this register with a row budget and the
   * glance-level columns; a firm-wide feed will be this register over the firm's read with a
   * Matter column. A second implementation for a second home is how two chronologies come to
   * disagree, so there is one.
   *
   * ONE READ, SIXTEEN SUBSYSTEMS, AND NO SECOND TIMELINE TABLE. The server federates each declared
   * source in place under one sort key and one cursor, and on this matter-scoped read each source
   * NAMES its rows through its own describe statement, behind its own read capability. Nothing is
   * copied into an activity table, so this register cannot disagree with the record behind it.
   *
   * THIS FILE NAMES NO SOURCE AND SWITCHES ON NONE. How a row reads, what glyph it wears, which
   * facts ride beside it, how it opens and how one is made are all declared by the subsystem that
   * owns the row, in an ActivityContribution beside that subsystem's own code
   * ($lib/activity/contribution.ts). This register draws what the contributions say.
   *
   * IT IS THE PRODUCT'S TABLE. Sorting, per-column filtering, the set filter with its counts,
   * show/hide/pin/reorder/resize through each column heading's own right-click menu, the footer
   * that says how many rows a filter is hiding — all of it is the shared grid's. Narrowing to notes
   * is the Section column; narrowing to last month is the Date column; narrowing to one person is
   * Who.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import FileIcon from "@magna-carta/design-system/file-icon";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import { goto } from "$app/navigation";
  import {
    ACTIVITY_COLUMN_IDENTIFIERS,
    activityColumns,
    activityRows,
    type ActivityRow,
  } from "./activity-columns.ts";
  import type { ActivityWindow } from "./contribution.ts";
  import { ACTIVITY_CREATE_VERBS } from "./contributions.ts";
  import { ACTIVITY_WINDOWS } from "./windows.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { listMatterActivity, type ActivityEntry } from "$lib/matters/activity-api.ts";
  import { claimMatterCreate, SAMPLE_MATTER_REFUSAL } from "$lib/matters/create-action.svelte.ts";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import { FirmRoster } from "$lib/members/firm-roster.svelte.ts";
  import { printSheetDates } from "$lib/print-sheet";

  let {
    matterId,
    matterTitle,
    isSample = false,
    variant = "section",
    limit = 8,
  }: {
    matterId: string;
    matterTitle: string;
    /** A sample matter has no firm behind it, so nothing has happened on it. */
    isSample?: boolean;
    /**
     * `section` is the Activity section: the masthead with its create control, every column, the
     * footer that loads older entries. `recent` is a tile: the newest `limit` rows, the glance-level
     * columns, no chrome — the host says where the whole chronology is.
     */
    variant?: "section" | "recent";
    /** How many rows the `recent` variant shows. */
    limit?: number;
  } = $props();

  const recent = $derived(variant === "recent");

  const list = new PagedList<ActivityEntry>("This matter's activity could not be read.");
  const roster = new FirmRoster();

  const entries = $derived(list.items);
  const failure = $derived(list.failure);
  // Bumped after a write or a failure, so the list re-reads what the server now holds.
  let reloadToken = $state(0);

  /*
   * The activity read, and nothing else in this effect. A surface whose only subject is one read
   * must not let anything else stand between the subject changing and the read being asked for.
   */
  $effect(() => {
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
  // read still gets its activity, with the Who column empty rather than the surface failing.
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
    activityRows(recent ? (entries ?? []).slice(0, limit) : (entries ?? []), {
      nameOf,
      facts: {
        money: (amountMinor, currency) => formatMoney(amountMinor / 100, { currency }),
        ...printSheetDates(),
        today: todayHere(),
      },
    }),
  );

  // --- opening and making records, through the contributions' own answers ---

  // Which hosted window is up, on which record. The register names no window: it mounts whichever
  // key a row or a verb named, from the map the contributions' own windows register in.
  let windowKey = $state<ActivityWindow | null>(null);
  let windowRecordId = $state<string | null>(null);
  let windowOpen = $state(false);
  let unattachedNames = $state<readonly string[]>([]);

  /** Open a subsystem's window on one of its records, or on nothing to make a new one. */
  function openWindow(window: ActivityWindow, recordId: string | null): void {
    if (!(window in ACTIVITY_WINDOWS)) return;
    windowKey = window;
    windowRecordId = recordId;
    windowOpen = true;
  }

  function openRow(row: ActivityRow): void {
    const target = row.target;
    if (target.kind === "navigate") void goto(target.href);
    else if (target.kind === "window") openWindow(target.window, target.recordId);
    // "none": the row's own title says why there is nowhere to go.
  }

  /*
   * A screen carries ONE create control, in the matter header, and this register offers it every
   * record a contribution can make from here: one verb as the control's own press, several as its
   * choices. Only the section claims — a tile on another screen must not take that screen's control.
   */
  // The variant is what this register IS — the matter's activity section, or the overview's recent
  // tile — and both call sites pass it as a literal. It cannot change for a mounted instance, so the
  // claim is made once here rather than re-evaluated: a tile that became a section mid-life would be
  // a different screen, not a re-render.
  // svelte-ignore state_referenced_locally
  if (variant === "section") {
    claimMatterCreate("activity", () => {
      const refusal = isSample ? SAMPLE_MATTER_REFUSAL : undefined;
      const [only] = ACTIVITY_CREATE_VERBS;
      if (ACTIVITY_CREATE_VERBS.length === 1 && only !== undefined) {
        return {
          title: `${only.label} from the matter's activity.`,
          refusal,
          run: () => openWindow(only.window, null),
        };
      }
      return {
        title: "Record something on this matter.",
        refusal,
        choices: ACTIVITY_CREATE_VERBS.map((verb) => ({
          label: verb.label,
          icon: verb.icon,
          run: () => openWindow(verb.window, null),
        })),
      };
    });
  }

  const grid = DataTable.createDataTableGrid<ActivityRow>({
    columns: () => activityColumns({ recent }),
    rows: () => rows,
    rowKey: (row) => row.key,
    initialSort: { columnId: ACTIVITY_COLUMN_IDENTIFIERS.date, direction: "descending" },
    itemNoun: { singular: "entry", plural: "entries" },
    onActivate: openRow,
  });
</script>

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


{#snippet footerEnd()}
  {#if list.nextCursor !== null}
    <!-- The table filters and sorts what is loaded; this loads more of the record to filter. The
         footer's count is therefore of what is loaded, and this control's presence says so. -->
    <Button
      variant="secondary"
      size="sm"
      disabled={list.loadingMore}
      onclick={() => void list.loadMore((cursor) => listMatterActivity(fetch, matterId, cursor))}
    >
      {list.loadingMore ? "Loading" : "Load Older"}
    </Button>
  {/if}
{/snippet}

<div class={recent ? "flex flex-col gap-12" : "flex min-h-0 flex-1 flex-col gap-12"}>
  {#if !recent}
    <div
      class="flex flex-wrap items-center justify-between gap-8 border-b border-border-strong pb-8"
    >
      <FieldLabel as="h2">
        Activity
      </FieldLabel>
      <!-- The create control is the matter header's; this register claims it above. -->
    </div>
  {/if}

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

  <!-- The table stands whether or not the matter has a history: a sample matter settles empty
       rather than reading, and the grid draws its header row over its own empty body and says so
       there. A reader meets the shape the entries will arrive in. -->
  <DataTable.Grid
    {grid}
    {cell}
    class={recent ? undefined : "max-h-svh"}
    density={recent ? "compact" : "comfortable"}
    caption={recent
      ? "The newest entries recorded on this matter"
      : "Everything recorded on this matter, newest first"}
    loading={entries === null}
    placeholderCount={recent ? Math.min(limit, 4) : 8}
  />
  {#if !recent}
    <DataTable.GridFooter {grid} end={footerEnd} />
  {/if}

  {#if windowKey !== null}
    {@const Host = ACTIVITY_WINDOWS[windowKey]}
    {#if Host !== undefined}
      <Host
        bind:open={windowOpen}
        recordId={windowRecordId}
        {matterId}
        {matterTitle}
        onSaved={() => {
          unattachedNames = [];
          reloadToken += 1;
        }}
        onDeleted={() => (reloadToken += 1)}
        onAttachmentsUnwritten={(names) => (unattachedNames = names)}
      />
    {/if}
  {/if}
</div>
