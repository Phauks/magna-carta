<script lang="ts">
  /*
   * TIME — the firm's time record, across every matter.
   *
   * THE THIRD PLACE, AND THE ONLY ONE THAT READS BACK. Time has three surfaces and each answers a
   * different question. The top bar's Time Sheet is capture: it opens over whatever you were doing
   * so writing a row never costs you your place. A matter's Time tab is that matter's record. This
   * is the firm's — "what time went on the record this week", which is the question a timekeeper
   * asks of their own work every day and a supervisor asks of the firm's every month, and which
   * neither of the other two can answer without visiting matters one at a time.
   *
   * THE TABLE IS THE ONLY THING THAT NARROWS IT. The screen opens on the whole record, newest work
   * date first, and every narrowing is a column's own filter: the Date column bounds the period,
   * Status picks a state, Timekeeper picks a person. The screen used to carry a period dropdown and
   * a whose-time dropdown in its header, each answering a question a column already asked, and each
   * worded differently from the same control on the Fees and Costs screens (the owner's ruling of
   * 2026-09-11, docs/conventions/time-tab-rulings.md round twelve).
   *
   * A COLUMN FILTER THAT ONLY NARROWED THE LOADED PAGE WOULD NOT BE A FILTER. The record is
   * cursor-paged, so the filters the listing honours — the two date bounds, the Status column's
   * whole selection, one timekeeper — and the search are sent to it as its own parameters and
   * re-read, and the table's in-browser filter then runs over rows that already match.
   *
   * WHOSE TIME IS A PERMISSION, NOT A PREFERENCE. Reading anybody else's time — one colleague's or
   * the whole firm's — takes time:viewFirm, and the server refuses without it. A member without it
   * is always asking for their own time, whatever the Timekeeper column says, and that column offers
   * them nobody else: an inventory of colleagues they cannot ask for would be an inventory of what
   * somebody cannot have.
   *
   * THE FILTERS ARE IN THE ADDRESS. A supervisor looking at one person's month sends that view to
   * somebody by sending the link, so the bounds, the statuses and the timekeeper ride the URL and
   * the screen opens on what the address names.
   *
   * THE SEARCH IS THE PRODUCT'S ONE CONTROL, and it is the listing's own: a word is looked for in
   * the narrative, the entry number, the matter's title and number and the timekeeper's name across
   * the whole record, never only in the page in hand.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import CreateControl from "@magna-carta/design-system/create-control";
  import { DateRangePicker } from "@magna-carta/design-system/date-range-picker";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import { page } from "$app/state";
  import { replaceState } from "$app/navigation";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import { FirmRoster } from "$lib/members/firm-roster.svelte.ts";
  import { readSession } from "$lib/matters/matters-api.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import type { TimeEntrySummary } from "$lib/matters/time-api.ts";
  import { FirmMatters } from "$lib/time/firm-matters.svelte.ts";
  import TimeRecordWindow from "$lib/time/time-record-window.svelte";
  import {
    TIME_COLUMN_IDENTIFIERS,
    TIME_STATUS_CHOICES,
    chargeAmount,
    durationParts,
    firmTimeColumns,
    personInitials,
    timekeeperOf,
  } from "$lib/time/time-columns.ts";
  import { ledgerCurrency, periodTotals } from "$lib/time/time-figures.ts";
  import { matterDisplay } from "$lib/time/time-sheet-model.ts";
  import { listTimeEntriesInPeriod, type TimePeriodQuery } from "$lib/time/time-operations.ts";
  import { VIEW_FIRM_TIME_PERMISSION, periodFigureReading } from "$lib/time/time-period.ts";
  import {
    addressAfterFilters,
    choicesFilter,
    choicesOf,
    civilDateOrNull,
    dateBoundsOf,
    dateRangeFilter,
    filtersSeededBy,
    singleMemberFilter,
    singleMemberOf,
  } from "$lib/money/listing-scope.ts";

  // ---- who is asking -----------------------------------------------------------------------------

  let sessionUserId = $state<string | null>(null);
  let permissions = $state<readonly string[]>([]);
  /** Null until the session read lands: not knowing yet is a different fact from not being allowed. */
  let sessionRead = $state(false);
  const maySeeFirmTime = $derived(permissions.includes(VIEW_FIRM_TIME_PERMISSION));

  const roster = new FirmRoster();
  const firmMatters = new FirmMatters();
  const activeMembers = $derived(
    (roster.members ?? []).filter((member) => member.status === "active"),
  );

  let bootstrapped = false;
  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void roster.load(fetch);
    // The matters are read for the Matter column's names and for the record window's picker. The
    // record is READ without them — a name that has not arrived leaves one column blank, and a
    // screen that waited on the firm's whole matter list before showing any time would be slower
    // than it has any reason to be.
    void firmMatters.load(fetch);
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") {
        sessionUserId = outcome.value.user.id;
        permissions = outcome.value.permissions;
      }
      sessionRead = true;
    })();
  });

  // ---- the table ---------------------------------------------------------------------------------

  const list = new PagedList<TimeEntrySummary>("The firm's time could not be read.");
  const entries = $derived(list.items ?? []);
  /** Bumped after a write, so the record re-reads what the server now holds rather than guessing. */
  let reloadToken = $state(0);

  const currency = $derived(ledgerCurrency(entries));
  const money = (amountMinor: number): string => formatMoney(amountMinor / 100, { currency });

  /**
   * How a row names its matter: the number and the title, as the picker and the sheet name it.
   *
   * Empty where the firm's matters have not been read, or do not reach this one. The cell renders
   * that as its own blank and the record window takes it as no title at all — never a raw handle,
   * which names the matter to nobody, and never a stand-in, which names the wrong thing.
   */
  function matterText(entry: TimeEntrySummary): string {
    const matter = firmMatters.byIdentifier(entry.matterId);
    return matter === undefined ? "" : matterDisplay(matter);
  }

  /** The same name where there is one, as the record window's optional title takes it. */
  function matterTitleOf(entry: TimeEntrySummary | null): string | null {
    if (entry === null) return null;
    const named = matterText(entry);
    return named === "" ? null : named;
  }

  const grid = DataTable.createDataTableGrid<TimeEntrySummary>({
    columns: () =>
      firmTimeColumns(
        currency,
        matterText,
        maySeeFirmTime
          ? { timekeeperNames: activeMembers.map((member) => member.displayName) }
          : {},
      ),
    rows: () => entries,
    rowKey: (entry) => entry.id,
    initialSort: { columnId: TIME_COLUMN_IDENTIFIERS.workDate, direction: "descending" },
    itemNoun: { singular: "entry", plural: "entries" },
    // A void stays on the record with its chip and counts toward nothing.
    totalIncludes: (entry) => entry.status !== "void",
    onActivate: (entry) => openRecord(entry, false),
  });

  // ---- the scope: what the columns ask the listing for ------------------------------------------

  /*
   * The address seeds the filters once, on open, so a linked view opens already narrowed. The Date
   * and Status columns need nothing else; the Timekeeper column shows names, so its seed waits on
   * the roster to say what the address's handle is called.
   */
  let seededFromAddress = false;
  $effect(() => {
    if (seededFromAddress) return;
    seededFromAddress = true;
    grid.filters = filtersSeededBy(grid.filters, {
      [TIME_COLUMN_IDENTIFIERS.workDate]: dateRangeFilter(
        civilDateOrNull(page.url.searchParams.get("from")),
        civilDateOrNull(page.url.searchParams.get("to")),
      ),
      [TIME_COLUMN_IDENTIFIERS.status]: choicesFilter(
        page.url.searchParams.getAll("status"),
        TIME_STATUS_CHOICES,
      ),
    });
  });
  let timekeeperSeeded = false;
  $effect(() => {
    if (timekeeperSeeded || roster.members === null) return;
    timekeeperSeeded = true;
    grid.filters = filtersSeededBy(grid.filters, {
      [TIME_COLUMN_IDENTIFIERS.timekeeper]: singleMemberFilter(
        page.url.searchParams.get("timekeeper"),
        roster.members,
      ),
    });
  });

  /*
   * The search is the listing's own, so it reads the whole record rather than the page in the
   * browser; it waits for typing to pause because the read leaves the machine.
   */
  let searchText = $state("");
  let appliedSearch = $state("");

  const dateBounds = $derived(dateBoundsOf(grid.filterFor(TIME_COLUMN_IDENTIFIERS.workDate)));
  const statusChoices = $derived(
    choicesOf(grid.filterFor(TIME_COLUMN_IDENTIFIERS.status), TIME_STATUS_CHOICES),
  );
  const timekeeperChoice = $derived(
    maySeeFirmTime
      ? singleMemberOf(grid.filterFor(TIME_COLUMN_IDENTIFIERS.timekeeper), activeMembers)
      : undefined,
  );

  /*
   * What is asked of the listing. Nothing is read until the session has landed: the session decides
   * whose time may be asked for, and reading "everyone" in the gap and correcting it a moment later
   * would be one refused request per load for every member who cannot ask that question.
   */
  const periodQuery = $derived.by((): TimePeriodQuery | null => {
    if (!sessionRead) return null;
    return {
      ...dateBounds,
      // A member who may read only their own time is always asking for it, whatever the column says.
      timekeeperUserId: maySeeFirmTime ? (timekeeperChoice ?? null) : sessionUserId,
      ...(statusChoices.length === 0 ? {} : { statuses: statusChoices }),
      ...(appliedSearch.trim() === "" ? {} : { search: appliedSearch.trim() }),
    };
  });

  $effect(() => {
    const query = periodQuery;
    if (query === null) return;
    const subject = `${JSON.stringify(query)}:${String(reloadToken)}`;
    if (list.showing(subject)) return;
    list.reset(subject);
    void list.load((cursor) =>
      listTimeEntriesInPeriod(fetch, { ...query, ...(cursor === undefined ? {} : { cursor }) }),
    );
  });

  function loadMore(): void {
    const query = periodQuery;
    if (query === null) return;
    void list.loadMore((cursor) =>
      listTimeEntriesInPeriod(fetch, { ...query, ...(cursor === undefined ? {} : { cursor }) }),
    );
  }

  /*
   * The filters the listing honours ride the address, so the view is a link somebody can send.
   * `replaceState` rather than a navigation: narrowing is not a place in the reader's history, it
   * is the same screen looking at fewer rows, and stacking every adjustment would make Back useless.
   * Nothing is written until the reads that seed the filters have landed, so an address is never
   * rewritten out from under the seed that has not been applied yet.
   */
  $effect(() => {
    if (!sessionRead || roster.members === null) return;
    const next = addressAfterFilters(page.url, {
      from: dateBounds.from,
      to: dateBounds.to,
      status: statusChoices,
      timekeeper: timekeeperChoice,
    });
    if (next.href !== page.url.href) replaceState(next, page.state);
  });

  const narrowed = $derived(appliedSearch.trim() !== "" || grid.activeFilterCount > 0);
  const narrowingSummary = $derived(
    appliedSearch.trim() === ""
      ? "Show every entry"
      : `Showing "${appliedSearch.trim()}" of the record`,
  );

  function clearNarrowing(): void {
    searchText = "";
    appliedSearch = "";
    grid.clearAllFilters();
  }

  const figures = $derived(
    periodFigureReading(periodTotals(grid.isFiltered ? grid.rowsInView : entries), money),
  );

  // ---- one entry ---------------------------------------------------------------------------------

  let windowOpen = $state(false);
  let windowEditing = $state(false);
  let windowEntry = $state<TimeEntrySummary | null>(null);

  /* Whose draft this is to work. Delegated entry is not served, so the timekeeper is the answer. */
  function canWorkDraft(entry: TimeEntrySummary): { allowed: boolean; reason: string } {
    if (entry.status !== "draft") return { allowed: false, reason: statusEntry(entry.status).meaning };
    if (sessionUserId !== null && entry.timekeeperUserId === sessionUserId) {
      return { allowed: true, reason: "Change any part of this draft." };
    }
    return { allowed: false, reason: `Only ${timekeeperOf(entry)} can edit this draft.` };
  }

  function openRecord(entry: TimeEntrySummary, editing: boolean): void {
    windowEntry = entry;
    windowEditing = editing && canWorkDraft(entry).allowed;
    windowOpen = true;
  }

  function openNew(): void {
    windowEntry = null;
    windowEditing = true;
    windowOpen = true;
  }

  /*
   * A new entry takes a matter, and this screen is on none — so it can only be started once the
   * firm's matters have arrived for the window's picker to offer.
   */
  const createRefusal = $derived.by((): string | undefined => {
    if (firmMatters.matters === null) return "Reading the firm's matters.";
    if (firmMatters.matters.length === 0) {
      return (
        firmMatters.failure ??
        "The firm has no matter to record time against yet. Time is captured against a file."
      );
    }
    return undefined;
  });

  const readRefusal = $derived.by((): string | null => {
    const failure = list.failure;
    if (failure === null) return null;
    if (failure.problem?.status !== 403) return null;
    return permissionRefusal("Reading time that is not your own", VIEW_FIRM_TIME_PERMISSION);
  });
