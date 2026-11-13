<script lang="ts">
  /*
   * What the firm's indexes hold, beneath the search settings: the standing of each of the three
   * indexes, then the one table of indexed places with what each holds and who reads it.
   *
   * COUNTED, NEVER REMEMBERED. It is the page's answer to "is what I turned on working", and every
   * figure is counted by the server from the firm's own records at the moment of the read
   * (search-status-api.ts). The count reads every indexed record once, so the page asks when it
   * opens and again only when somebody presses Count Again.
   *
   * ONE THING TO PRESS, and only when there is a reason. While a place reads Behind, a row beneath
   * Records offers Rebuild. Pressing it asks the server to rebuild what is behind; the work runs in
   * the background, so the row then says when it was asked for and stays until a rebuild has
   * finished. The counts are not asked for again on a press: nothing in them has changed yet.
   *
   * THE SETTINGS ANATOMY, not a dashboard: two plates in the rule rhythm of the page above them.
   * The indexes are engraved rows whose control column carries a standing and its figure; the
   * places are the product's table, so they sort and filter like every other register.
   *
   * A STANDING IS A WORD FROM THE STATUS REGISTER, chosen by search-status.ts. What it means rides
   * its hover; the only prose in a plate is its closing line, for what a figure cannot say.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import { formatInstant, formatNumber } from "@magna-carta/design-system/formatters";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import {
    statusBadgeAttributes,
    statusEntry,
    type StatusKey,
  } from "@magna-carta/design-system/status-register";
  import type { Failure } from "$lib/api/request.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsPlateNote from "$lib/settings/components/settings-plate-note.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import { readSearchStatus, requestSearchIndexRebuild } from "$lib/settings/search-status-api.ts";
  import {
    COUNTED_DEFINITION,
    FILE_CONTENTS_INDEX_DEFINITION,
    fileContentsStanding,
    REBUILD_ASKED_FOR_DEFINITION,
    REBUILD_DEFINITION,
    rebuildOffer,
    RECORD_INDEX_DEFINITION,
    recordIndexStanding,
    recordsIndexed,
    SEARCH_BY_MEANING_DEFINITION,
    SEARCH_PLACE_STANDING_COLUMN_ID,
    SEARCH_STATUS_FIXTURE,
    searchablePlaceColumns,
    searchablePlaceRows,
    searchByMeaningStanding,
    withRebuildRequested,
    type SearchablePlaceRow,
    type SearchStatus,
  } from "$lib/settings/search-status.ts";

  let status = $state<SearchStatus | null>(null);
  let readFailure = $state<Failure | null>(null);
  let counting = $state(false);
  let asking = $state(false);
  let askFailure = $state<Failure | null>(null);

  // The newest count wins: a slow answer to an earlier press never lands over a later one.
  let asked = 0;

  async function count(): Promise<void> {
    const ticket = ++asked;
    counting = true;
    const outcome = await readSearchStatus(fetch);
    if (ticket !== asked) return;
    counting = false;
    if (outcome.kind === "ok") {
      status = outcome.value;
      readFailure = null;
      return;
    }
    readFailure = outcome.failure;
  }

  $effect(() => {
    void count();
  });

  // One key to a press, so a press the network delivers twice asks once.
  async function askForRebuild(): Promise<void> {
    if (asking) return;
    asking = true;
    const outcome = await requestSearchIndexRebuild(fetch, crypto.randomUUID());
    asking = false;
    if (outcome.kind !== "ok") {
      askFailure = outcome.failure;
      return;
    }
    askFailure = null;
    if (status !== null) status = withRebuildRequested(status, outcome.value.requestedAt);
  }

  const grid = DataTable.createDataTableGrid<SearchablePlaceRow>({
    columns: searchablePlaceColumns,
    rows: () => (status === null ? [] : searchablePlaceRows(status)),
    rowKey: (row) => row.key,
    itemNoun: { singular: "place", plural: "places" },
    // As given: the records in the order the firm's other screens list them, then the files.
    initialSort: { columnId: null, direction: "ascending" },
  });

  function filesFigure(read: SearchStatus): string {
    const { filesIndexed, filesBelonging } = read.fileContents;
    return `${formatNumber(filesIndexed)} of ${formatNumber(filesBelonging)} files`;
  }
</script>

{#snippet standing(key: StatusKey, figure: string | null)}
  <div class="flex flex-col items-end gap-4">
    <Badge {...statusBadgeAttributes(key)}>{statusEntry(key).label}</Badge>
    {#if figure !== null}
      <p class="text-end text-xs text-text-muted tabular-nums">{figure}</p>
    {/if}
  </div>
{/snippet}

{#snippet indexRows(read: SearchStatus)}
  <SettingsRow definition={RECORD_INDEX_DEFINITION}>
    {#snippet control()}
      {@render standing(
        recordIndexStanding(read),
        `${formatNumber(recordsIndexed(read))} records`,
      )}
    {/snippet}
  </SettingsRow>
  {#if rebuildOffer(read) === "offered"}
    <SettingsRow definition={REBUILD_DEFINITION}>
      {#snippet control()}
        <Button
          variant="secondary"
          size="sm"
          disabled={asking}
          onclick={() => void askForRebuild()}
        >
          Rebuild
        </Button>
      {/snippet}
    </SettingsRow>
  {:else if rebuildOffer(read) === "asked-for"}
    <SettingsRow definition={REBUILD_ASKED_FOR_DEFINITION}>
      {#snippet control()}
        <!-- Stacked as the Counted row is. Ask Again stays, for a rebuild that never arrived. -->
        <div class="flex flex-col items-end gap-4">
          {#if read.records.rebuild.requestedAt !== null}
            <p class="text-sm font-medium whitespace-nowrap tabular-nums">
              {formatInstant(read.records.rebuild.requestedAt)}
            </p>
          {/if}
          <Button
            variant="secondary"
            size="sm"
            disabled={asking}
            onclick={() => void askForRebuild()}
          >
            Ask Again
          </Button>
        </div>
      {/snippet}
    </SettingsRow>
  {/if}
  <SettingsRow definition={FILE_CONTENTS_INDEX_DEFINITION}>
    {#snippet control()}
      {@render standing(fileContentsStanding(read), filesFigure(read))}
    {/snippet}
  </SettingsRow>
  {#if fileContentsStanding(read) === "index-partly-indexed"}
    <!-- Beneath the row it explains: why the figure is short, and why it may stay short. -->
    <SettingsPlateNote>
      Files the firm already had are read in the background, up to {formatNumber(read.fileContents.dailyCatchUpLimit)} a day. Files with no readable text, such as scanned pages, can't be searched by their contents.
    </SettingsPlateNote>
  {/if}
  <SettingsRow definition={SEARCH_BY_MEANING_DEFINITION}>
    {#snippet control()}
      {@render standing(searchByMeaningStanding(read), null)}
    {/snippet}
  </SettingsRow>
  <SettingsRow definition={COUNTED_DEFINITION}>
    {#snippet control()}
      <!-- Stacked: the moment and the button each keep one line inside the control column. -->
      <div class="flex flex-col items-end gap-4">
        <p class="text-sm font-medium whitespace-nowrap tabular-nums">
          {formatInstant(read.checkedAt)}
        </p>
        <Button variant="secondary" size="sm" disabled={counting} onclick={() => void count()}>
          Count Again
        </Button>
      </div>
    {/snippet}
  </SettingsRow>
{/snippet}

{#snippet placeMatched(row: SearchablePlaceRow)}
  <span class="text-xs text-text-muted">{row.matched}</span>
{/snippet}

{#snippet placeCell({ row, column, text }: DataTable.GridCellContext<SearchablePlaceRow>)}
  {#if column.id === SEARCH_PLACE_STANDING_COLUMN_ID}
    <Badge {...statusBadgeAttributes(row.standing)}>{statusEntry(row.standing).label}</Badge>
  {:else}
    {text}
  {/if}
{/snippet}

<SettingsPlate heading="What Is Indexed">
  <LoadingRegion
    loading={status === null}
    failed={readFailure !== null && status === null}
    refreshing={counting && status !== null}
    label="Counting what the firm's indexes hold"
    onRetry={() => void count()}
    class="flex flex-col divide-y divide-border-default"
  >
    {#snippet failure()}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure}
          title="The Indexes Could Not Be Counted"
          fallback="What the firm's indexes hold was not counted."
          onRetry={() => void count()}
        />
      {/if}
    {/snippet}
    {#snippet fixture()}
      {@render indexRows(SEARCH_STATUS_FIXTURE)}
    {/snippet}
    {#if status !== null}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure}
          title="The Indexes Were Not Counted Again"
          fallback="The indexes were not counted again. What is shown was counted and stands."
          onRetry={() => void count()}
        />
      {/if}
      {#if askFailure !== null}
        <FailureNotice
          failure={askFailure}
          title="The Rebuild Was Not Asked For"
          fallback="The rebuild was not asked for. Nothing was changed."
          onRetry={() => void askForRebuild()}
        />
      {/if}
      {@render indexRows(status)}
    {/if}
  </LoadingRegion>
</SettingsPlate>

{#if !(readFailure !== null && status === null)}
  <SettingsPlate heading="Indexed Places">
    {#if grid.isFiltered}
      <div class="flex items-center justify-end gap-8 py-12">
        <DataTable.ClearFilters {grid} />
      </div>
    {/if}
    <DataTable.Grid
      {grid}
      caption="The places the firm's indexes hold"
      cell={placeCell}
      rowDetail={placeMatched}
      loading={status === null}
      placeholderCount={9}
    />
    <DataTable.GridFooter {grid} />
    <SettingsPlateNote>
      Review sets are searched only from inside the set, so they aren't counted here. Names and numbers, such as file names and bill numbers, are always searchable.
    </SettingsPlateNote>
  </SettingsPlate>
{/if}
