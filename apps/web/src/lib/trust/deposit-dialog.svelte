<script lang="ts">
  /*
   * Client money arriving into this matter's trust ledger.
   *
   * THE FIRST DEPOSIT CREATES THE LEDGER. A matter holds no trust leaf in an account until money
   * reaches it, which is why this is the one act a matter with nothing in trust can still perform,
   * and why it is the section's create control rather than one verb among several.
   *
   * IT RECORDS SOMETHING THAT ALREADY HAPPENED. The money reached the firm's account on a day, by a
   * means, from somebody, for a reason: every field here is a fact about that event and none of
   * them is a decision this panel is making. That is why the effective date defaults to today WHERE
   * THE ACCOUNT IS HELD rather than where the reader is sitting — the day a deposit lands is the
   * bank's day, and a reader three zones away must not record it as the next one.
   *
   * ONE KEY PER OPENING, REUSED ON EVERY RETRY. It is minted when the panel opens rather than when
   * the commit is pressed, so a refusal the reader answers and presses through again is the same
   * submission: a deposit posted twice is a second real movement of a client's money.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
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
    recordTrustDeposit,
    type TrustAccountListing,
    type TrustBankMovementMethod,
  } from "./trust-api.ts";
  import { TRUST_BANK_MOVEMENT_METHODS, methodLabel } from "./trust-vocabulary.ts";
  import {
    defaultEffectiveDate,
    fieldRefusal,
    readTrustDepositRequest,
    type TrustDepositEntry,
  } from "./trust-write-requests.ts";

  let {
    open = $bindable(false),
    account,
    matterId,
    matterNumber,
    onRecorded,
  }: {
    open?: boolean;
    /** The account the money reached. The control that opens this panel is refused without one. */
    account: TrustAccountListing | null;
    matterId: string;
    matterNumber: string | null;
    /** The deposit landed: the section re-reads the ledger the movement is now on. */
    onRecorded: () => void;
  } = $props();

  let amountText = $state("");
  let effectiveDate = $state("");
  let method = $state<TrustBankMovementMethod>("check");
  let reference = $state("");
  let source = $state("");
  let purpose = $state("");
  let description = $state("");
  /*
   * Whether the ledger line has been written by hand. Until it has, it follows the purpose: the two
   * are the same sentence on most deposits, and a form that can work an answer out OFFERS it and
   * never overwrites what somebody typed.
   */
  let descriptionWritten = $state(false);
  let failure = $state<StatedFailure | null>(null);
  /** Minted on the gesture that opens the panel, reused on every retry of this one submission. */
  let submissionKey = $state("");

  const methodChoices: readonly ChoiceOption[] = TRUST_BANK_MOVEMENT_METHODS.map((one) => ({
    value: one,
    label: methodLabel(one),
  }));

  function reset(): void {
    amountText = "";
    effectiveDate = account === null ? "" : defaultEffectiveDate(account.timeZone);
    method = "check";
    reference = "";
    source = "";
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

  const started = $derived(amountText !== "" || source !== "" || purpose !== "" || reference !== "");

  const entry = $derived<TrustDepositEntry>({
    trustAccountId: account?.id ?? "",
    matterId,
    amountText,
    effectiveDate,
    method,
    reference,
    source,
    purpose,
    description,
  });
  const reading = $derived(readTrustDepositRequest(entry));

  const refusal = $derived.by((): string | undefined => {
    if (account === null) return "The firm has no trust account to pay this into.";
    return reading.kind === "refused" ? reading.reason : undefined;
  });

  /* The matter the money is held for, by the number somebody reads back down a telephone. */
  const subtitle = $derived<RecordSubject>({
    reference: { kind: "Matter", number: matterNumber },
    facts: account === null ? [] : [account.name],
  });

  const serverProblem = $derived(failure?.failure.problem ?? null);
  const dateRefusal = $derived(fieldRefusal(serverProblem, "effectiveDate"));

  async function record(): Promise<ActionOutcome> {
    if (reading.kind !== "request") return "refused";
    failure = null;
    const outcome = await recordTrustDeposit(fetch, reading.request, submissionKey);
    if (outcome.kind === "ok") {
      onRecorded();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "Nothing was paid in: this matter's trust ledger is unchanged.",
      "Nothing answered, so nothing was paid in. The ledger is unchanged.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="New Deposit"
  {subtitle}
  commitLabel="Record Deposit"
  commitBusyLabel="Recording"
  commitRefusal={refusal}
  unsavedChanges={started}
  onOpen={reset}
  onCommit={record}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Was Paid In"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="@container flex flex-col gap-16">
      <div class="grid gap-12 @sm:grid-cols-2">
        <LabelledField
          label="Amount"
          hint="Dollars and cents, as the money was received."
          error={fieldRefusal(serverProblem, "amountMinor")}
        >
          {#snippet children({ props })}
            <Input {...props} inputmode="decimal" disabled={busy} bind:value={amountText} />
          {/snippet}
        </LabelledField>

        <!-- The picker renders its own label, so it stands outside LabelledField rather than
             carrying a second one. -->
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
            <p class="mc-form-description">The day the money reached {account.name}.</p>
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
        label="Received From"
        hint="Who paid it in: the client, an insurer, an opposing party."
        error={fieldRefusal(serverProblem, "source")}
      >
        {#snippet children({ props })}
          <Input
            {...props}
            placeholder={placeholderOf("Received From")}
            disabled={busy}
            bind:value={source}
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
