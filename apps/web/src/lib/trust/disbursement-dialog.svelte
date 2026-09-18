<script lang="ts">
  /*
   * Paying client money out of this matter's trust ledger.
   *
   * PROPOSING IS NOT RELEASING, AND THE PANEL DOES NOT PRETEND TO KNOW WHICH THIS IS. The firm's
   * authorization posture decides whether the person composing the payment may also let it go; the
   * server answers with the movement where they may, and with a request waiting on somebody where
   * they may not. So the heading says what pressing the commit certainly does — it requests the
   * payment — and what came of it is stated after the answer rather than guessed before it.
   *
   * THE CEILING IS SHOWN, NOT DISCOVERED. What may leave is the balance less anything under a
   * disputed-funds hold, and it stands above the amount field as a fact about the ledger. An amount
   * over it is refused here with the figure named, because a reader must never press a control that
   * cannot succeed against a client's money.
   *
   * ONE KEY PER OPENING, REUSED ON EVERY RETRY: a payment out proposed twice is two requests
   * against one client's money, and the second one is the kind nobody notices until reconciliation.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Textarea from "@magna-carta/design-system/textarea";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import type { ChoiceOption } from "$lib/components/choice-picker.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    proposeTrustDisbursement,
    type TrustAccountListing,
    type TrustBankMovementMethod,
    type TrustDisbursementProposalAck,
  } from "./trust-api.ts";
  import { TRUST_BANK_MOVEMENT_METHODS, methodLabel } from "./trust-vocabulary.ts";
  import {
    defaultEffectiveDate,
    fieldRefusal,
    readTrustDisbursementProposal,
    type TrustDisbursementEntry,
  } from "./trust-write-requests.ts";

  let {
    open = $bindable(false),
    account,
    matterId,
    matterNumber,
    availableMinor,
    money,
    onProposed,
  }: {
    open?: boolean;
    account: TrustAccountListing | null;
    matterId: string;
    matterNumber: string | null;
    /** What the ledger says may leave: the balance less anything under a hold. */
    availableMinor: number;
    money: (amountMinor: number) => string;
    /** The server's answer: a movement that posted, or a request now waiting on somebody. */
    onProposed: (acknowledgement: TrustDisbursementProposalAck) => void;
  } = $props();

  let amountText = $state("");
  let effectiveDate = $state("");
  let method = $state<TrustBankMovementMethod>("check");
  let reference = $state("");
  let payee = $state("");
  let purpose = $state("");
  let description = $state("");
  let descriptionWritten = $state(false);
  let failure = $state<StatedFailure | null>(null);
  /** Minted on the gesture that opens the panel, reused on every retry of this one submission. */
  let submissionKey = $state("");

  const methodChoices: readonly ChoiceOption[] = TRUST_BANK_MOVEMENT_METHODS.map((one) => ({
    value: one,
    label: methodLabel(one),
  }));

  const availableText = $derived(money(availableMinor));

  function reset(): void {
    amountText = "";
    effectiveDate = account === null ? "" : defaultEffectiveDate(account.timeZone);
    method = "check";
    reference = "";
    payee = "";
    purpose = "";
    description = "";
    descriptionWritten = false;
    failure = null;
    submissionKey = crypto.randomUUID();
  }

  function writePurpose(text: string): void {
    purpose = text;
    if (!descriptionWritten) description = text;
  }

  const started = $derived(amountText !== "" || payee !== "" || purpose !== "" || reference !== "");

  const entry = $derived<TrustDisbursementEntry>({
    trustAccountId: account?.id ?? "",
    matterId,
    amountText,
    effectiveDate,
    method,
    reference,
    payee,
    purpose,
    description,
    availableMinor,
    availableText,
  });
  const reading = $derived(readTrustDisbursementProposal(entry));

  const refusal = $derived.by((): string | undefined => {
    if (account === null) return "The firm has no trust account to pay out of.";
    return reading.kind === "refused" ? reading.reason : undefined;
  });

  const subtitle = $derived<RecordSubject>({
    reference: { kind: "Matter", number: matterNumber },
    facts: account === null ? [] : [account.name],
  });

  const serverProblem = $derived(failure?.failure.problem ?? null);
  const dateRefusal = $derived(fieldRefusal(serverProblem, "effectiveDate"));

  async function propose(): Promise<ActionOutcome> {
    if (reading.kind !== "request") return "refused";
    failure = null;
    const outcome = await proposeTrustDisbursement(fetch, reading.request, submissionKey);
    if (outcome.kind === "ok") {
      onProposed(outcome.value);
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "Nothing was paid out: this matter's trust ledger is unchanged.",
      "Nothing answered, so nothing was paid out. The ledger is unchanged.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Request a Payment Out"
  {subtitle}
  commitLabel="Request Payment"
  commitBusyLabel="Requesting"
  commitRefusal={refusal}
  unsavedChanges={started}
  onOpen={reset}
  onCommit={propose}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Was Paid Out"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="@container flex flex-col gap-16">
      <!-- What may leave, stated before the amount is typed rather than after it is refused. -->
      <DefinitionList.Root>
        <DefinitionList.Row term="Available">
          <span class="tabular-nums">{availableText}</span>
        </DefinitionList.Row>
      </DefinitionList.Root>

      <div class="grid gap-12 @sm:grid-cols-2">
        <LabelledField
          label="Amount"
          hint="Dollars and cents. It cannot exceed what is available."
          error={fieldRefusal(serverProblem, "amountMinor")}
        >
          {#snippet children({ props })}
            <Input {...props} inputmode="decimal" disabled={busy} bind:value={amountText} />
          {/snippet}
        </LabelledField>

        <div class="flex flex-col gap-8">
          <DatePicker
            label="Effective Date"
            value={civilDateValue(effectiveDate)}
            onValueChange={(next) => (effectiveDate = civilDateTextOrEmpty(next))}
            disabled={busy}
            aria-invalid={dateRefusal === undefined ? undefined : "true"}
          />
          {#if dateRefusal !== undefined}
            <p class="mc-form-errors">{dateRefusal}</p>
          {:else if account !== null}
            <p class="mc-form-description">The day the money leaves {account.name}.</p>
          {/if}
        </div>
      </div>

      <div class="grid gap-12 @sm:grid-cols-2">
        <LabelledField label="Method" error={fieldRefusal(serverProblem, "method")}>
          {#snippet children({ props })}
            <ChoicePicker
              inputId={props.id}
              label="Method"
              options={methodChoices}
              disabled={busy}
              bind:value={() => method, (chosen) => (method = chosen as TrustBankMovementMethod)}
            />
          {/snippet}
        </LabelledField>

        <LabelledField
          label="Reference"
          hint="The check or confirmation number, where there is one."
          error={fieldRefusal(serverProblem, "reference")}
        >
          {#snippet children({ props })}
            <Input
              {...props}
              placeholder={placeholderOf("Reference")}
              disabled={busy}
              bind:value={reference}
            />
          {/snippet}
        </LabelledField>
      </div>

      <LabelledField
        label="Payee"
        hint="Who the money is paid to."
        error={fieldRefusal(serverProblem, "payee")}
      >
        {#snippet children({ props })}
          <Input
            {...props}
            placeholder={placeholderOf("Payee")}
            disabled={busy}
            bind:value={payee}
          />
        {/snippet}
      </LabelledField>

      <LabelledField label="Purpose" error={fieldRefusal(serverProblem, "purpose")}>
        {#snippet children({ props })}
          <Input
            {...props}
            placeholder={placeholderOf("Purpose")}
            disabled={busy}
            bind:value={() => purpose, (next) => writePurpose(next)}
          />
        {/snippet}
      </LabelledField>

      <LabelledField
        label="Description"
        hint="The line the ledger entry reads. It follows the purpose until you write your own."
        error={fieldRefusal(serverProblem, "description")}
      >
        {#snippet children({ props })}
          <Textarea
            {...props}
            rows={2}
            resizable={false}
            disabled={busy}
            bind:value={
              () => description,
              (next) => {
                description = next;
                descriptionWritten = true;
              }
            }
          />
        {/snippet}
      </LabelledField>
    </div>
  {/snippet}
</ActionDialog>
