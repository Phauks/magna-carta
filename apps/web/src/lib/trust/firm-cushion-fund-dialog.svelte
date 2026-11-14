<script lang="ts">
  /*
   * The firm's own money going into the bank-charge cushion.
   *
   * IT IS THE ONLY PERMITTED DEPOSIT OF FIRM MONEY INTO A CLIENT TRUST ACCOUNT, and it records
   * something that already happened: the money reached the institution on a day, by a means, under
   * a reference. That is why the day defaults to today WHERE THE ACCOUNT IS HELD rather than where
   * the reader is sitting — a member three zones away must not record the bank's day as the next
   * one.
   *
   * ONE KEY PER OPENING, REUSED ON EVERY RETRY. It is minted when the panel opens rather than when
   * the commit is pressed, so a refusal the reader answers and presses through again is the same
   * submission rather than a second top-up.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import type { ChoiceOption } from "$lib/components/choice-picker.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    depositTrustFirmFunds,
    type TrustAccountListing,
    type TrustFirmFundsDepositMethod,
  } from "./trust-api.ts";
  import { methodLabel } from "./trust-vocabulary.ts";
  import { defaultEffectiveDate, fieldRefusal } from "./trust-write-requests.ts";
  import {
    TRUST_FIRM_FUNDS_DEPOSIT_METHODS,
    readTrustCushionDepositRequest,
    type TrustCushionDepositEntry,
  } from "./firm-cushion-requests.ts";

  let {
    open = $bindable(false),
    account,
    cushionBalanceText,
    onFunded,
  }: {
    open?: boolean;
    /** The account the cushion sits in. The control that opens this panel is refused without one. */
    account: TrustAccountListing | null;
    /** What the cushion holds now, in the surface's own words, or null while it is not known. */
    cushionBalanceText: string | null;
    /** The money landed: the section re-reads the cushion and the account's position. */
    onFunded: () => void;
  } = $props();

  let amountText = $state("");
  let effectiveDate = $state("");
  let method = $state<TrustFirmFundsDepositMethod>("check");
  let reference = $state("");
  let description = $state("");
  let failure = $state<StatedFailure | null>(null);
  /** Minted on the gesture that opens the panel, reused on every retry of this one submission. */
  let submissionKey = $state("");

  const methodChoices: readonly ChoiceOption[] = TRUST_FIRM_FUNDS_DEPOSIT_METHODS.map((one) => ({
    value: one,
    label: methodLabel(one),
  }));

  function reset(): void {
    amountText = "";
    effectiveDate = account === null ? "" : defaultEffectiveDate(account.timeZone);
    method = "check";
    reference = "";
    description = "";
    failure = null;
    submissionKey = crypto.randomUUID();
  }

  const started = $derived(amountText !== "" || reference !== "" || description !== "");

  const entry = $derived<TrustCushionDepositEntry>({
    trustAccountId: account?.id ?? "",
    amountText,
    effectiveDate,
    method,
    reference,
    description,
  });
  const reading = $derived(readTrustCushionDepositRequest(entry));

  const refusal = $derived.by((): string | undefined => {
    if (account === null) return "Select the account the cushion sits in.";
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

  async function fund(): Promise<ActionOutcome> {
    if (reading.kind !== "request") return "refused";
    failure = null;
    const outcome = await depositTrustFirmFunds(fetch, reading.request, submissionKey);
    if (outcome.kind === "ok") {
      onFunded();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "Nothing went in: the cushion holds what it held.",
      "Couldn't connect. Nothing was deposited, and trying again won't deposit twice.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Fund Cushion"
  {subtitle}
  commitLabel="Fund Cushion"
  commitBusyLabel="Funding"
  commitRefusal={refusal}
  unsavedChanges={started}
  onOpen={reset}
  onCommit={fund}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Went In"
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
          hint="Dollars and cents, as the money was paid in."
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
              bind:value={
                () => method, (chosen) => (method = chosen as TrustFirmFundsDepositMethod)
              }
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
        label="Description"
        hint="Why the firm is adding its own money. This becomes the ledger entry's description."
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
