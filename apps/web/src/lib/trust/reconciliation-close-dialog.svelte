<script lang="ts">
  /*
   * Closing a reconciliation, which is the firm attesting to a period.
   *
   * A PERIOD THAT DID NOT BALANCE CLOSES EXACTLY AS READILY AS ONE THAT DID. A firm that cannot
   * record an unreconciled month has to choose between a false attestation and no record at all,
   * which is the one choice a trust surface must never put in front of anybody. So the panel states
   * the verdict and the counts and lets the act happen either way.
   *
   * WHAT CLOSING DOES IS STATED BEFORE IT IS DONE. It freezes the proof as it stands now and writes
   * nothing else: no entry moves, no match is made, and a correction afterwards is a new
   * reconciliation that supersedes this one.
   *
   * THE IDEMPOTENCY KEY IS MINTED ON THE GESTURE THAT OPENS THE PANEL and reused on every retry.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { closeTrustReconciliation } from "./trust-api.ts";
  import type { TrustThreeWayProof } from "./trust-api.ts";
  import { countedPhrase, verdictLabel } from "./reconciliation-model.ts";

  let {
    open = $bindable(false),
    reconciliationId,
    proof,
    periodText,
    unmatchedLineCount,
    unmatchedItemCount,
    sentence,
    commitRefusal,
    submissionKey,
    onClosed,
  }: {
    open?: boolean;
    reconciliationId: string;
    /** The proof as it stands now, which is what closing freezes. */
    proof: TrustThreeWayProof | null;
    /** The period this reconciliation is of, as one reading. */
    periodText: string;
    unmatchedLineCount: number;
    unmatchedItemCount: number;
    /** What closing records, in the screen's own words. */
    sentence: string;
    /** Why closing cannot happen, where it cannot. */
    commitRefusal: string | undefined;
    /** Minted on the gesture that opened this panel, reused on every retry of it. */
    submissionKey: string;
    onClosed: () => void;
  } = $props();

  let failure = $state<StatedFailure | null>(null);

  async function close(): Promise<ActionOutcome> {
    failure = null;
    const outcome = await closeTrustReconciliation(fetch, reconciliationId, submissionKey);
    if (outcome.kind === "ok") {
      onClosed();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The reconciliation is still open.",
      "Nothing answered, so the reconciliation is still open. Retrying sends this same submission rather than closing it twice.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="confirm"
  heading="Close Reconciliation"
  subtitle={{ facts: [periodText] }}
  commitLabel="Close Reconciliation"
  commitBusyLabel="Closing"
  {commitRefusal}
  onOpen={() => (failure = null)}
  onCommit={close}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Reconciliation Is Still Open"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields()}
    <DefinitionList.Root>
      <DefinitionList.Row term="Verdict" empty={proof === null}>
        {proof === null ? "" : verdictLabel(proof.balanced)}
      </DefinitionList.Row>
      <DefinitionList.Row term="Unmatched Lines">
        {countedPhrase(unmatchedLineCount, "statement line", "statement lines")}
      </DefinitionList.Row>
      <DefinitionList.Row term="Unmatched Items">
        {countedPhrase(unmatchedItemCount, "recorded item", "recorded items")}
      </DefinitionList.Row>
      <DefinitionList.Row term="What Closing Records">{sentence}</DefinitionList.Row>
    </DefinitionList.Root>
  {/snippet}
</ActionDialog>
