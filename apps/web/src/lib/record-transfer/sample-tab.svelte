<script lang="ts">
  /*
   * The Sample tab: a few of the records the latest finished pass created, each a link to the
   * record itself, so a person can open one and compare it with its line of the file.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { entityRecordHref } from "$lib/directory/entity-presentation.ts";
  import type { TransferRecordKind } from "./column-mapping.ts";
  import type { TransferPassOutcome } from "./record-transfer-api.ts";
  import { formatCount } from "./transfer-run-view.ts";

  let {
    fileName,
    recordKind,
    outcome,
    reading,
    readFailure,
    onRetry,
  }: {
    fileName: string;
    /** What the pass's rows became, which decides where a record opens. */
    recordKind: TransferRecordKind | null;
    outcome: TransferPassOutcome | null;
    /** The report is being read. */
    reading: boolean;
    readFailure: StatedFailure | null;
    onRetry: () => void;
  } = $props();

  const sample = $derived(outcome?.report?.sample ?? []);

  function recordHref(localId: string): string {
    return recordKind === "matter"
      ? `/matters/${encodeURIComponent(localId)}/overview`
      : entityRecordHref(localId);
  }

  const openLabel = $derived(
    recordKind === "matter"
      ? "Open Matter"
      : recordKind === "organization"
        ? "Open Organization"
        : "Open Person",
  );
</script>

{#if readFailure !== null}
  <FailureNotice
    failure={readFailure.failure}
    subject="This sample"
    fallback={readFailure.fallback}
    whenSilent={readFailure.whenSilent}
    {onRetry}
  />
{:else}
  <LoadingRegion loading={reading} label="Reading the sample">
    <DataTable.Root>
      <DataTable.Caption class="sr-only">Records created from {fileName}</DataTable.Caption>
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head class="w-96">Line</DataTable.Head>
          <DataTable.Head>Record</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each sample as row (row.rowNumber)}
          <DataTable.Row data-placeholder="true">
            <DataTable.Cell class="tabular-nums">{formatCount(row.lineNumber)}</DataTable.Cell>
            <DataTable.Cell>
              <a class="text-text-link underline underline-offset-2" href={recordHref(row.localId)}>
                {openLabel}
              </a>
            </DataTable.Cell>
          </DataTable.Row>
        {:else}
          <DataTable.EmptyRow columns={2} title="No Results" />
        {/each}
      </DataTable.Body>
    </DataTable.Root>
  </LoadingRegion>
{/if}
