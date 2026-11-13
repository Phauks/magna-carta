<script lang="ts">
  /*
   * Refusing a payment somebody proposed out of a client ledger.
   *
   * THE REASON IS REQUIRED, AND THAT IS THE DIFFERENCE FROM A WITHDRAWAL. Taking back your own
   * request needs no explanation; refusing somebody else's is a decision the firm answers for, and
   * the person who proposed it has to be able to read why. Nothing reaches the ledger either way:
   * a rejected request is recorded as refused, never deleted.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Textarea from "@magna-carta/design-system/textarea";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { rejectTrustRequest, type TrustPendingRequest } from "./trust-api.ts";
  import { fieldRefusal } from "./trust-write-requests.ts";

  let {
    open = $bindable(false),
    request,
    matterNumber,
    money,
    submissionKey,
    onRejected,
  }: {
    open?: boolean;
    request: TrustPendingRequest | null;
    matterNumber: string | null;
    money: (amountMinor: number) => string;
    /** Minted on the gesture that opened this panel and reused on every retry of this answer. */
    submissionKey: string;
    onRejected: () => void;
  } = $props();

  let reason = $state("");
  let failure = $state<StatedFailure | null>(null);

  function reset(): void {
    reason = "";
    failure = null;
  }

  const subtitle = $derived<RecordSubject>({
    reference: { kind: "Matter", number: matterNumber },
    facts: request === null ? [] : [`${money(request.amountMinor)} to ${request.payee}`],
  });

  const refusal = $derived.by((): string | undefined => {
    if (request === null) return "No request is open.";
    if (reason.trim() === "") {
      return "A reason is required. The person who proposed this will see it.";
    }
    return undefined;
  });

  async function reject(): Promise<ActionOutcome> {
    if (request === null || reason.trim() === "") return "refused";
    failure = null;
    const outcome = await rejectTrustRequest(fetch, request.id, reason.trim(), submissionKey);
    if (outcome.kind === "ok") {
      onRejected();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "Nothing was decided: the request is still waiting.",
      "Couldn't connect. Nothing was decided, and the request is still waiting.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Reject Payment Out"
  {subtitle}
  commitLabel="Reject"
  commitBusyLabel="Rejecting"
  commitRefusal={refusal}
  unsavedChanges={reason.trim() !== ""}
  onOpen={reset}
  onCommit={reject}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Was Decided"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <LabelledField
      label="Reason"
      hint="What the member who proposed this payment reads."
      error={fieldRefusal(failure?.failure.problem ?? null, "reason")}
    >
      {#snippet children({ props })}
        <Textarea {...props} rows={3} resizable={false} disabled={busy} bind:value={reason} />
      {/snippet}
    </LabelledField>
  {/snippet}
</ActionDialog>
