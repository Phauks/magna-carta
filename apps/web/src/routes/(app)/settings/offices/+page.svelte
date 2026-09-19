<script lang="ts">
  /*
   * Settings · Offices — the firm's places of business, under Firm.
   *
   * A REGISTER, not a settings form: the product's one table over the firm's offices in the
   * settings anatomy (masthead, the shared scroll region, one plate), with the search and the
   * create control above it and the counts strip beneath, exactly as the Users register. A row opens the office's record window, which is where an office is entered,
   * corrected, staffed, given its letterhead mark and closed — each act committed at once against
   * its own route, so the posture is "applies immediately" and nothing is staged.
   *
   * THE RECORD IS ADDRESSABLE. `?office=<id>` opens that office's window on arrival, which is what
   * lets every place an office is named — a matter's owning office, a resource, a member — link
   * here and land on the record rather than on the list. Opening a row writes the address without
   * a navigation, on the fees page's precedent: it is the same screen looking at one of its rows.
   *
   * Edit is gated on the session's real `locations:manage`. A member without it reads the register
   * as a plain table and opens each office read-only.
   */
  import CreateControl from "@magna-carta/design-system/create-control";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import Badge from "@magna-carta/design-system/badge";
  import { replaceState } from "$app/navigation";
  import { page } from "$app/state";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import type { Failure } from "$lib/api/request.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import OfficeRecordWindow from "$lib/offices/office-record-window.svelte";
  import { firmOffices } from "$lib/offices/firm-offices.svelte.ts";
  import {
    FIRM_DEFAULT_MARK,
    OFFICE_REGISTER_INITIAL_SORT,
    officeColumns,
    officeMatchesSearch,
  } from "$lib/offices/office-columns.ts";
  import { officeStatusKey } from "$lib/offices/office-vocabulary.ts";
  import {
    listOffices,
    MANAGE_OFFICES_PERMISSION,
    type OfficeSummary,
  } from "$lib/offices/offices-api.ts";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";

  const canManage = $derived(sessionPermissions.holds(MANAGE_OFFICES_PERMISSION));

  let offices = $state<readonly OfficeSummary[] | null>(null);
  let readFailure = $state<Failure | null>(null);

  async function load(): Promise<void> {
    readFailure = null;
    const outcome = await listOffices(fetch);
    if (outcome.kind !== "ok") {
      readFailure = outcome.failure;
      return;
    }
    offices = outcome.value.data;
  }

  $effect(() => {
    void load();
    void sessionPermissions.load(fetch);
  });

  /** The register changed under a window: read it again, and let every other reader know. */
  function reread(): void {
    void load();
    void firmOffices.reload(fetch);
  }

  // ---- the search and the grid ------------------------------------------------------------------

  let searchText = $state("");
  let appliedSearch = $state("");
  const narrowed = $derived(appliedSearch.trim() !== "");
  const shown = $derived((offices ?? []).filter((office) => officeMatchesSearch(office, appliedSearch)));

  function clearNarrowing(): void {
    searchText = "";
    appliedSearch = "";
  }

  const grid = DataTable.createDataTableGrid<OfficeSummary>({
    columns: () => officeColumns(),
    rows: () => shown,
    rowKey: (office) => office.id,
    initialSort: OFFICE_REGISTER_INITIAL_SORT,
    itemNoun: { singular: "office", plural: "offices" },
    onActivate: (office) => openOffice(office.id),
  });

  // ---- the record window ------------------------------------------------------------------------

  let windowOpen = $state(false);
  let windowOfficeId = $state<string | null>(null);

  function writeAddress(officeId: string | null): void {
    const url = new URL(page.url);
    if (officeId === null) url.searchParams.delete("office");
    else url.searchParams.set("office", officeId);
    // Not a navigation: opening a row is the same screen looking at one of its rows.
    replaceState(url, page.state);
  }

  function openOffice(officeId: string): void {
    windowOfficeId = officeId;
    windowOpen = true;
    writeAddress(officeId);
  }

  function openNew(): void {
    windowOfficeId = null;
    windowOpen = true;
  }

  // The address names the office to open, on arrival and on a pasted link. Read once per address
  // rather than on every render, so closing the window (which clears the address) does not reopen it.
  let addressedOffice = $state<string | null>(null);
  $effect(() => {
    const named = page.url.searchParams.get("office");
    if (named === addressedOffice) return;
    addressedOffice = named;
    if (named !== null) {
      windowOfficeId = named;
      windowOpen = true;
    }
  });

  $effect(() => {
    if (!windowOpen && windowOfficeId !== null) writeAddress(null);
  });

  const createRefusal = $derived.by((): string | undefined => {
    if (!sessionPermissions.settled) return "Reading your permissions.";
    if (!canManage) return "Your account cannot open an office for the firm.";
    return undefined;
  });
</script>

<svelte:head>
  <title>Offices · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="offices"
  title="Offices"
  posture={canManage ? "instant" : "readOnly"}
  showHistory={false}
/>

<SettingsScrollRegion>
  <SettingsDescription>
    Where the firm practises: each office with its addresses, its telephone and email, its time
    zone, the code its matter numbers carry, who staffs it, and the mark its letterhead prints.
  </SettingsDescription>

  <SettingsPlate heading="The Register">
    <!-- The one compact action row: the way out of a narrowing, the search, then the create
         control. The search grows toward the inline start, so the control at the row's end never
         moves when it opens. -->
    <div class="flex items-center justify-end gap-8 py-12">
      <DataTable.ClearFilters
        {grid}
        narrowing={{ narrowed, summary: `search "${appliedSearch.trim()}"`, clear: clearNarrowing }}
      />
      <ScreenSearch
        bind:value={searchText}
        label="Search offices"
        searchOn="keystroke"
        fieldClass="w-2xs sm:w-xs"
        onsearch={(next) => {
          appliedSearch = next;
        }}
      />
      <CreateControl
        noun="Office"
        title="Open an office for the firm."
        refusal={createRefusal}
        onpress={openNew}
      />
    </div>

    {#if readFailure !== null && offices === null}
      <FailureNotice
        failure={readFailure}
        title="The Offices Could Not Be Read"
        fallback="The firm's offices were not read."
        onRetry={() => void load()}
      />
    {:else}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure}
          title="The Offices Were Not Re-read"
          fallback="The register was not read again. What is shown was read and stands."
          onRetry={() => void load()}
        />
      {/if}
      <DataTable.Grid
        {grid}
        caption="The firm's offices"
        cell={officeCell}
        loading={offices === null}
        placeholderCount={3}
      >
      </DataTable.Grid>

      <DataTable.GridFooter {grid} />
    {/if}
  </SettingsPlate>
</SettingsScrollRegion>

{#snippet officeCell({ row, column, text }: DataTable.GridCellContext<OfficeSummary>)}
  {#if column.id === "status"}
    <Badge {...statusBadgeAttributes(officeStatusKey(row.status))}>
      {statusEntry(officeStatusKey(row.status)).label}
    </Badge>
  {:else if column.id === "name"}
    <span class="flex items-baseline gap-8">
      <span>{text}</span>
      {#if row.firmDefault}
        <span class="text-xs text-text-muted">{FIRM_DEFAULT_MARK}</span>
      {/if}
    </span>
  {:else if column.id === "members"}
    <span class="tabular-nums">{text}</span>
  {:else}
    {text}
  {/if}
{/snippet}

<OfficeRecordWindow
  bind:open={windowOpen}
  officeId={windowOfficeId}
  {canManage}
  onChanged={reread}
/>
