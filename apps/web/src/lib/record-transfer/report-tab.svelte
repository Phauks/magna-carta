<script lang="ts">
  /*
   * The Report tab: what the latest pass over a file could not bring in, row by row.
   *
   * Three lists, each a table that stands whether or not it has rows: rows that were rejected, rows
   * waiting on a record that has not arrived, and single values left out of a record that did
   * arrive. Every entry carries the line of the file it came from and a plain reason. A report has
   * no value from the file in it, so a row is found by its line number.
   *
   * Columns the rules name and the file lacks stand first, because every row is affected by them. A
   * pass that failed has no report: the reason it failed stands in the report's place.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { TransferPassOutcome } from "./record-transfer-api.ts";
  import {
    findingLabel,
    formatCount,
    passFailureLabel,
    passStateLabel,
    rejectionLabel,
    type TransferPass,
  } from "./transfer-run-view.ts";

  let {
    fileName,
    latestPass,
    reading,
    outcome,
    failedOutcome,
    readFailure,
    onRetry,
  }: {
    fileName: string;
    /** The pass most recently asked for, however it stands. Null where the file has never been run. */
    latestPass: TransferPass | null;
    /** The report is being read. */
    reading: boolean;
    /** The latest finished pass's report. Null while it is read, or where no pass has finished. */
    outcome: TransferPassOutcome | null;
    /** Why the latest pass failed, where it did. */
    failedOutcome: TransferPassOutcome | null;
    readFailure: StatedFailure | null;
    onRetry: () => void;
  } = $props();

  /** How many rows of a list show before the reader asks for the rest. */
  const FIRST_ROWS = 100;

  let showAll = $state<Record<string, boolean>>({});

  function shown<Row>(list: string, rows: readonly Row[]): readonly Row[] {
    return showAll[list] === true ? rows : rows.slice(0, FIRST_ROWS);
  }

  const report = $derived(outcome?.report ?? null);
  const stateNote = $derived.by(() => {
    if (latestPass === null || latestPass.state === "finished") return null;
    if (latestPass.state === "failed") return null;
    if (latestPass.state === "stalled") {
      return "The latest pass stalled. Run it again. Nothing is brought in twice.";
    }
    return `The latest pass is ${passStateLabel(latestPass.state).toLowerCase()}.`;
  });
</script>