</script>

<svelte:head><title>Time · Magna Carta</title></svelte:head>

{#snippet cell({ row, column, text }: DataTable.GridCellContext<TimeEntrySummary>)}
  {#if column.id === TIME_COLUMN_IDENTIFIERS.matter}
    {#if text === ""}
      <!-- The entry is on a matter — the record requires one — but its name has not been read.
           An honest blank, never the raw handle. -->
      <span class="text-text-subtle" title="This matter's name has not been read yet.">—</span>
    {:else}
      <span class="block truncate" title={text}>{text}</span>
    {/if}
  {:else if column.id === TIME_COLUMN_IDENTIFIERS.timekeeper}
    {@const name = timekeeperOf(row)}
    <span class="inline-flex items-center gap-8 whitespace-nowrap">
      <span
        class="inline-flex size-20 items-center justify-center rounded-full bg-surface-raised text-xs text-text-muted"
        aria-hidden="true">{personInitials(name)}</span
      >
      {name}
    </span>
  {:else if column.id === TIME_COLUMN_IDENTIFIERS.description}
    <span class="block truncate" title={row.narrative}>{row.narrative}</span>
  {:else if column.id === TIME_COLUMN_IDENTIFIERS.worked || column.id === TIME_COLUMN_IDENTIFIERS.hours}
    {@const parts = durationParts(
      column.id === TIME_COLUMN_IDENTIFIERS.worked ? row.rawDurationMinutes : row.durationMinutes,
    )}
    <span class="whitespace-nowrap tabular-nums">
      {parts.decimal}
      <span class="text-xs text-text-muted">{parts.clock}</span>
    </span>
  {:else if column.id === TIME_COLUMN_IDENTIFIERS.amount}
    {@const amount = chargeAmount(row)}
    <span class="whitespace-nowrap tabular-nums">
      {amount === null ? "—" : formatMoney(amount, { currency })}
    </span>
  {:else if column.id === TIME_COLUMN_IDENTIFIERS.billable}
    {#if row.billable}Yes{:else}<span class="text-text-muted">No</span>{/if}
  {:else if column.id === TIME_COLUMN_IDENTIFIERS.status}
    <Badge {...statusBadgeAttributes(row.status)}>{statusEntry(row.status).label}</Badge>
  {:else if column.id === TIME_COLUMN_IDENTIFIERS.workDate}
    <span class="whitespace-nowrap tabular-nums">{formatDate(row.workDate)}</span>
  {:else}
    {text}
  {/if}
{/snippet}

<div class="flex h-full min-h-0 flex-col gap-16">
  <ScreenHeader title="Time">
    {#snippet actions()}
      <!-- The search, then the create control, then the way back to everything: the same row, in
           the same order, as every other list screen. -->
      <ScreenSearch
        bind:value={searchText}
        label="Search the firm's time"
        searchOn="pause"
        fieldClass="w-2xs sm:w-xs"
        onsearch={(next) => {
          appliedSearch = next;
        }}
      />

      <CreateControl
        noun="Entry"
        title="Record one entry. It saves as a draft."
        refusal={createRefusal}
        onpress={openNew}
      />

      <DataTable.ClearFilters
        {grid}
        narrowing={{ narrowed, summary: narrowingSummary, clear: clearNarrowing }}
      />
    {/snippet}
  </ScreenHeader>

  {#if firmMatters.failure !== null}
    <!-- The matters are not this screen's subject, so their failure never fails it: the time is
         still true and only the Matter column goes quiet. -->
    <Alert.Root variant="warning">
      <Alert.Description>
        {firmMatters.failure} The Matter column is blank until they can be read.
      </Alert.Description>
    </Alert.Root>
  {/if}

  {#if list.failure !== null}
    {#if readRefusal !== null}
      <Alert.Root variant="danger">
        <Alert.Title>That Time Is Not Yours To Read</Alert.Title>
        <Alert.Description>{readRefusal}</Alert.Description>
      </Alert.Root>
    {:else}
      <FailureNotice
        failure={list.failure}
        title="The Time Could Not Be Read"
        fallback="The record itself is unaffected: nothing was changed by this failure."
        onRetry={() => (reloadToken += 1)}
      />
    {/if}
  {:else}
    <DataTable.Grid
      {grid}
      {cell}
      class="min-h-0 flex-1"
      caption="Time recorded across the firm's matters"
      loading={list.items === null || !sessionRead}
    >
    </DataTable.Grid>

    <DataTable.GridFooter {grid}>
      {#snippet end()}
        <span class="flex flex-wrap items-baseline gap-12">
          <DataTable.GridFigures {grid} {figures} />
          <DataTable.LoadMore
            noun="entries"
            more={list.nextCursor !== null}
            loading={list.loadingMore}
            onLoad={loadMore}
          />
        </span>
      {/snippet}
    </DataTable.GridFooter>

    {#if list.nextCursor !== null}
      <!-- The figures cover what is loaded, and the record is not fully loaded. Saying so is the
           difference between a running subtotal and a number somebody bills from. -->
      <p class="text-xs text-text-muted">
        Showing the {entries.length} most recent entries. The figures cover only what is loaded, so
        they are not the whole total until every page is read.
      </p>
    {/if}
  {/if}
</div>

<TimeRecordWindow
  bind:open={windowOpen}
  bind:editing={windowEditing}
  entry={windowEntry}
  matterId={windowEntry?.matterId ?? null}
  matterTitle={matterTitleOf(windowEntry)}
  matters={firmMatters.matters ?? []}
  mattersCapped={firmMatters.capped}
  members={roster.members ?? []}
  {sessionUserId}
  {canWorkDraft}
  onSaved={() => (reloadToken += 1)}
/>
