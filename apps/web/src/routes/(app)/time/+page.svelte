<script lang="ts">
  /*
   * TIME — the firm's time record over a period, across every matter.
   *
   * THE THIRD PLACE, AND THE ONLY ONE THAT READS BACK. Time has three surfaces and each answers a
   * different question. The top bar's Time Sheet is capture: it opens over whatever you were doing
   * so writing a row never costs you your place. A matter's Time tab is that matter's record. This
   * is the period — "what time went on the record this week", which is the question a timekeeper
   * asks of their own work every day and a supervisor asks of the firm's every month, and which
   * neither of the other two can answer without visiting matters one at a time.
   *
   * IT WAS A SOON ROW FOR A REASON, AND THE REASON WAS THE SERVER. The listing behind time could
   * answer one timekeeper on one day, or one matter entire, and nothing else; asked for a span it
   * returned an empty list rather than scanning the table, which was right. The period listing
   * (`from`/`to` on GET /api/v1/time-entries) is what this screen is built on, and it is what made
   * flipping the sidebar row honest rather than a link to a page that could not read anything.
   *
   * TWO LAYERS OF NARROWING, AND THEY ARE DIFFERENT KINDS. The period and whose-time controls
   * change WHAT IS ASKED FOR: they re-read, and the answer is the whole record for that scope, page
   * by page. The table's own in-header filters narrow WHAT IS LOADED. Keeping the distinction
   * visible is why there is no free-text search box on this screen: a search that quietly covered
   * only the loaded page would tell a reader their word appears nowhere in a month it never looked
   * at. The columns' own filters are the search, and they say "Showing n of m" while they narrow.
   *
   * WHOSE TIME IS A PERMISSION, NOT A PREFERENCE. Reading anybody else's period — one colleague's
   * or the whole firm's — takes time:viewFirm, and the server refuses without it. The control is
   * absent rather than disabled for a member who does not hold it, because a disabled list of
   * colleagues is an inventory of what somebody cannot have.
   *
   * THE SCOPE IS IN THE ADDRESS. A supervisor looking at one person's month sends that view to
   * somebody by sending the link, so the timekeeper and the span ride the URL and the screen opens
   * on what the address names.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Popover from "@magna-carta/design-system/popover";
  import * as Select from "@magna-carta/design-system/select";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import Badge from "@magna-carta/design-system/badge";
  import CreateControl from "@magna-carta/design-system/create-control";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import { DateRangePicker } from "@magna-carta/design-system/date-range-picker";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import { parseDate } from "@internationalized/date";
  import Calendar from "@lucide/svelte/icons/calendar";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { page } from "$app/state";
  import { replaceState } from "$app/navigation";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import { FirmRoster } from "$lib/members/firm-roster.svelte.ts";
  import { readSession } from "$lib/matters/matters-api.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import type { TimeEntrySummary } from "$lib/matters/time-api.ts";
  import { FirmMatters } from "$lib/matters/firm-matters.svelte.ts";
  import TimeRecordWindow from "$lib/time/time-record-window.svelte";
  import {
    TIME_COLUMN_IDENTIFIERS,
    chargeAmount,
    durationParts,
    firmTimeColumns,
    personInitials,
    timekeeperOf,
  } from "$lib/time/time-columns.ts";
  import { ledgerCurrency, periodTotals } from "$lib/time/time-figures.ts";
  import { matterDisplay } from "$lib/matters/matter-choice.ts";
  import { listTimeEntriesInPeriod } from "$lib/time/time-operations.ts";
  import {
    PERIOD_PRESET_IDENTIFIERS,
    customRangeOutcome,
    isScopeShowing,
    scopePreset,
    spanLabel,
    type SheetScope,
  } from "$lib/time/time-sheet-scope.ts";
  import {
    VIEW_FIRM_TIME_PERMISSION,
    choiceByIdentifier,
    periodFigureReading,
    timekeeperChoices,
  } from "$lib/time/time-period.ts";

  /*
   * The firm's first weekday is a firm setting the settings registry will serve. Until it does, the
   * week presets span Monday to Sunday and each label names the days it actually covered, so the
   * caption can never disagree with the span. The Time Sheet holds the same interim, deliberately:
   * two surfaces disagreeing about where a week starts is worse than both being provisional.
   */
  const FIRST_WEEKDAY_OF_THE_FIRMS_WEEK = 1;

  const today = new Date().toISOString().slice(0, 10);

  // ---- who is asking -----------------------------------------------------------------------------

  let sessionUserId = $state<string | null>(null);
  let permissions = $state<readonly string[]>([]);
  /** Null until the session read lands: not knowing yet is a different fact from not being allowed. */
  let sessionRead = $state(false);
  const maySeeFirmTime = $derived(permissions.includes(VIEW_FIRM_TIME_PERMISSION));

  const roster = new FirmRoster();
  const firmMatters = new FirmMatters();

  const choices = $derived(
    timekeeperChoices(roster.members ?? [], sessionUserId, maySeeFirmTime),
  );

  let bootstrapped = false;
  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void roster.load(fetch);
    // The matters are read for the Matter column's names and for the record window's picker. The
    // period is READ without them — a name that has not arrived leaves one column blank, and a
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

  // ---- the scope: what is asked for --------------------------------------------------------------

  /*
   * The address is the source of both halves of the scope, so a linked view opens on what the link
   * names and a change made here is a link somebody can send back. `replaceState` rather than a
   * navigation: changing the period is not a place in the reader's history, it is the same screen
   * looking at different days, and stacking every adjustment would make Back useless.
   */
  const addressSpan = $derived.by((): SheetScope | null => {
    const from = page.url.searchParams.get("from");
    const to = page.url.searchParams.get("to");
    if (from === null || to === null) return null;
    const outcome = customRangeOutcome(from, to);
    return outcome.kind === "applied" ? outcome.scope : null;
  });

  const defaultScope = $derived(scopePreset("week", today, FIRST_WEEKDAY_OF_THE_FIRMS_WEEK));
  const scope = $derived(addressSpan ?? defaultScope);

  /*
   * Whose time, resolved against what this reader may actually ask for.
   *
   * An address naming a colleague, opened by somebody without the capability, falls back to their
   * own time rather than to a refusal: the link was not written for them, and showing them their
   * own week is a better answer than an error about a permission they cannot grant themselves.
   */
  const chosen = $derived.by(() => {
    const wanted = page.url.searchParams.get("timekeeper");
    const named = wanted === null ? undefined : choiceByIdentifier(choices, wanted);
    if (named !== undefined) return named;
    return choices.find((choice) => choice.timekeeperUserId === sessionUserId) ?? null;
  });

  function goToScope(next: SheetScope, timekeeperIdentifier: string | null): void {
    const url = new URL(page.url);
    url.searchParams.set("from", next.from);
    url.searchParams.set("to", next.to);
    if (timekeeperIdentifier === null) url.searchParams.delete("timekeeper");
    else url.searchParams.set("timekeeper", timekeeperIdentifier);
    replaceState(url, page.state);
  }

  function applyPreset(preset: SheetScope): void {
    goToScope(preset, chosen?.identifier ?? null);
  }

  let customRangeRefusal = $state<string | null>(null);
  function applyCustomRange(from: string, to: string): void {
    const outcome = customRangeOutcome(from, to);
    if (outcome.kind === "refused") {
      customRangeRefusal = outcome.reason;
      return;
    }
    customRangeRefusal = null;
    applyPreset(outcome.scope);
  }

  // ---- the read ----------------------------------------------------------------------------------

  const list = new PagedList<TimeEntrySummary>("The firm's time could not be read.");
  const entries = $derived(list.items ?? []);
  /** Bumped after a write, so the period re-reads what the server now holds rather than guessing. */
  let reloadToken = $state(0);

  const periodQuery = $derived(
    chosen === null
      ? null
      : { from: scope.from, to: scope.to, timekeeperUserId: chosen.timekeeperUserId },
  );

  $effect(() => {
    const query = periodQuery;
    // The session decides whose time is asked for, so nothing is read until it has landed. Reading
    // "everyone" in the gap and correcting it a moment later would be one refused request per load
    // for every member who cannot ask that question.
    if (query === null) return;
    const subject = `${query.from}:${query.to}:${query.timekeeperUserId ?? "everyone"}:${String(reloadToken)}`;
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

  // ---- the table ---------------------------------------------------------------------------------

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
    columns: () => firmTimeColumns(currency, matterText),
    rows: () => entries,
    rowKey: (entry) => entry.id,
    initialSort: { columnId: TIME_COLUMN_IDENTIFIERS.workDate, direction: "descending" },
    itemNoun: { singular: "entry", plural: "entries" },
    // A void stays on the record with its chip and counts toward nothing.
    totalIncludes: (entry) => entry.status !== "void",
    onActivate: (entry) => openRecord(entry, false),
  });

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

  // ---- what the screen says about its own scope ---------------------------------------------------

  const whoseTimeLine = $derived(
    chosen === null
      ? "Reading your session"
      : chosen.timekeeperUserId === null
        ? "Everyone's time"
        : chosen.timekeeperUserId === sessionUserId
          ? "Your time"
          : `${chosen.label}'s time`,
  );

  /*
   * The same fact mid-sentence, where the masthead's version cannot go.
   *
   * The masthead line opens a line of its own and is capitalised for it; dropping it into a
   * sentence needs the lower case — but only on the words the product chose, never on a person's
   * name. Lower-casing the whole line turned a colleague into "alba ferreira's time", which is a
   * screen mis-spelling somebody's name back at them.
   */
  const whoseTimePhrase = $derived(
    chosen === null
      ? "you"
      : chosen.timekeeperUserId === null
        ? "anybody at the firm"
        : chosen.timekeeperUserId === sessionUserId
          ? "you"
          : chosen.label,
  );

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