{#snippet more(list: string, total: number)}
  {#if total > FIRST_ROWS && showAll[list] !== true}
    <DataTable.LoadMore
      noun="rows"
      more
      onLoad={() => {
        showAll = { ...showAll, [list]: true };
      }}
    />
  {/if}
{/snippet}

<div class="flex flex-col gap-24">
  {#if latestPass?.state === "failed" && failedOutcome?.failure}
    <Alert.Root variant="danger">
      <Alert.Title>The Latest Pass Failed</Alert.Title>
      <Alert.Description>{passFailureLabel(failedOutcome.failure)}</Alert.Description>
    </Alert.Root>
  {:else if stateNote !== null}
    <Alert.Root variant={latestPass?.state === "stalled" ? "warning" : "info"}>
      <Alert.Description>{stateNote}</Alert.Description>
    </Alert.Root>
  {/if}

  {#if readFailure !== null}
    <FailureNotice
      failure={readFailure.failure}
      subject="This report"
      fallback={readFailure.fallback}
      whenSilent={readFailure.whenSilent}
      {onRetry}
    />
  {:else}
    <LoadingRegion
      loading={reading}
      label="Reading the report"
      class="flex flex-col gap-24"
    >
      {#if report !== null && report.columnsMissing.length > 0}
        <section class="flex flex-col gap-8">
          <FieldLabel as="h2">Columns Missing from the File</FieldLabel>
          <DataTable.Root>
            <DataTable.Caption class="sr-only">
              Columns the pass was asked for that {fileName} does not have
            </DataTable.Caption>
            <DataTable.Header>
              <DataTable.Row><DataTable.Head>Column</DataTable.Head></DataTable.Row>
            </DataTable.Header>
            <DataTable.Body>
              {#each report.columnsMissing as column (column)}
                <DataTable.Row data-placeholder="true">
                  <DataTable.Cell class="font-mono">{column}</DataTable.Cell>
                </DataTable.Row>
              {/each}
            </DataTable.Body>
          </DataTable.Root>
        </section>
      {/if}

      <section class="flex flex-col gap-8">
        <FieldLabel as="h2">Rejected Rows</FieldLabel>
        <DataTable.Root>
          <DataTable.Caption class="sr-only">Rows of {fileName} that were rejected</DataTable.Caption>
          <DataTable.Header>
            <DataTable.Row>
              <DataTable.Head class="w-96">Line</DataTable.Head>
              <DataTable.Head>Reason</DataTable.Head>
            </DataTable.Row>
          </DataTable.Header>
          <DataTable.Body>
            {#each shown("rejected", report?.rejected ?? []) as row (row.rowNumber)}
              <DataTable.Row data-placeholder="true">
                <DataTable.Cell class="tabular-nums">{formatCount(row.lineNumber)}</DataTable.Cell>
                <DataTable.Cell>{rejectionLabel(row.reason)}</DataTable.Cell>
              </DataTable.Row>
            {:else}
              <DataTable.EmptyRow columns={2} title="No Results" />
            {/each}
          </DataTable.Body>
        </DataTable.Root>
        {@render more("rejected", report?.rejected.length ?? 0)}
      </section>

      <section class="flex flex-col gap-8">
        <FieldLabel as="h2">Waiting Rows</FieldLabel>
        <DataTable.Root>
          <DataTable.Caption class="sr-only">
            Rows of {fileName} waiting on a record that has not arrived
          </DataTable.Caption>
          <DataTable.Header>
            <DataTable.Row>
              <DataTable.Head class="w-96">Line</DataTable.Head>
              <DataTable.Head>Waiting On</DataTable.Head>
            </DataTable.Row>
          </DataTable.Header>
          <DataTable.Body>
            {#each shown("waiting", report?.waiting ?? []) as row (row.rowNumber)}
              <DataTable.Row data-placeholder="true">
                <DataTable.Cell class="tabular-nums">{formatCount(row.lineNumber)}</DataTable.Cell>
                <DataTable.Cell class="font-mono break-words">
                  {row.missing.map((key) => `${key.sourceKind} ${key.sourceId}`).join(" · ")}
                </DataTable.Cell>
              </DataTable.Row>
            {:else}
              <DataTable.EmptyRow columns={2} title="No Results" />
            {/each}
          </DataTable.Body>
        </DataTable.Root>
        {@render more("waiting", report?.waiting.length ?? 0)}
      </section>

      <section class="flex flex-col gap-8">
        <FieldLabel as="h2">Left-Out Values</FieldLabel>
        <DataTable.Root>
          <DataTable.Caption class="sr-only">
            Values of {fileName} left out of a record that arrived
          </DataTable.Caption>
          <DataTable.Header>
            <DataTable.Row>
              <DataTable.Head class="w-96">Line</DataTable.Head>
              <DataTable.Head>Column</DataTable.Head>
              <DataTable.Head>Reason</DataTable.Head>
            </DataTable.Row>
          </DataTable.Header>
          <DataTable.Body>
            {#each shown("findings", report?.findings ?? []) as row, index (index)}
              <DataTable.Row data-placeholder="true">
                <DataTable.Cell class="tabular-nums">{formatCount(row.lineNumber)}</DataTable.Cell>
                <DataTable.Cell class="font-mono break-words">{row.column}</DataTable.Cell>
                <DataTable.Cell>{findingLabel(row.finding)}</DataTable.Cell>
              </DataTable.Row>
            {:else}
              <DataTable.EmptyRow columns={3} title="No Results" />
            {/each}
          </DataTable.Body>
        </DataTable.Root>
        {@render more("findings", report?.findings.length ?? 0)}
      </section>
    </LoadingRegion>
  {/if}
</div>
