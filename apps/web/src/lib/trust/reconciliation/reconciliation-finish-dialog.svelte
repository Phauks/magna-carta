<script lang="ts">
  /*
   * FINISH RECONCILIATION: keeps the figures as they stand and closes the period to ticking. A
   * period may be finished with a difference; the list then says so in red, and the report prints
   * the difference with the uncleared items. Notes can still be added afterwards.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";

  let {
    open = $bindable(false),
    period,
    differenceText,
    uncleared,
    needsReview,
    refusal,
    onFinish,
  }: {
    open?: boolean;
    period: string;
    /** The difference as money, or null when it is zero. */
    differenceText: string | null;
    uncleared: number;
    needsReview: number;
    refusal: string | undefined;
    onFinish: (idempotencyKey: string) => Promise<Failure | null>;
  } = $props();

  let failure = $state<Failure | null>(null);
  let key = "";

  async function finish(): Promise<ActionOutcome> {
    failure = await onFinish(key);
    return failure === null ? "committed" : "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="confirm"
  heading="Finish Reconciliation"
  subtitle={{ facts: [period] }}
  commitLabel="Finish Reconciliation"
  commitBusyLabel="Finishing"
  commitRefusal={refusal}
  onOpen={() => {
    failure = null;
    key = crypto.randomUUID();
  }}
  onCommit={finish}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice {failure} title="The Reconciliation Was Not Finished" fallback="It is still in progress." />
    {/if}
  {/snippet}
  {#snippet fields()}
    <div class="flex flex-col gap-8 text-sm">
      {#if differenceText === null}
        <p>The cleared balance matches the end balance.</p>
      {:else}
        <p class="text-status-danger">It will be finished with a difference of {differenceText}.</p>
      {/if}
      <p>
        {uncleared === 1 ? "1 item stays" : `${uncleared} items stay`} uncleared and carry to the next
        reconciliation.
      </p>
      {#if needsReview > 0}
        <p>{needsReview === 1 ? "1 line is" : `${needsReview} lines are`} still marked Needs Review.</p>
      {/if}
      <p>Ticks, the end date and the end balance can't be changed afterwards. Notes can.</p>
    </div>
  {/snippet}
</ActionDialog>
