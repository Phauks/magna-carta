<script lang="ts">
  /*
   * Record Transfer: the firm's runs, newest first, and the way to start one.
   *
   * A run is one attempt at bringing the firm's records in from the system it is leaving: a
   * rehearsal, or the cutover itself. Each opens into its own workspace, where its files are
   * uploaded, mapped and run.
   */
  import { goto } from "$app/navigation";
  import { createQuery } from "@tanstack/svelte-query";
  import {
    membersListOptions,
    recordTransferListRunsOptions,
    type RecordTransferRun,
  } from "@magna-carta/api-client";
  import CreateControl from "@magna-carta/design-system/create-control";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import { failureOf } from "$lib/api/api-client.ts";
  import { SESSION_STABLE } from "$lib/api/screen-data.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import NewRunDialog from "$lib/record-transfer/new-run-dialog.svelte";
  import { runStatusLabel } from "$lib/record-transfer/transfer-run-view.ts";

  const runsRead = createQuery(() => recordTransferListRunsOptions());
  // Who started a run is stored as a member's identifier. The roster turns it into a name; where
  // the roster can't be read the column stays empty and the list still reads.
  const membersRead = createQuery(() => ({ ...membersListOptions(), staleTime: SESSION_STABLE }));

  const memberNames = $derived(
    new Map((membersRead.data?.data ?? []).map((member) => [member.userId, member.displayName])),
  );

  const rows = $derived(
    (runsRead.data?.runs ?? []).toSorted((left, right) =>
      right.startedAt.localeCompare(left.startedAt),
    ),
  );

  function runAddress(run: RecordTransferRun): string {
    return `/record-transfer/${encodeURIComponent(run.id)}`;
  }

  const grid = DataTable.createDataTableGrid<RecordTransferRun>({
    columns: () => [
      { id: "label", label: "Run", type: "text", anchored: true, value: (run) => run.label },
      {
        id: "started",
        label: "Started",
        type: "date",
        value: (run) => run.startedAt,
        text: (run) => formatInstant(run.startedAt),
      },
      {
        id: "startedBy",
        label: "Started By",
        type: "text",
        filter: "set",
        value: (run) => memberNames.get(run.startedBy) ?? "",
      },
      {
        id: "status",
        label: "Status",
        type: "text",
        filter: "set",
        value: (run) => runStatusLabel(run),
      },
    ],
    rows: () => rows,
    rowKey: (run) => run.id,
    initialSort: { columnId: "started", direction: "descending" },
    itemNoun: { singular: "run", plural: "runs" },
    onActivate: (run) => void goto(runAddress(run)),
  });

  let newRunOpen = $state(false);
</script>

<svelte:head><title>Record Transfer · Magna Carta</title></svelte:head>

{#snippet cell({ row, column, text }: DataTable.GridCellContext<RecordTransferRun>)}
  {#if column.id === "label"}
    <a href={runAddress(row)} class="truncate underline underline-offset-2" title={text}>{text}</a>
  {:else}
    {text}
  {/if}
{/snippet}

<div class="flex flex-col gap-24">
  <ScreenHeader title="Record Transfer">
    {#snippet actions()}
      <CreateControl noun="Run" onpress={() => (newRunOpen = true)} />
    {/snippet}
  </ScreenHeader>

  {#if runsRead.isError}
    <FailureNotice
      failure={failureOf(runsRead.error)}
      subject="The runs"
      fallback="The runs couldn't be read."
      onRetry={() => void runsRead.refetch()}
    />
  {:else}
    <!--
      The grid's four columns have a floor it scrolls sideways under. Where the canvas is narrower
      than that floor, each run is one stacked row in the same order, so nothing scrolls sideways.
    -->
    <div class="@container">
      <section class="hidden flex-col gap-8 @2xl:flex">
        <DataTable.Grid
          {grid}
          {cell}
          caption="The firm's record transfer runs"
          loading={runsRead.isPending}
          placeholderCount={3}
        />
        <DataTable.GridFooter {grid} />
      </section>
      <div class="@2xl:hidden">
        <DataTable.Root>
          <DataTable.Caption class="sr-only">The firm's record transfer runs</DataTable.Caption>
          <DataTable.Header>
            <DataTable.Row>
              <DataTable.Head>Run</DataTable.Head>
            </DataTable.Row>
          </DataTable.Header>
          <DataTable.Body>
            {#each rows as run (run.id)}
              <DataTable.Row>
                <DataTable.Cell>
                  <span class="flex flex-col gap-4">
                    <a href={runAddress(run)} class="break-words underline underline-offset-2">
                      {run.label}
                    </a>
                    <span class="text-text-muted">{formatInstant(run.startedAt)}</span>
                    {#if memberNames.has(run.startedBy)}
                      <span class="text-text-muted">{memberNames.get(run.startedBy)}</span>
                    {/if}
                    <span class="text-text-muted">{runStatusLabel(run)}</span>
                  </span>
                </DataTable.Cell>
              </DataTable.Row>
            {:else}
              {#if !runsRead.isPending}
                <DataTable.EmptyRow columns={1} title="No Results" />
              {/if}
            {/each}
          </DataTable.Body>
        </DataTable.Root>
      </div>
    </div>
  {/if}
</div>

<NewRunDialog bind:open={newRunOpen} onStarted={(run) => void goto(runAddress(run))} />
