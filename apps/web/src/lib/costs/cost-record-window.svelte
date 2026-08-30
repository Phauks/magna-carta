<script lang="ts">
  /*
   * A cost, opened.
   *
   * The window is the product's one record window: the left pane is the record — dense,
   * top-aligned, the changeable facts — and the right pane is the context somebody goes looking for
   * beside it. Nothing about that shape is decided here; this file contributes the field list, the
   * tab set and the action bar, which is the whole of what a record type is allowed to contribute.
   *
   * THERE IS NO ARITHMETIC, AND THAT IS THE DESIGN. A cost is an exact amount as spent: no hours,
   * no rate, nothing multiplied. What stands in the place the time record puts its arithmetic is
   * the CONSEQUENCE of the two choices that actually matter — hard or soft, recoverable or absorbed
   * — written out as a sentence, so neither is ever a mystery toggle.
   *
   * THE PAYEE FIELD IS ABSENT ON A SOFT COST, NOT DISABLED. Nobody outside was paid, so there is no
   * third party to name: absence is the truth here, where a lock would imply a name exists and is
   * being withheld.
   *
   * WHAT IS DESIGNED AND NOT YET SERVED STAYS ON SCREEN. The entry number, the entered date, the
   * recorder, the receipt, the invoice a billed cost rides, the history and the internal memo are
   * all part of this record; the listing carries none of them. Each is rendered where it belongs,
   * refused, saying what it waits on.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Select from "@magna-carta/design-system/select";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EventRail from "@magna-carta/design-system/event-rail";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import RecordAttachments from "@magna-carta/design-system/record-attachments";
  import RecordChain from "@magna-carta/design-system/record-chain";
  import RecordWindow, { type RecordWindowTab } from "@magna-carta/design-system/record-window";
  import Textarea from "@magna-carta/design-system/textarea";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { formatInstant, placeholderOf } from "@magna-carta/design-system/formatters";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import Info from "@lucide/svelte/icons/info";
  import Lock from "@lucide/svelte/icons/lock";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import SoonAffordance from "$lib/maturity/soon-affordance.svelte";
  import type { DirectorySearchHit } from "$lib/directory/directory-api.ts";
  import { costStatusKey, type DisbursementClass } from "$lib/matters/cost-api.ts";
  import CostPayeePicker from "./cost-payee-picker.svelte";
  import type { ExpenseCodeCatalogue } from "./cost-expense-codes.svelte.ts";
  import { COST_LEDGER_GAPS, gapCellTitle, gapReason } from "./cost-gaps.ts";
  import { costEntrySheet } from "./cost-print-sheet.ts";
  import {
    costDraftRefusal,
    createCost,
    parseAmountMinor,
    patchCost,
    writeKey,
    type CostLedgerEntry,
  } from "./cost-operations.ts";
  import {
    CLASS_LABELS,
    CLASS_MEANINGS,
    billingSentence,
    payeeText,
  } from "./cost-vocabulary.ts";

  let {
    open = $bindable(false),
    entry = null,
    editing = $bindable(false),
    matterId,
    matterTitle,
    matterNumber = null,
    currency,
    expenseCodes,
    canWorkDraft,
    onSaved,
  }: {
    open?: boolean;
    /** The cost being read, or null while a new one is being written. */
    entry?: CostLedgerEntry | null;
    /**
     * Whether the record's fields are open for change. The window owns this — its Edit control
     * raises it and its abandon lowers it — and it is bound here so a listing can open a cost
     * straight into its fields, and so this file can lower it when a save has actually landed.
     */
    editing?: boolean;
    matterId: string;
    matterTitle: string;
    matterNumber?: string | null;
    currency: string;
    expenseCodes: ExpenseCodeCatalogue;
    /** Whether this account may work this draft, and why not when it may not. */
    canWorkDraft: (cost: CostLedgerEntry) => { allowed: boolean; reason: string };
    onSaved: () => void;
  } = $props();

  const creating = $derived(entry === null);
  const fieldPrefix = $props.id();

  let incurredDateText = $state("");
  let amountText = $state("");
  let descriptionText = $state("");
  let disbursementClass = $state<DisbursementClass>("hard");
  let billingChoice = $state("recoverable");
  let vendorId = $state<string | null>(null);
  let vendorName = $state<string | null>(null);
  let expenseCodeId = $state("");
  let saving = $state(false);
  let saveFailure = $state<string | null>(null);
  let printOpen = $state(false);

  /*
   * What the fields held when they were last seeded or last saved. Keeping it is what lets this
   * window answer honestly whether walking away would lose anything, and it is what abandoning
   * puts back.
   */
  const seeded = $state({
    incurredDate: "",
    amount: "",
    description: "",
    disbursementClass: "hard" as DisbursementClass,
    billing: "recoverable",
    vendorId: null as string | null,
    expenseCodeId: "",
  });

  function rememberWhatIsInTheFields(): void {
    seeded.incurredDate = incurredDateText;
    seeded.amount = amountText;
    seeded.description = descriptionText;
    seeded.disbursementClass = disbursementClass;
    seeded.billing = billingChoice;
    seeded.vendorId = vendorId;
    seeded.expenseCodeId = expenseCodeId;
  }

  /*
   * The fields are re-seeded from the record whenever the window opens on a different cost, and
   * never while it is being edited: a re-seed mid-edit would silently discard what somebody typed.
   */
  let seededFor = $state<string | null>(null);
  $effect(() => {
    const identity = entry === null ? "new" : entry.id;
    if (!open) {
      seededFor = null;
      return;
    }
    if (seededFor === identity) return;
    seededFor = identity;
    saveFailure = null;
    incurredDateText = entry?.incurredDate ?? new Date().toISOString().slice(0, 10);
    amountText = entry === null ? "" : (entry.amountMinor / 100).toFixed(2);
    descriptionText = entry?.description ?? "";
    disbursementClass = entry?.disbursementClass ?? "hard";
    billingChoice = entry === null || entry.billable ? "recoverable" : "absorbed";
    vendorId = entry?.vendorId ?? null;
    vendorName = entry?.vendorName ?? null;
    expenseCodeId = entry?.utbmsExpenseCodeId ?? "";
    rememberWhatIsInTheFields();
  });

  const unsavedChanges = $derived(
    incurredDateText !== seeded.incurredDate ||
      amountText !== seeded.amount ||
      descriptionText !== seeded.description ||
      disbursementClass !== seeded.disbursementClass ||
      billingChoice !== seeded.billing ||
      vendorId !== seeded.vendorId ||
      expenseCodeId !== seeded.expenseCodeId,
  );

  function forgetChanges(): void {
    incurredDateText = seeded.incurredDate;
    amountText = seeded.amount;
    descriptionText = seeded.description;
    disbursementClass = seeded.disbursementClass;
    billingChoice = seeded.billing;
    vendorId = seeded.vendorId;
    expenseCodeId = seeded.expenseCodeId;
    saveFailure = null;
    if (entry === null) open = false;
  }

  const CLASS_CHOICES = [
    { value: "hard", label: "Hard: paid to a third party" },
    { value: "soft", label: "Soft: the firm's own resource" },
  ] as const;

  const BILLING_CHOICES = [
    { value: "recoverable", label: "Recoverable, next invoice" },
    { value: "absorbed", label: "Absorbed by the firm" },
  ] as const;

  const recoverable = $derived(billingChoice === "recoverable");
  const hard = $derived(disbursementClass === "hard");
  const amountMinor = $derived(parseAmountMinor(amountText));

  const classLabel = $derived(
    CLASS_CHOICES.find((choice) => choice.value === disbursementClass)?.label ?? "",
  );
  const billingChoiceLabel = $derived(
    BILLING_CHOICES.find((choice) => choice.value === billingChoice)?.label ?? "",
  );
  const expenseCodeLabel = $derived(
    expenseCodeId === ""
      ? "None"
      : (() => {
          const found = expenseCodes.available.find((code) => code.id === expenseCodeId);
          return found === undefined ? expenseCodeId : `${found.code} ${found.label}`;
        })(),
  );

  /** What the amount will be recorded as, once it reads as an amount at all. */
  const recordedAs = $derived(
    amountMinor === null ? "—" : formatMoney(amountMinor / 100, { currency }),
  );

  /**
   * What choosing this class and this disposition actually does to the firm's books, in one
   * sentence. It is the reason the class control is not a mystery toggle.
   */
  const consequence = $derived.by((): string => {
    if (amountMinor === null) {
      return "Enter the amount as spent: a cost is recorded exactly, never computed.";
    }
    const payeePart = hard && vendorName !== null ? ` advanced to ${vendorName}` : "";
    return hard
      ? `A hard cost${payeePart}: the firm's cash out of pocket, ` +
          (recoverable
            ? "carried as recoverable from the client until it is billed and repaid."
            : "absorbed by the firm. It will not appear on a bill.")
      : "A soft cost: the firm's own resource charged back at its set rate. No third party was paid" +
          (recoverable
            ? "; the client may be asked for it on the next invoice."
            : "; the firm absorbs it.");
  });

  const refusal = $derived(
    editing
      ? costDraftRefusal({
          amountText,
          description: descriptionText,
          disbursementClass,
          vendorId: hard ? vendorId : null,
        })
      : null,
  );

  /** Why the change cannot be committed as it stands. A save in flight is one of those reasons. */
  const saveRefusal = $derived(saving ? "Saving this cost." : (refusal ?? undefined));

  const heading = $derived(creating ? "Record a Cost" : editing ? "Edit Cost" : "Cost Entry");

  /* The lock the record is under, in the chain's own words. */
  const lockLine = $derived.by((): string | null => {
    if (entry === null) return null;
    if (entry.status === "draft") {
      const verdict = canWorkDraft(entry);
      return verdict.allowed ? null : verdict.reason;
    }
    return statusEntry(costStatusKey(entry.status)).meaning;
  });

  const editRefusal = $derived.by((): string | undefined => {
    if (entry === null) return "A new cost is written in its fields; there is nothing to read yet.";
    if (entry.status !== "draft") return statusEntry(costStatusKey(entry.status)).meaning;
    const verdict = canWorkDraft(entry);
    return verdict.allowed ? undefined : verdict.reason;
  });

  const sheet = $derived(
    entry === null
      ? null
      : costEntrySheet(entry, {
          matterTitle,
          matterNumber,
          money: (amount) => formatMoney(amount, { currency: entry.currency }),
          date: (isoDate) => formatDate(isoDate),
          printedAt: formatInstant(new Date()),
          expenseCodeLabels: expenseCodes.labelFor,
          source: entry.source,
        }),
  );

  function pickPayee(hit: DirectorySearchHit | null): void {
    vendorId = hit === null ? null : hit.entityId;
    vendorName = hit === null ? null : hit.displayName;
  }

  async function save(andKeepGoing: boolean): Promise<void> {
    if (refusal !== null || saving) return;
    const minor = parseAmountMinor(amountText);
    if (minor === null) return;
    saving = true;
    saveFailure = null;
    // A soft cost has no payee by design, so one is never sent even if a name was picked first.
    const payee = hard ? vendorId : null;
    const code = expenseCodeId === "" ? null : expenseCodeId;
    const outcome =
      entry === null
        ? await createCost(
            fetch,
            {
              matterId,
              vendorId: payee,
              incurredDate: incurredDateText,
              amountMinor: minor,
              currency,
              disbursementClass,
              billable: recoverable,
              utbmsExpenseCodeId: code,
              description: descriptionText.trim(),
            },
            writeKey(),
          )
        : await patchCost(
            fetch,
            entry.id,
            {
              vendorId: payee,
              incurredDate: incurredDateText,
              amountMinor: minor,
              disbursementClass,
              billable: recoverable,
              utbmsExpenseCodeId: code,
              description: descriptionText.trim(),
            },
            writeKey(),
          );
    saving = false;
    if (outcome.kind !== "ok") {
      saveFailure =
        outcome.kind === "problem"
          ? `The cost was not saved. The server answered ${String(outcome.problem.status)}.${
              outcome.problem.detail === undefined ? "" : ` ${outcome.problem.detail}`
            }`
          : "Nothing answered. The cost was not saved and the record is unchanged.";
      return;
    }
    onSaved();
    if (andKeepGoing) {
      amountText = "";
      descriptionText = "";
      vendorId = null;
      vendorName = null;
      // The next cost starts from these fields, so they are what "unchanged" now means: without
      // this, the emptied form would read as unsaved work and the window would argue on the way out.
      rememberWhatIsInTheFields();
      return;
    }
    editing = false;
    open = false;
  }
