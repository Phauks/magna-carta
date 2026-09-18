<script lang="ts">
  /*
   * Moving client money between two of one client's matters, inside one trust account.
   *
   * NOTHING LEAVES THE BANK. That is why there is no method and no reference here: the server
   * records the movement's method as internal itself, and a form that asked how the money moved
   * would be inviting somebody to say a check was written when none was.
   *
   * THE DESTINATION IS THE SAME CLIENT'S MATTER, AND THE SERVER IS THE AUTHORITY ON THAT. This
   * panel offers the firm's matters and does not pre-filter them: the roster it picks from does not
   * carry which client a matter belongs to, so filtering here would hide the right matter as often
   * as the wrong one and would be a second, quieter answer to a question the route already answers.
   * A destination on another client's matter is refused by the route, and its own words are shown
   * under the picker rather than being paraphrased.
   *
   * ONE KEY PER OPENING, REUSED ON EVERY RETRY: a transfer applied twice moves a second client's
   * balance off the matter it belongs to.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import MatterPicker from "$lib/time/matter-picker.svelte";
  import { FirmMatters } from "$lib/time/firm-matters.svelte.ts";
  import { transferTrustBetweenMatters, type TrustAccountListing } from "./trust-api.ts";
  import {
    defaultEffectiveDate,
    fieldRefusal,
    readTrustMatterTransferRequest,
    type TrustMatterTransferEntry,
  } from "./trust-write-requests.ts";

  let {
    open = $bindable(false),
    account,
    matterId,
    matterNumber,
    availableMinor,
    money,
    onTransferred,
  }: {
    open?: boolean;
    account: TrustAccountListing | null;
    /** The matter the money leaves. It is never offered as a destination. */
    matterId: string;
    matterNumber: string | null;
    availableMinor: number;
    money: (amountMinor: number) => string;
    onTransferred: () => void;
  } = $props();

  /*
   * The firm's matters, read when this panel first opens rather than when the section does: a
   * reader who never transfers never spends the walk, and the read happens at once on the first
   * opening, which is the first moment anybody needs it.
   */
  const firmMatters = new FirmMatters();

  let toMatterId = $state<string | null>(null);
  let amountText = $state("");
  let effectiveDate = $state("");
  let purpose = $state("");
  let failure = $state<StatedFailure | null>(null);
  /** Minted on the gesture that opens the panel, reused on every retry of this one submission. */
  let submissionKey = $state("");

  const availableText = $derived(money(availableMinor));

  /* This matter is not a destination for itself, so it is off the list rather than refused on it. */
  const destinations = $derived(
    (firmMatters.matters ?? []).filter((matter) => matter.id !== matterId),
  );

  function reset(): void {
    toMatterId = null;
    amountText = "";
    effectiveDate = account === null ? "" : defaultEffectiveDate(account.timeZone);
    purpose = "";
    failure = null;
    submissionKey = crypto.randomUUID();
    void firmMatters.load(fetch);
  }

  const started = $derived(amountText !== "" || purpose !== "" || toMatterId !== null);

  const entry = $derived<TrustMatterTransferEntry>({
    trustAccountId: account?.id ?? "",
    fromMatterId: matterId,
    toMatterId,
    amountText,
    effectiveDate,
    purpose,
    availableMinor,
    availableText,
  });
  const reading = $derived(readTrustMatterTransferRequest(entry));

  const refusal = $derived.by((): string | undefined => {
    if (account === null) return "The firm has no trust account to move money inside.";
    return reading.kind === "refused" ? reading.reason : undefined;
  });

  const subtitle = $derived<RecordSubject>({
    reference: { kind: "Matter", number: matterNumber },
    facts: account === null ? [] : [account.name],
  });

  const serverProblem = $derived(failure?.failure.problem ?? null);
  const dateRefusal = $derived(fieldRefusal(serverProblem, "effectiveDate"));
  /*
   * What the server said about the destination, verbatim. A transfer to another client's matter is
   * refused by the route rather than by this panel, so its words are what the reader is shown.
   */
  const destinationRefusal = $derived(
    fieldRefusal(serverProblem, "toMatterId") ??
      (serverProblem?.status === 409 ? serverProblem.detail : undefined),
  );

  async function transfer(): Promise<ActionOutcome> {
    if (reading.kind !== "request") return "refused";
    failure = null;
    const outcome = await transferTrustBetweenMatters(fetch, reading.request, submissionKey);
    if (outcome.kind === "ok") {
      onTransferred();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "Nothing moved: both matters' trust ledgers are unchanged.",
      "Nothing answered, so nothing moved. Both matters' trust ledgers are unchanged.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Transfer to Another Matter"
  {subtitle}
  commitLabel="Transfer"
  commitBusyLabel="Transferring"
  commitRefusal={refusal}
  unsavedChanges={started}
  onOpen={reset}
  onCommit={transfer}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Was Transferred"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="@container flex flex-col gap-16">
      <DefinitionList.Root>
        <DefinitionList.Row term="Available">
          <span class="tabular-nums">{availableText}</span>
        </DefinitionList.Row>
      </DefinitionList.Root>

      <LabelledField
        label="To Matter"
        hint="It must be another matter of this same client. Any other is refused."
        error={destinationRefusal}
      >
        {#snippet children({ props })}
          <MatterPicker
            matters={destinations}
            capped={firmMatters.capped}
            reading={firmMatters.matters === null}
            disabled={busy}
            inputId={props.id}
            value={toMatterId}
            noMatterLabel="No matter chosen"
            onpick={(picked) => (toMatterId = picked)}
          />
        {/snippet}
      </LabelledField>
      {#if firmMatters.failure !== null}
        <p class="mc-form-errors">{firmMatters.failure}</p>
      {/if}

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
          {:else}
            <p class="mc-form-description">The day the money moves between the two matters.</p>
          {/if}
        </div>
      </div>

      <LabelledField
        label="Purpose"
        hint="Why the money is moving. It is the line both matters' ledger entries read."
        error={fieldRefusal(serverProblem, "purpose")}
      >
        {#snippet children({ props })}
          <Input
            {...props}
            placeholder={placeholderOf("Purpose")}
            disabled={busy}
            bind:value={purpose}
          />
        {/snippet}
      </LabelledField>
    </div>
  {/snippet}
</ActionDialog>
