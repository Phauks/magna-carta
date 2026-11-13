<script lang="ts">
  /*
   * The institution taking a service charge out of a trust account.
   *
   * THE CHARGE IS BORNE BY THE FIRM'S OWN CUSHION, NEVER BY CLIENT MONEY. That is the whole reason
   * the carve-out exists, and it is why a charge larger than the cushion is refused outright rather
   * than netted against what the firm holds for other people.
   *
   * THE CEILING IS THE SERVER'S TO ENFORCE, AND ITS REFUSAL NAMES THE REMEDY. The cushion moves
   * under the reader — another member's top-up, another charge a second ago — so a ceiling worked
   * out in the browser would refuse a charge the account can bear, or admit one it cannot. The
   * panel therefore sends the charge and prints the server's own `detail`, which says what to do
   * about it: FailureNotice puts the problem's words ahead of any wording of ours.
   *
   * ONE KEY PER OPENING, REUSED ON EVERY RETRY, so a submission that timed out and was pressed
   * again records one charge rather than two.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { recordTrustBankCharge, type TrustAccountListing } from "./trust-api.ts";
  import { defaultEffectiveDate, fieldRefusal } from "./trust-write-requests.ts";
  import {
    readTrustBankChargeRequest,
    type TrustBankChargeEntry,
  } from "./firm-cushion-requests.ts";

  let {
    open = $bindable(false),
    account,
    cushionBalanceText,
    onRecorded,
  }: {
    open?: boolean;
    /** The account the institution charged. The control that opens this panel is refused without one. */
    account: TrustAccountListing | null;
    /** What the cushion holds now, in the surface's own words, or null while it is not known. */
    cushionBalanceText: string | null;
    /** The charge is recorded: the section re-reads the cushion and the account's position. */
    onRecorded: () => void;
  } = $props();

  let amountText = $state("");
  let effectiveDate = $state("");
  let reference = $state("");
  let description = $state("");
  let failure = $state<StatedFailure | null>(null);
  /** Minted on the gesture that opens the panel, reused on every retry of this one submission. */
  let submissionKey = $state("");

  function reset(): void {
    amountText = "";
    effectiveDate = account === null ? "" : defaultEffectiveDate(account.timeZone);
    reference = "";
    description = "";
    failure = null;
    submissionKey = crypto.randomUUID();
  }

  const started = $derived(amountText !== "" || reference !== "" || description !== "");

  const entry = $derived<TrustBankChargeEntry>({
    trustAccountId: account?.id ?? "",
    amountText,
    effectiveDate,
    reference,
    description,
  });
  const reading = $derived(readTrustBankChargeRequest(entry));

  const refusal = $derived.by((): string | undefined => {
    if (account === null) return "Select the account the institution charged.";
    return reading.kind === "refused" ? reading.reason : undefined;
  });

  const subtitle = $derived<RecordSubject>({
    facts:
      account === null
        ? []
        : cushionBalanceText === null
          ? [account.name]
          : [account.name, `Cushion ${cushionBalanceText}`],
  });

  const serverProblem = $derived(failure?.failure.problem ?? null);
  const dateRefusal = $derived(fieldRefusal(serverProblem, "effectiveDate"));

  async function record(): Promise<ActionOutcome> {
    if (reading.kind !== "request") return "refused";
    failure = null;
    const outcome = await recordTrustBankCharge(fetch, reading.request, submissionKey);
    if (outcome.kind === "ok") {
      onRecorded();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "No charge was recorded: the cushion holds what it held, and no client ledger moved.",
      "Couldn't connect. No charge was recorded, and trying again won't charge twice.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Record Bank Charge"
  {subtitle}
  commitLabel="Record Bank Charge"
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
        title="No Charge Was Recorded"
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
          hint="Dollars and cents, as the institution took it."
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
            <p class="mc-form-description">The day the charge posted at {account.name}.</p>
          {/if}
        </div>
      </div>

      <LabelledField
        label="Reference"
        hint="The institution's own reference for the charge, where there is one."
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

      <LabelledField
        label="Description"
        hint="What the bank charged for. This becomes the ledger entry's description."
        error={fieldRefusal(serverProblem, "description")}
      >
        {#snippet children({ props })}
          <Input
            {...props}
            placeholder={placeholderOf("Description")}
            disabled={busy}
            bind:value={description}
          />
        {/snippet}
      </LabelledField>
    </div>
  {/snippet}
</ActionDialog>