</script>

{#snippet subtitle()}
  {#if entry === null}
    <span>{matterTitle}</span>
  {:else}
    <span title={gapCellTitle("entryNumber")}>
      {COST_LEDGER_GAPS.entryNumber.field} not yet recorded
    </span>
    <Badge {...statusBadgeAttributes(costStatusKey(entry.status))}>
      {statusEntry(costStatusKey(entry.status)).label}
    </Badge>
  {/if}
{/snippet}

<!--
  ONE pane, both modes. The window hands it whether the fields are open; the values and the fields
  are the same rows in the same order at the same width, which is what stops a reader losing their
  place the moment they press Edit.
-->
{#snippet record({ editing: fieldsOpen }: { editing: boolean })}
  {@const readOnly = !fieldsOpen}
  <div class="flex flex-col gap-16">
    {#if saveFailure !== null}
      <Alert.Root variant="danger">
        <Alert.Title>Not Saved</Alert.Title>
        <Alert.Description>{saveFailure}</Alert.Description>
      </Alert.Root>
    {/if}

    <div class="grid gap-12 sm:grid-cols-3">
      <div class="flex flex-col gap-4">
        <Label for="{fieldPrefix}-incurred">Date Incurred</Label>
        <Input
          id="{fieldPrefix}-incurred"
          type="date"
          disabled={readOnly}
          bind:value={incurredDateText}
        />
      </div>

      <div class="flex flex-col gap-4">
        <Label for="{fieldPrefix}-class">Class</Label>
        {#if readOnly}
          <Input
            id="{fieldPrefix}-class"
            value={CLASS_LABELS[disbursementClass]}
            title={CLASS_MEANINGS[disbursementClass]}
            disabled
          />
        {:else}
          <Select.Root
            type="single"
            items={[...CLASS_CHOICES]}
            allowDeselect={false}
            bind:value={
              () => disbursementClass, (next) => (disbursementClass = next as DisbursementClass)
            }
          >
            <Select.Trigger
              id="{fieldPrefix}-class"
              aria-label="Class"
              class="w-full"
              title={CLASS_MEANINGS[disbursementClass]}
            >
              <Select.Value placeholder={classLabel} />
            </Select.Trigger>
            <Select.Content>
              {#each CLASS_CHOICES as choice (choice.value)}
                <Select.Item
                  value={choice.value}
                  label={choice.label}
                  title={CLASS_MEANINGS[choice.value]}
                />
              {/each}
            </Select.Content>
          </Select.Root>
        {/if}
      </div>

      <div class="flex flex-col gap-4">
        <Label for="{fieldPrefix}-billing">Billing</Label>
        {#if readOnly}
          <Input id="{fieldPrefix}-billing" value={billingSentence(recoverable)} disabled />
        {:else}
          <Select.Root
            type="single"
            items={[...BILLING_CHOICES]}
            allowDeselect={false}
            bind:value={() => billingChoice, (next) => (billingChoice = next as string)}
          >
            <Select.Trigger
              id="{fieldPrefix}-billing"
              aria-label="Billing"
              class="w-full"
              title="Whether the client may be asked for this cost. Absorbing it is the firm's decision, kept visible in the totals."
            >
              <Select.Value placeholder={billingChoiceLabel} />
            </Select.Trigger>
            <Select.Content>
              {#each BILLING_CHOICES as choice (choice.value)}
                <Select.Item value={choice.value} label={choice.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        {/if}
      </div>
    </div>

    <div class="grid gap-12 sm:grid-cols-2">
      <!-- A soft cost has no payee by design, so the field is absent rather than locked. -->
      {#if hard}
        <div class="flex flex-col gap-4">
          <Label for="{fieldPrefix}-payee">Payee</Label>
          {#if readOnly}
            <Input
              id="{fieldPrefix}-payee"
              value={entry === null ? (vendorName ?? "Not recorded") : payeeText(entry)}
              disabled
            />
          {:else}
            <CostPayeePicker
              inputId="{fieldPrefix}-payee"
              selectedName={vendorName}
              onPick={pickPayee}
            />
          {/if}
        </div>
      {:else}
        <p class="text-xs text-text-muted">{CLASS_MEANINGS.soft}</p>
      {/if}

      <div class="flex flex-col gap-4">
        <Label for="{fieldPrefix}-expense-code">Expense Code</Label>
        {#if readOnly}
          <Input id="{fieldPrefix}-expense-code" value={expenseCodeLabel} disabled />
        {:else if expenseCodes.pickerRefusal !== null}
          <Input id="{fieldPrefix}-expense-code" value={expenseCodeLabel} disabled />
          <p class="text-xs text-text-muted">{expenseCodes.pickerRefusal}</p>
        {:else}
          <Select.Root
            type="single"
            items={expenseCodes.available.map((code) => ({
              value: code.id,
              label: `${code.code} ${code.label}`,
            }))}
            bind:value={() => expenseCodeId, (next) => (expenseCodeId = (next as string) ?? "")}
          >
            <Select.Trigger
              id="{fieldPrefix}-expense-code"
              aria-label="Expense Code"
              class="w-full"
              title="Required at capture only on an e-billing matter."
            >
              <Select.Value placeholder="None" />
            </Select.Trigger>
            <Select.Content>
              {#each expenseCodes.available as code (code.id)}
                <Select.Item value={code.id} label="{code.code} {code.label}" />
              {/each}
            </Select.Content>
          </Select.Root>
        {/if}
      </div>
    </div>

    <!-- The amount, what it will be recorded as, and what recording it that way means. -->
    <div class="flex flex-col gap-8">
      <div class="flex flex-wrap items-end gap-12">
        <div class="flex min-w-0 flex-1 flex-col gap-4">
          <Label for="{fieldPrefix}-amount">Amount</Label>
          <Input
            id="{fieldPrefix}-amount"
            placeholder="Amount"
            title="The amount as spent. A cost is recorded exactly, never computed."
            disabled={readOnly}
            bind:value={amountText}
          />
        </div>
        <div class="flex flex-col gap-4">
          <span class="text-xs text-text-subtle">Recorded As</span>
          <span class="pb-8 tabular-nums">{recordedAs}</span>
        </div>
      </div>
      <p class="text-xs text-text-muted">{consequence}</p>
    </div>

    <div class="grid gap-12 sm:grid-cols-2">
      <div class="flex flex-col gap-4">
        <Label for="{fieldPrefix}-info">Info</Label>
        <Textarea
          id="{fieldPrefix}-info"
          rows={3}
          placeholder={placeholderOf("Info")}
          title="Info"
          disabled={readOnly}
          bind:value={descriptionText}
        />
        <p class="text-xs text-text-muted">What the cost was, as the client will read it.</p>
      </div>
      <div class="flex flex-col gap-4">
        <Label>Internal Memo</Label>
        <SoonAffordance reason={gapReason("memo")} reasonPlacement="line">
          {#snippet control(soon)}
            <Textarea rows={3} placeholder={placeholderOf("Internal Memo")} {...soon} />
          {/snippet}
        </SoonAffordance>
        <p class="text-xs text-text-muted">An internal note. It never appears on a bill.</p>
      </div>
    </div>
  </div>
{/snippet}

{#snippet receiptTab()}
  <RecordAttachments
    attachments={[]}
    canEdit={false}
    attachDisabledReason="Not built yet. Waiting on {gapReason('receiptPicker')}."
  />
{/snippet}

{#snippet historyTab()}
  <EventRail
    events={[]}
    label="This cost's history"
    emptyMessage="Not built yet. Waiting on {gapReason('history')}. Who recorded it and when are the
      first events this rail will carry."
  />
{/snippet}

{#snippet billingTab()}
  <div class="flex flex-col gap-16">
    {#if entry !== null}
      <div>
        <Badge {...statusBadgeAttributes(costStatusKey(entry.status))}>
          {statusEntry(costStatusKey(entry.status)).label}
        </Badge>
      </div>
      {#if entry.status !== "void"}
        <RecordChain current={entry.status} reviewGate />
      {/if}
      <div class="flex items-start gap-8 text-sm text-text-muted">
        <Info class="size-16 shrink-0" aria-hidden="true" />
        <span>
          {#if entry.status === "billed"}
            Billed. Which invoice took it up is not served yet: waiting on {gapReason("invoice")}.
          {:else if entry.status === "void"}
            Withdrawn. A void cost stays on the record and counts toward nothing.
          {:else}
            Not on a bill yet. Recoverable costs flow onto a draft invoice in the Billing section,
            one line per cost.
          {/if}
        </span>
      </div>
      <dl class="flex flex-col gap-4 text-sm">
        <div class="flex items-baseline justify-between gap-16">
          <dt class="text-text-muted">Billing</dt>
          <dd>{billingSentence(entry.billable)}</dd>
        </div>
        <div class="flex items-baseline justify-between gap-16">
          <dt class="text-text-muted">Date Incurred</dt>
          <dd class="tabular-nums">{formatDate(entry.incurredDate)}</dd>
        </div>
      </dl>
    {:else}
      <div class="flex items-start gap-8 text-sm text-text-muted">
        <Info class="size-16 shrink-0" aria-hidden="true" />
        <span>Not on a bill yet. A cost reaches a bill after it is approved.</span>
      </div>
    {/if}
  </div>
{/snippet}

<!--
  This file's verbs only. While the fields are open the window appends the abandon and the commit
  after these, so Cancel and Save are the same two controls, in the same place, saying the same
  thing, on every kind of record in the product.
-->
{#snippet actions({ editing: fieldsOpen }: { editing: boolean })}
  {#if !fieldsOpen && lockLine !== null}
    <span class="mr-auto flex items-center gap-4 text-xs text-text-muted">
      <Lock class="size-12" aria-hidden="true" />
      {lockLine}
    </span>
  {:else if fieldsOpen}
    <span class="mr-auto flex items-center gap-4 text-xs text-text-muted">
      <SquarePen class="size-12" aria-hidden="true" />
      Saves as a draft. Submit for Review is its own step on the cost.
    </span>
  {/if}
  {#if !fieldsOpen}
    <Button onclick={() => (open = false)}>Close</Button>
  {:else if creating}
    <!-- The one verb this record type adds: costs arrive in runs, and a person who has just
         recorded one vendor invoice is usually about to record the next. -->
    <Button
      variant="secondary"
      disabled={saveRefusal !== undefined}
      title={saveRefusal ?? "Save this draft and record another with the same date and class"}
      onclick={() => void save(true)}
    >
      Save &amp; New
    </Button>
  {/if}
{/snippet}

<RecordWindow
  bind:open
  bind:editing
  {heading}
  {subtitle}
  {record}
  {actions}
  tabs={[
    { key: "receipt", label: "Receipt", content: receiptTab },
    { key: "history", label: "History", content: historyTab },
    { key: "billing", label: "Billing", content: billingTab },
  ] satisfies RecordWindowTab[]}
  defaultTab="billing"
  editDisabledReason={editRefusal}
  saveDisabledReason={saveRefusal}
  {unsavedChanges}
  onSave={() => void save(false)}
  onCancel={forgetChanges}
  onPrint={() => (printOpen = true)}
/>

{#if sheet !== null}
  <PrintSheet bind:open={printOpen} {sheet} />
{/if}