<div class="flex h-full min-h-0 flex-col gap-16 p-24">
  <ScreenHeader title="Time">
    {#snippet meta()}
      <span>{whoseTimeLine} · {spanLabel(scope.from, scope.to)}</span>
    {/snippet}
    {#snippet actions()}
      <!-- The period, then whose, then the way to add one: the two controls that change what is
           READ sit together, ahead of the control that writes. -->
      <Popover.Root>
        <Popover.Trigger
          class={buttonClasses({ variant: "secondary", size: "sm" })}
          title="Choose the days this screen shows"
        >
          <Calendar class="size-16" aria-hidden="true" />
          {scope.label}
          <ChevronDown class="size-16" aria-hidden="true" />
        </Popover.Trigger>
        <Popover.Content align="start">
          <div class="flex flex-col gap-12">
            <p class="text-xs text-text-subtle">Show time for</p>
            <div class="flex flex-col items-start gap-4">
              {#each PERIOD_PRESET_IDENTIFIERS as identifier (identifier)}
                {@const preset = scopePreset(identifier, today, FIRST_WEEKDAY_OF_THE_FIRMS_WEEK)}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={isScopeShowing(scope, preset)}
                  onclick={() => applyPreset(preset)}
                >
                  {preset.label}
                </Button>
              {/each}
            </div>
            <p class="text-xs text-text-subtle">Custom range</p>
            <DateRangePicker
              value={{ start: parseDate(scope.from), end: parseDate(scope.to) }}
              onValueChange={(range) => {
                const from = range?.start?.toString() ?? "";
                const to = range?.end?.toString() ?? "";
                if (from !== "" && to !== "") applyCustomRange(from, to);
              }}
            />
            <p class="text-xs text-text-muted">
              {customRangeRefusal ??
                "The range applies as you pick it. A preset above returns to a named span."}
            </p>
          </div>
        </Popover.Content>
      </Popover.Root>

      {#if maySeeFirmTime && chosen !== null}
        <Select.Root
          type="single"
          items={choices.map((choice) => ({ value: choice.identifier, label: choice.label }))}
          value={chosen.identifier}
          onValueChange={(next) => {
            const choice = choiceByIdentifier(choices, next);
            if (choice !== undefined) goToScope(scope, choice.identifier);
          }}
          allowDeselect={false}
        >
          <Select.Trigger aria-label="Whose time" class="w-3xs">
            <Select.Value placeholder="Whose time" />
          </Select.Trigger>
          <Select.Content>
            {#each choices as choice (choice.identifier)}
              <Select.Item value={choice.identifier} label={choice.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      {/if}

      <CreateControl
        noun="Entry"
        title="Record one entry. It saves as a draft."
        refusal={createRefusal}
        onpress={openNew}
      />

      <DataTable.ClearFilters {grid} />
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
      {#snippet empty()}
        {#if grid.isFiltered}
          <EmptyState title="Nothing Matches That">
            No entry in this period answers to what is asked. Widening the column filters brings the
            period back.
          </EmptyState>
        {:else}
          <EmptyState title="No Time In This Period">
            Nothing was recorded by {whoseTimePhrase} between {spanLabel(scope.from, scope.to)}. A
            wider span is one click away, and the Time Sheet in the top bar records a row without
            leaving whatever screen you are on.
          </EmptyState>
        {/if}
      {/snippet}
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
      <!-- The figures cover what is loaded, and the period is not fully loaded. Saying so is the
           difference between a running subtotal and a number somebody bills from. -->
      <p class="text-xs text-text-muted">
        Showing the {entries.length} most recent entries in this period. The figures cover only what
        is loaded, so they are not the period's whole total until every page is read.
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
