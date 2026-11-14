<script lang="ts">
  /*
   * Taking back a payment you proposed yourself.
   *
   * THE REASON IS OPTIONAL, AND THAT IS THE DIFFERENCE FROM A REJECTION. Refusing somebody else's
   * request is a decision the firm answers for and the proposer has to be able to read why; taking
   * back your own needs no explanation, and demanding one would be the platform asking a member to
   * justify changing their mind before anything happened. Nothing reaches the ledger either way: a
   * withdrawn request is recorded as withdrawn, never deleted.
   *
   * IT IS A FORM RATHER THAN A QUESTION because there is something to fill in, even though nothing
   * has to be. The shell's own rule: a panel with fields is a Dialog and keeps its corner dismiss.
   *
   * ONE PANEL FOR BOTH SURFACES. The firm's Trust screen and a matter's own Trust section show the
   * same waiting request to the same member, so taking one back is one act with one panel: the
   * matter's ledger used to post the withdrawal on the press, with no reason offered and nothing to
   * read before it happened.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Textarea from "@magna-carta/design-system/textarea";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { withdrawTrustRequest, type TrustPendingRequest } from "./trust-api.ts";
  import { fieldRefusal } from "./trust-write-requests.ts";

  let {
    open = $bindable(false),
    request,
    money,
    submissionKey,
    onWithdrawn,
  }: {
    open?: boolean;
    /** The request being taken back. Null only in the moment before the panel is opened. */
    request: TrustPendingRequest | null;
    money: (amountMinor: number) => string;
    /** Minted on the gesture that opened this panel and reused on every retry of this answer. */
    submissionKey: string;
    onWithdrawn: () => void;
  } = $props();

  let reason = $state("");
  let failure = $state<StatedFailure | null>(null);

  function reset(): void {
    reason = "";
    failure = null;
  }

  const subtitle = $derived<RecordSubject>({
    facts: request === null ? [] : [`${money(request.amountMinor)} to ${request.payee}`],
  });

  async function withdraw(): Promise<ActionOutcome> {
    if (request === null) return "refused";
    failure = null;
    const outcome = await withdrawTrustRequest(
      fetch,
      request.id,
      reason.trim() === "" ? null : reason.trim(),
      submissionKey,
    );
    if (outcome.kind === "ok") {
      onWithdrawn();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "Nothing was withdrawn. The request is still waiting for a decision.",
      "Couldn't connect. Nothing was taken back, and the request is still waiting for a decision.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Withdraw Payment Out"
  {subtitle}
  commitLabel="Withdraw"
  commitBusyLabel="Withdrawing"
  commitRefusal={request === null ? "No request is open." : undefined}
  unsavedChanges={reason.trim() !== ""}
  onOpen={reset}
  onCommit={withdraw}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Was Taken Back"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <LabelledField
      label="Reason"
      hint="Optional. Saved with the withdrawal."
      error={fieldRefusal(failure?.failure.problem ?? null, "reason")}
    >
      {#snippet children({ props })}
        <Textarea {...props} rows={3} resizable={false} disabled={busy} bind:value={reason} />
      {/snippet}
    </LabelledField>
  {/snippet}
</ActionDialog>
