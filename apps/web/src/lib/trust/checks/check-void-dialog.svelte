<script lang="ts">
  /*
   * Voiding a check number: a check already printed (lost, stale, stopped), or the next number on
   * the account for a sheet wasted outside the product, so the numbers keep matching the paper.
   *
   * VOIDING MOVES NO MONEY, AND THE PANEL SAYS SO WHERE THE FEAR IS. The money left the client's
   * ledger when the payment was approved; voiding the check records what happened to the paper and
   * returns the payment to To Print for a replacement. A reader who wants the payment itself undone
   * is told that is a deposit back to the ledger, not this.
   *
   * THE REASON IS REQUIRED, because a voided number with no reason is the first thing an examiner
   * asks about. An empty reason refuses the commit; the field says nothing, the refusal does.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Textarea from "@magna-carta/design-system/textarea";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { TrustChecksService } from "./checks-service.ts";

  let {
    open = $bindable(false),
    trustAccountId,
    subject,
    service,
    onVoided,
  }: {
    open?: boolean;
    trustAccountId: string;
    /**
     * What is being voided: one printed check, or the account's next number. Null while closed.
     */
    subject:
      | {
          readonly kind: "check";
          readonly trustCheckId: string;
          readonly checkNumber: number;
          readonly payee: string;
          readonly amountText: string;
        }
      | { readonly kind: "next"; readonly checkNumber: number }
      | null;
    service: TrustChecksService;
    onVoided: () => void;
  } = $props();

  let reason = $state("");
  let submissionKey = "";
  let failure = $state<StatedFailure | null>(null);

  function opened(): void {
    reason = "";
    submissionKey = crypto.randomUUID();
    failure = null;
  }

  const heading = $derived(
    subject === null ? "Void Check" : `Void Check ${subject.checkNumber}`,
  );
  const dialogSubtitle = $derived<RecordSubject>({
    facts:
      subject === null
        ? []
        : subject.kind === "check"
          ? [subject.payee, subject.amountText]
          : ["The next number, unprinted"],
  });

  const refusal = $derived(
    subject === null ? "No check is chosen." : reason.trim() === "" ? "Give a reason." : undefined,
  );

  async function commit(): Promise<ActionOutcome> {
    if (subject === null) return "refused";
    failure = null;
    const outcome =
      subject.kind === "check"
        ? await service.voidCheck(trustAccountId, subject.trustCheckId, reason.trim(), submissionKey)
        : await service.voidNextNumber(trustAccountId, reason.trim(), submissionKey);
    if (outcome.kind === "ok") {
      onVoided();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The number was not voided.",
      "Couldn't connect. The number was not voided, and trying again won't void it twice.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="destructive"
  {heading}
  subtitle={dialogSubtitle}
  commitLabel="Void Check"
  commitBusyLabel="Voiding"
  commitRefusal={refusal}
  unsavedChanges={reason.trim() !== ""}
  onOpen={opened}
  onCommit={commit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Number Was Not Voided"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <LabelledField label="Reason">
        {#snippet children({ props })}
          <Textarea {...props} rows={3} resizable={false} disabled={busy} bind:value={reason} />
        {/snippet}
      </LabelledField>
      <DefinitionList.Root>
        <DefinitionList.Row term="What Changes">
          {subject?.kind === "next"
            ? "The number is kept on the Voided list, and the next check prints on the number after it."
            : "The number is kept on the Voided list, and the payment goes back to To Print for a new check."}
        </DefinitionList.Row>
        <DefinitionList.Row term="Money">
          Voiding does not move money. To undo the payment itself, record a deposit back to the
          client's ledger.
        </DefinitionList.Row>
      </DefinitionList.Root>
    </div>
  {/snippet}
</ActionDialog>
