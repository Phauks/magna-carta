<script lang="ts">
  /*
   * After the paper comes out: which checks printed, and which were spoiled.
   *
   * EVERY CHECK STARTS AS PRINTED, because that is what nearly every check does, and a spoiled one
   * is the exception the reader marks. The line under the list says what the answers will do, from
   * the answers themselves, so it changes as a choice changes and cannot describe one thing and
   * send another.
   *
   * CANCEL ANSWERS NOTHING, AND LOSES NOTHING. The checks stay numbered and wait in the Printed
   * list, where Answer opens this again. So leaving with every check still Printed asks no
   * question; leaving with one marked Spoiled does, because that mark is work.
   *
   * THE KEY IS MINTED WHEN THE PANEL OPENS and reused on every retry of the same answers, so a
   * confirmation that timed out is retried rather than recorded twice.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as SegmentedControl from "@magna-carta/design-system/segmented-control";
  import Button from "@magna-carta/design-system/button";
  import FileText from "@lucide/svelte/icons/file-text";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { TrustChecksService } from "./checks-service.ts";
  import { answerConsequence, type CheckToAnswer, type PrintOutcome } from "./checks-model.ts";

  let {
    open = $bindable(false),
    trustAccountId,
    checks,
    service,
    pdf = null,
    onRecorded,
  }: {
    open?: boolean;
    trustAccountId: string;
    /** The checks being answered for, in number order. */
    checks: readonly CheckToAnswer[];
    service: TrustChecksService;
    /** The batch's PDF, where it was made here, to open again if the browser held the tab back. */
    pdf?: Blob | null;
    onRecorded: () => void;
  } = $props();

  let outcomes = $state<Record<string, PrintOutcome>>({});
  let submissionKey = "";
  let failure = $state<StatedFailure | null>(null);

  function opened(): void {
    outcomes = Object.fromEntries(checks.map((check) => [check.trustCheckId, "printed"]));
    submissionKey = crypto.randomUUID();
    failure = null;
  }

  const anySpoiled = $derived(Object.values(outcomes).some((outcome) => outcome === "spoiled"));
  const consequence = $derived(answerConsequence(checks, outcomes));

  const first = $derived(checks[0]?.checkNumber);
  const last = $derived(checks.at(-1)?.checkNumber);
  const heading = $derived(
    checks.length === 1 ? "Record How the Check Printed" : `Record How ${checks.length} Checks Printed`,
  );
  const subtitle = $derived<RecordSubject>({
    facts: [first === undefined ? "" : first === last ? `Check ${first}` : `Checks ${first} to ${last}`],
  });

  async function record(): Promise<ActionOutcome> {
    failure = null;
    const outcome = await service.recordResults(
      trustAccountId,
      checks.map((check) => ({
        trustCheckId: check.trustCheckId,
        outcome: outcomes[check.trustCheckId] ?? "printed",
      })),
      submissionKey,
    );
    if (outcome.kind === "ok") {
      onRecorded();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "Nothing was recorded. The checks are still waiting for an answer.",
      "Couldn't connect. Nothing was recorded, and trying again won't record it twice.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  width="wide"
  {heading}
  {subtitle}
  commitLabel="Record Results"
  commitBusyLabel="Recording"
  commitRefusal={checks.length === 0 ? "No check is waiting for an answer." : undefined}
  unsavedChanges={anySpoiled}
  onOpen={opened}
  onCommit={record}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Results Were Not Recorded"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <DataTable.Root>
        <DataTable.Header>
          <DataTable.Row>
            <DataTable.Head>Check No.</DataTable.Head>
            <DataTable.Head class="hidden sm:table-cell">Payee</DataTable.Head>
            <DataTable.Head class="hidden text-end sm:table-cell">Amount</DataTable.Head>
            <DataTable.Head>Result</DataTable.Head>
          </DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          {#each checks as check (check.trustCheckId)}
            <DataTable.Row>
              <!-- On a phone the payee rides under the number, so the row keeps its answer in view. -->
              <DataTable.Cell>
                <span class="flex flex-col">
                  <span class="tabular-nums">{check.checkNumber}</span>
                  <span class="text-sm text-text-muted sm:hidden">{check.payee}</span>
                </span>
              </DataTable.Cell>
              <DataTable.Cell class="hidden sm:table-cell">{check.payee}</DataTable.Cell>
              <DataTable.Cell class="hidden text-end tabular-nums sm:table-cell">{check.amountText}</DataTable.Cell>
              <DataTable.Cell>
                <SegmentedControl.Root
                  aria-label={`How check ${check.checkNumber} printed`}
                  disabled={busy}
                  class="w-full"
                  value={outcomes[check.trustCheckId] ?? "printed"}
                  onValueChange={(next) => {
                    outcomes[check.trustCheckId] = next === "spoiled" ? "spoiled" : "printed";
                  }}
                >
                  <SegmentedControl.Item value="printed">Printed</SegmentedControl.Item>
                  <SegmentedControl.Item value="spoiled">Spoiled</SegmentedControl.Item>
                </SegmentedControl.Root>
              </DataTable.Cell>
            </DataTable.Row>
          {/each}
        </DataTable.Body>
      </DataTable.Root>
      <div class="flex flex-wrap items-center justify-between gap-8">
        <p class="min-w-0 flex-1 text-sm text-text-muted" aria-live="polite">{consequence}</p>
        {#if pdf !== null}
          <Button variant="ghost" size="sm" onclick={() => pdf !== null && service.openPdf(pdf)}>
            <FileText class="size-16" aria-hidden="true" />
            Open PDF
          </Button>
        {/if}
      </div>
    </div>
  {/snippet}
</ActionDialog>
