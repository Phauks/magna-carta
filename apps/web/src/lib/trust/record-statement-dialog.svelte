<script lang="ts">
  /*
   * Recording one period of a trust bank account as the institution reported it.
   *
   * THE PANEL DOES NOT ARGUE WITH THE BANK. The lines are added up as they are typed and the
   * closing balance they imply is STATED beside the one the reader entered; where the two differ
   * the panel says so and records the statement anyway. A difference between what the bank's own
   * total says and what its lines add up to is the first thing a reconciliation of this period
   * exists to find, and a panel that refused the entry would leave the firm unable to record the
   * statement it has to reconcile.
   *
   * THE TOTALS STAND BESIDE THE FIELDS, NOT UNDER THEM. What the entry comes to is the gate the
   * entry has to pass, and a gate at the bottom of a scrolling column is a gate somebody has to
   * remember to go and look at. So the fields take the primary pane and the reading takes the
   * context pane, permanently in view.
   *
   * THE PERIOD DEFAULTS TO LAST MONTH IN THE ACCOUNT'S OWN ZONE, not the reader's. A statement
   * recorded from a branch office an hour before midnight somewhere else would otherwise open on a
   * month the bank has not finished.
   *
   * THE IDEMPOTENCY KEY IS MINTED WHEN THE PANEL OPENS, not when the commit is pressed. A retry
   * after a timeout has to be the SAME submission: a firm can legitimately hold two statements for
   * one period (a bank reissues one), so nothing downstream could tell a duplicate from a
   * deliberate pair. Minting on the opening gesture is what makes a retry a retry.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import Button from "@magna-carta/design-system/button";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import { fieldRefusal } from "./trust-write-requests.ts";
  import { recordTrustBankStatement } from "./trust-api.ts";
  import { trustMoneyText } from "./firm-trust-vocabulary.ts";
  import {
    STATEMENT_DIRECTION_CHOICES,
    closingDifferenceSentence,
    previousCalendarMonth,
    readTrustBankStatementEntry,
    statementTotals,
    type TrustStatementLineDraft,
  } from "./statement-entry.ts";

  let {
    open = $bindable(false),
    trustAccountId,
    accountName,
    currency,
    timeZone,
    onRecorded,
  }: {
    open?: boolean;
    trustAccountId: string;
    /** What the account is called, so the panel names the record it is writing against. */
    accountName: string;
    /** The account's currency, so every figure on the panel reads in the account's own money. */
    currency: string;
    /** The holding office's zone: the day the account's month ends in. */
    timeZone: string;
    /** The statement was recorded. The surface re-reads its statements and selects this one. */
    onRecorded: (statementId: string) => void;
  } = $props();

  let periodStart = $state("");
  let periodEnd = $state("");
  let openingBalanceText = $state("");
  let closingBalanceText = $state("");
  let statementReference = $state("");
  let lines = $state<TrustStatementLineDraft[]>([]);
  let failure = $state<StatedFailure | null>(null);

  /** The submission this panel is making, reused on every retry of it. */
  let submissionKey = "";

  const money = (amountMinor: number): string => trustMoneyText(amountMinor, currency);

  /* WHICH ACCOUNT THIS PERIOD IS BEING RECORDED AGAINST. A statement is a fact about one bank
     account, and a panel that names none could be writing against any of the firm's. */
  const subtitle = $derived<RecordSubject>({ facts: [accountName] });

  /** A blank line, posted on the day the period starts so the field opens inside the period. */
  function blankLine(postedOn: string): TrustStatementLineDraft {
    return {
      key: crypto.randomUUID(),
      postedOn,
      direction: "deposit",
      amountText: "",
      description: "",
      reference: "",
      counterpartyName: "",
    };
  }

  function reset(): void {
    const period = previousCalendarMonth(timeZone);
    periodStart = period.periodStart;
    periodEnd = period.periodEnd;
    openingBalanceText = "";
    closingBalanceText = "";
    statementReference = "";
    // The list opens with the row it will be filled in through, so the shape a reader is about to
    // work in is on screen rather than arriving after they have found a control.
    lines = [blankLine(period.periodStart)];
    failure = null;
    submissionKey = crypto.randomUUID();
  }

  function changeLine(key: string, change: Partial<TrustStatementLineDraft>): void {
    lines = lines.map((line) => (line.key === key ? { ...line, ...change } : line));
  }

  function addLine(): void {
    lines = [...lines, blankLine(lines[lines.length - 1]?.postedOn ?? periodStart)];
  }

  function removeLine(key: string): void {
    lines = lines.filter((line) => line.key !== key);
  }

  const draft = $derived({
    trustAccountId,
    periodStart,
    periodEnd,
    openingBalanceText,
    closingBalanceText,
    statementReference,
    lines,
  });

  const totals = $derived(statementTotals(openingBalanceText, lines));
  const difference = $derived(closingDifferenceSentence(totals, closingBalanceText, money));
  const reading = $derived(readTrustBankStatementEntry(draft));
  const commitRefusal = $derived(reading.kind === "refused" ? reading.reason : undefined);

  /** Whether anything has been typed past what opening the panel filled in. */
  const started = $derived(
    openingBalanceText.trim() !== "" ||
      closingBalanceText.trim() !== "" ||
      statementReference.trim() !== "" ||
      lines.some((line) => line.amountText.trim() !== "" || line.description.trim() !== ""),
  );

  /** The server's own words about one field it refused, shown under that field rather than above. */
  const problem = $derived(failure?.failure.problem ?? null);

  async function record(): Promise<ActionOutcome> {
    if (reading.kind !== "request") return "refused";
    failure = null;
    const outcome = await recordTrustBankStatement(fetch, reading.request, submissionKey);
    if (outcome.kind === "ok") {
      onRecorded(outcome.value.trustBankStatementId);
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "No statement was recorded.",
      "Couldn't connect. No statement was recorded, and trying again won't record it twice.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Record Statement"
  {subtitle}
  commitLabel="Record Statement"
  commitBusyLabel="Recording"
  {commitRefusal}
  unsavedChanges={started}
  onOpen={reset}
  onCommit={record}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="No Statement Was Recorded"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <div class="grid gap-12 sm:grid-cols-2">
        <DatePicker
          label="Period Start"
          value={civilDateValue(periodStart)}
          onValueChange={(next) => (periodStart = civilDateTextOrEmpty(next))}
          disabled={busy}
          aria-invalid={fieldRefusal(problem, "periodStart") === undefined ? undefined : "true"}
        />
        <DatePicker
          label="Period End"
          value={civilDateValue(periodEnd)}
          onValueChange={(next) => (periodEnd = civilDateTextOrEmpty(next))}
          disabled={busy}
          aria-invalid={fieldRefusal(problem, "periodEnd") === undefined ? undefined : "true"}
        />
      </div>

      <div class="grid gap-12 sm:grid-cols-2">
        <LabelledField
          label="Opening Balance"
          hint="What the bank said the account held when the period opened."
          error={fieldRefusal(problem, "openingBalanceMinor")}
        >
          {#snippet children({ props })}
            <Input
              {...props}
              placeholder={placeholderOf("Opening Balance")}
              inputmode="decimal"
              disabled={busy}
              bind:value={openingBalanceText}
            />
          {/snippet}
        </LabelledField>

        <LabelledField
          label="Closing Balance"
          hint="What the bank said the account held when the period closed."
          error={fieldRefusal(problem, "closingBalanceMinor")}
        >
          {#snippet children({ props })}
            <Input
              {...props}
              placeholder={placeholderOf("Closing Balance")}
              inputmode="decimal"
              disabled={busy}
              bind:value={closingBalanceText}
            />
          {/snippet}
        </LabelledField>
      </div>

      <LabelledField
        label="Statement Reference"
        hint="What the bank calls this statement, where it names one."
        error={fieldRefusal(problem, "statementReference")}
      >
        {#snippet children({ props })}
          <Input
            {...props}
            placeholder={placeholderOf("Statement Reference")}
            disabled={busy}
            bind:value={statementReference}
          />
        {/snippet}
      </LabelledField>

      <!-- THE LINES. Each is a row of the one list, and the way to add another is the list's last
           control rather than a second bordered form beneath it. -->
      <div class="flex flex-col gap-12">
        <FieldLabel as="p">Lines</FieldLabel>

        {#each lines as line, position (line.key)}
          <div class="flex flex-col gap-8 border-t border-border-default pt-12">
            <div class="flex items-center justify-between gap-8">
              <FieldLabel as="p">Line {position + 1}</FieldLabel>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                title={`Remove line ${String(position + 1)} from this statement`}
                onclick={() => removeLine(line.key)}
              >
                <Trash2 class="size-16" aria-hidden="true" />
                Remove
              </Button>
            </div>

            <div class="grid gap-12 sm:grid-cols-2">
              <DatePicker
                label="Posted On"
                value={civilDateValue(line.postedOn)}
                onValueChange={(next) =>
                  changeLine(line.key, { postedOn: civilDateTextOrEmpty(next) })}
                disabled={busy}
              />

              <LabelledField label="Direction" error={fieldRefusal(problem, "direction")}>
                {#snippet children({ props })}
                  <ChoicePicker
                    inputId={props.id}
                    label="Direction"
                    options={STATEMENT_DIRECTION_CHOICES}
                    value={line.direction}
                    disabled={busy}
                    onchange={(next) =>
                      changeLine(line.key, {
                        direction: next === "withdrawal" ? "withdrawal" : "deposit",
                      })}
                  />
                {/snippet}
              </LabelledField>

              <LabelledField label="Amount">
                {#snippet children({ props })}
                  <Input
                    {...props}
                    placeholder={placeholderOf("Amount")}
                    inputmode="decimal"
                    disabled={busy}
                    value={line.amountText}
                    oninput={(event) =>
                      changeLine(line.key, { amountText: event.currentTarget.value })}
                  />
                {/snippet}
              </LabelledField>

              <LabelledField label="Description">
                {#snippet children({ props })}
                  <Input
                    {...props}
                    placeholder={placeholderOf("Description")}
                    disabled={busy}
                    value={line.description}
                    oninput={(event) =>
                      changeLine(line.key, { description: event.currentTarget.value })}
                  />
                {/snippet}
              </LabelledField>

              <LabelledField label="Reference">
                {#snippet children({ props })}
                  <Input
                    {...props}
                    placeholder={placeholderOf("Reference")}
                    disabled={busy}
                    value={line.reference}
                    oninput={(event) =>
                      changeLine(line.key, { reference: event.currentTarget.value })}
                  />
                {/snippet}
              </LabelledField>

              <LabelledField label="Counterparty">
                {#snippet children({ props })}
                  <Input
                    {...props}
                    placeholder={placeholderOf("Counterparty")}
                    disabled={busy}
                    value={line.counterpartyName}
                    oninput={(event) =>
                      changeLine(line.key, { counterpartyName: event.currentTarget.value })}
                  />
                {/snippet}
              </LabelledField>
            </div>
          </div>
        {/each}

        <div class="flex border-t border-border-default pt-12">
          <Button variant="secondary" size="sm" disabled={busy} onclick={addLine}>
            <Plus class="size-16" aria-hidden="true" />
            Add Line
          </Button>
        </div>
      </div>
    </div>
  {/snippet}

  {#snippet context()}
    <div class="flex flex-col gap-16">
      <DefinitionList.Root>
        <DefinitionList.Row term="Lines">{String(lines.length)}</DefinitionList.Row>
        <DefinitionList.Row term="Deposits">
          <span class="tabular-nums">{money(totals.depositTotalMinor)}</span>
        </DefinitionList.Row>
        <DefinitionList.Row term="Withdrawals">
          <span class="tabular-nums">{money(totals.withdrawalTotalMinor)}</span>
        </DefinitionList.Row>
        <DefinitionList.Row
          term="Implied Closing"
          empty={totals.impliedClosingMinor === null}
          title="The opening balance, plus what the lines pay in, less what they pay out."
        >
          <span class="tabular-nums">
            {totals.impliedClosingMinor === null ? "" : money(totals.impliedClosingMinor)}
          </span>
        </DefinitionList.Row>
        {#if totals.impliedClosingMinor === null}
          <DefinitionList.Empty term="Implied Closing">
            The lines add up to a closing balance once the opening balance and every line's amount
            are amounts.
          </DefinitionList.Empty>
        {/if}
      </DefinitionList.Root>

      {#if difference !== null}
        <Alert.Root variant="warning">
          <Alert.Title>The Lines and the Closing Balance Differ</Alert.Title>
          <Alert.Description>{difference}</Alert.Description>
        </Alert.Root>
      {/if}
    </div>
  {/snippet}
</ActionDialog>
