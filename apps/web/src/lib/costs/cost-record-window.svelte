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
   * no rate, nothing multiplied. The window states what the amount will be recorded as and stops
   * there, because there is no working to show.
   *
   * THE PAYEE IS OPTIONAL. Plenty of real costs were consumed rather than paid to anybody, so the
   * field is offered on every cost, and leaving it empty is an answer rather than an omission.
   *
   * WHAT IS DESIGNED AND NOT YET SERVED STAYS ON SCREEN. The entry number, the entered date, the
   * recorder, the attachments, the invoice a billed cost rides, the history and the internal memo
   * are all part of this record; the listing carries none of them. Each is rendered where it
   * belongs, refused, saying what it waits on.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import { WriteIntent } from "$lib/api/write-intent.ts";
  import * as Select from "@magna-carta/design-system/select";
  import * as SegmentedControl from "@magna-carta/design-system/segmented-control";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EventRail from "@magna-carta/design-system/event-rail";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import RecordAttachments from "@magna-carta/design-system/record-attachments";
  import RecordChain from "@magna-carta/design-system/record-chain";
  import RecordWindow, { type RecordWindowTab } from "@magna-carta/design-system/record-window";
  import {
    RecordSubjectLine,
    type RecordSubject,
  } from "@magna-carta/design-system/record-reference";
  import Textarea from "@magna-carta/design-system/textarea";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { formatInstant, placeholderOf } from "@magna-carta/design-system/formatters";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import Info from "@lucide/svelte/icons/info";
  import Lock from "@lucide/svelte/icons/lock";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import { SoonAffordance } from "@magna-carta/design-system/maturity";
  import { costStatusKey } from "$lib/matters/cost-api.ts";
  // The picker and the matter shape it takes are the Time Sheet's: pure narrowing over a list of
  // matters, with no knowledge of time entries in it. A second combobox over the same list would be
  // two chances to disagree about which half of a matter finds it.
  import MatterPicker from "$lib/time/matter-picker.svelte";
  import type { SheetMatter } from "$lib/time/time-sheet-model.ts";
  import type { PickableEntity } from "@magna-carta/design-system/entity-picker";
  import DirectoryEntityPicker from "$lib/directory/directory-entity-picker.svelte";
  import { directoryPickerSearch } from "$lib/directory/directory-picker-source.ts";
  import { entityKindFromIdentifier } from "$lib/directory/directory-api.ts";
  import type { ExpenseCodeCatalogue } from "./cost-expense-codes.svelte.ts";
  import { billHref } from "$lib/money/index.ts";
  import { COST_LEDGER_GAPS, REVIEW_GATE_ENABLED, gapCellTitle, gapReason } from "./cost-gaps.ts";
  import { costEntrySheet } from "./cost-print-sheet.ts";
  import { civilDateOf } from "@magna-carta/civil-time/civil-date";
  import {
    costDraftRefusal,
    createCost,
    parseAmountMinor,
    patchCost,
    type CostLedgerEntry,
  } from "./cost-operations.ts";
  import { billingSentence, payeeText } from "./cost-vocabulary.ts";
import { GONE_RECORDER_NOTE, recorderState, recorderText, returnedDraftReason } from "$lib/records/work-in-progress-record.ts";
  import { printSheetDates } from "$lib/print-sheet";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";

  let {
    open = $bindable(false),
    entry = null,
    editing = $bindable(false),
    matterId,
    matterTitle,
    matterNumber = null,
    matters = [],
    mattersCapped = false,
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
    /**
     * The firm's matters, for a NEW cost written from a surface that stands on none.
     *
     * Empty is the matter ledger's case and the default: the matter is already decided, the field
     * is absent, and `matterId` above is what a new cost is written against. Non-empty is the
     * firm's own period screen, where the reader picks the matter per cost — the same arrangement
     * the Time Sheet has, for the same reason: a cost captured with no matter has nowhere to be
     * recovered from, so the choice is made at capture rather than left for somebody to file later.
     */
    matters?: readonly SheetMatter[];
    /** Whether the list above is a page of the record rather than all of it. */
    mattersCapped?: boolean;
    currency: string;
    expenseCodes: ExpenseCodeCatalogue;
    /** Whether this account may work this draft, and why not when it may not. */
    canWorkDraft: (cost: CostLedgerEntry) => { allowed: boolean; reason: string };
    onSaved: () => void;
  } = $props();

  const creating = $derived(entry === null);
  const fieldPrefix = $props.id();

  /**
   * Which matter a NEW cost is written against.
   *
   * On a surface standing in a matter it is that matter and the picker is absent. On one standing
   * in none it starts unchosen: a cost pre-filled with whichever matter happened to be first would
   * be a wrong answer arriving faster than no answer, and a cost is filed against the wrong matter
   * exactly once before somebody stops trusting the ledger.
   */
  const picksItsMatter = $derived(matters.length > 0);
  let chosenMatterId = $state<string | null>(null);
  const writingAgainst = $derived(picksItsMatter ? chosenMatterId : matterId);
  const chosenMatterTitle = $derived(
    matters.find((candidate) => candidate.id === chosenMatterId)?.title ?? null,
  );

  let incurredDateText = $state("");
  let amountText = $state("");
  let descriptionText = $state("");
  let billingChoice = $state("billable");
  let vendorId = $state<string | null>(null);
  let vendorName = $state<string | null>(null);
  let expenseCodeId = $state("");
  let saving = $state(false);
  // One intent, one idempotency key: every attempt at saving THIS cost carries the same key, so a
  // retry after a lost response replays the write the server may already have committed rather than
  // recording the cost a second time. The key rotates once a save succeeds.
  let writeIntent = new WriteIntent();
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
    billing: "billable",
    vendorId: null as string | null,
    expenseCodeId: "",
  });

  function rememberWhatIsInTheFields(): void {
    seeded.incurredDate = incurredDateText;
    seeded.amount = amountText;
    seeded.description = descriptionText;
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
    incurredDateText = entry?.incurredDate ?? civilDateOf(new Date());
    amountText = entry === null ? "" : (entry.amountMinor / 100).toFixed(2);
    descriptionText = entry?.description ?? "";
    billingChoice = entry === null || entry.billable ? "billable" : "absorbed";
    vendorId = entry?.vendorId ?? null;
    vendorName = entry?.vendorName ?? null;
    expenseCodeId = entry?.utbmsExpenseCodeId ?? "";
    rememberWhatIsInTheFields();
  });

  const unsavedChanges = $derived(
    incurredDateText !== seeded.incurredDate ||
      amountText !== seeded.amount ||
      descriptionText !== seeded.description ||
      billingChoice !== seeded.billing ||
      vendorId !== seeded.vendorId ||
      expenseCodeId !== seeded.expenseCodeId,
  );

  function forgetChanges(): void {
    incurredDateText = seeded.incurredDate;
    amountText = seeded.amount;
    descriptionText = seeded.description;
    billingChoice = seeded.billing;
    vendorId = seeded.vendorId;
    expenseCodeId = seeded.expenseCodeId;
    saveFailure = null;
    if (entry === null) open = false;
  }

  const BILLING_CHOICES = [
    { value: "billable", label: "Billable, next bill" },
    { value: "absorbed", label: "Absorbed by the firm" },
  ] as const;

  const billable = $derived(billingChoice === "billable");
  const amountMinor = $derived(parseAmountMinor(amountText));

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

  const refusal = $derived(
    editing
      ? // The matter leads the refusals for a new cost on a matterless surface: it is the one field
        // whose absence makes the record meaningless rather than merely incomplete.
        (creating && picksItsMatter && writingAgainst === null
          ? "Name the matter this cost was advanced for."
          : costDraftRefusal({ amountText, description: descriptionText }))
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
    if (entry === null) return "A new cost has no history yet.";
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
          ...printSheetDates(),
          instant: (isoInstant) => formatInstant(isoInstant),
          printedAt: formatInstant(new Date()),
          expenseCodeLabels: expenseCodes.labelFor,
          source: entry.source,
        }),
  );

  /*
   * The line under the heading: the matter this record sits on, by its number.
   *
   * The number belongs here rather than only on the printed sheet — a record a person quotes out
   * loud is named in the panel that shows it, and a handle is not something anybody reads back. The
   * record's OWN number is not shown beside it because it does not have one yet: the entry-number
   * gap is a fact about this ledger, and it is stated as one.
   */
  const subjectLine = $derived<RecordSubject>(
    entry === null && picksItsMatter
      ? { facts: [chosenMatterTitle ?? "No matter chosen yet"] }
      : {
          reference: { kind: "Matter", number: matterNumber },
          facts:
            entry === null
              ? [matterTitle]
              : [matterTitle, `${COST_LEDGER_GAPS.entryNumber.field} not yet recorded`],
        },
  );

  const payeeSearch = directoryPickerSearch(fetch);

  // The payee as the picker holds it: the record's own two fields, read back as one entity. A cost
  // that names a payee the directory cannot classify shows the name and offers a fresh pick.
  const payee = $derived.by((): PickableEntity | null => {
    if (vendorId === null || vendorName === null) return null;
    const kind = entityKindFromIdentifier(vendorId);
    return kind === null ? null : { identifier: vendorId, name: vendorName, kind };
  });

  function pickPayee(entity: PickableEntity | null): void {
    vendorId = entity === null ? null : entity.identifier;
    vendorName = entity === null ? null : entity.name;
  }

  async function save(andKeepGoing: boolean): Promise<void> {
    if (refusal !== null || saving) return;
    const minor = parseAmountMinor(amountText);
    if (minor === null) return;
    saving = true;
    saveFailure = null;
    const code = expenseCodeId === "" ? null : expenseCodeId;
    const outcome =
      entry === null
        ? (
            await writeIntent.submit((key) =>
              createCost(
                fetch,
                {
                  matterId: writingAgainst ?? matterId,
                  vendorId,
                  incurredDate: incurredDateText,
                  amountMinor: minor,
                  currency,
                  billable,
                  utbmsExpenseCodeId: code,
                  description: descriptionText.trim(),
                },
                key,
              ),
            )
          ).value
        : (
            await writeIntent.submit((key) =>
              patchCost(
                fetch,
                entry.id,
                {
                  vendorId,
                  incurredDate: incurredDateText,
                  amountMinor: minor,
                  billable,
                  utbmsExpenseCodeId: code,
                  description: descriptionText.trim(),
                },
                key,
              ),
            )
          ).value;
    saving = false;
    if (outcome.kind !== "ok") {
      saveFailure =
        outcome.kind === "problem"
          ? `The cost was not saved. The server answered ${String(outcome.problem.status)}.${
              outcome.problem.detail === undefined ? "" : ` ${outcome.problem.detail}`
            }`
          : "Couldn't connect. The cost wasn't saved.";
      return;
    }
    onSaved();
    if (andKeepGoing) {
      writeIntent = new WriteIntent();
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
  <!-- The matter this sits on, by its number. On a matterless surface the line follows the pick, so
       the window answers "which matter" as soon as it has been decided rather than standing empty
       above a filled form. -->
  <RecordSubjectLine subject={subjectLine} />
  {#if entry !== null}
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

    <!--
      A RETURNED DRAFT SAYS SO, ABOVE THE FIELDS IT WANTS CHANGED. A cost a reviewer sent back is
      the same status as one nobody has submitted and looks identical everywhere else, so without
      this the person who has to fix it is told only that it is a draft. The reason leads the pane
      because it is the instruction: it says which of the fields below is wrong.

      It appears whether or not this firm runs review, unlike the review VERBS, and the two are
      different kinds of thing. A Submit control on a firm that has never been asked about review
      would be soliciting a workflow; a reason that is already written on the record is a fact about
      this cost, and hiding it would lose the one explanation the record carries.
    -->
    {#if entry !== null && returnedDraftReason(entry) !== null}
      <Alert.Root variant="warning">
        <Alert.Title>Sent Back For Changes</Alert.Title>
        <Alert.Description>{returnedDraftReason(entry)}</Alert.Description>
      </Alert.Root>
    {/if}

    {#if creating && picksItsMatter}
      <!-- First, because a cost is a fact about a matter before it is a fact about an amount, and
           because the refusal that names it leads the others. -->
      <div class="flex flex-col gap-4">
        <Label for="{fieldPrefix}-matter">Matter</Label>
        <MatterPicker
          {matters}
          value={chosenMatterId}
          inputId="{fieldPrefix}-matter"
          disabled={readOnly}
          capped={mattersCapped}
          title="The matter this cost was advanced for. A cost has nowhere to be recovered from without one."
          onpick={(picked) => (chosenMatterId = picked)}
        />
      </div>
    {/if}

    <div class="grid gap-12 sm:grid-cols-2">
      <div class="flex flex-col gap-4">
        <DatePicker
          label="Date Incurred"
          value={civilDateValue(incurredDateText)}
          onValueChange={(next) => (incurredDateText = civilDateTextOrEmpty(next))}
          disabled={readOnly}
        />
      </div>
    </div>

    <div class="flex flex-col gap-4">
      <span id="{fieldPrefix}-billing" class="mc-label">Billing</span>
      {#if readOnly}
        <Input
          aria-labelledby="{fieldPrefix}-billing"
          value={billingSentence(billable)}
          disabled
        />
      {:else}
        <SegmentedControl.Root
          aria-labelledby="{fieldPrefix}-billing"
          title="Whether the client may be asked for this cost. Absorbing it is the firm's decision, kept visible in the totals."
          value={billingChoice}
          onValueChange={(next) => (billingChoice = next)}
        >
          {#each BILLING_CHOICES as choice (choice.value)}
            <SegmentedControl.Item value={choice.value}>{choice.label}</SegmentedControl.Item>
          {/each}
        </SegmentedControl.Root>
      {/if}
    </div>

    <div class="grid gap-12 sm:grid-cols-2">
      <div class="flex flex-col gap-4">
        <Label for="{fieldPrefix}-payee">Payee</Label>
        {#if readOnly}
          <Input
            id="{fieldPrefix}-payee"
            value={entry === null ? (vendorName ?? "Not recorded") : payeeText(entry)}
            disabled
          />
        {:else}
          <DirectoryEntityPicker
            search={payeeSearch}
            value={payee}
            onSelect={pickPayee}
            onClear={() => pickPayee(null)}
            label="Payee"
            inputId="{fieldPrefix}-payee"
          />
        {/if}
      </div>

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
    </div>

    <!--
      THE SAME PAIR THE TIME ENTRY WRITES, IN THE SAME SHAPE. Description then Internal Memo,
      stacked and full width, each a label over its field with the help on the hover rather than a
      caption under it. They were side by side in a two-column grid, which made the private note
      look like a second, equal fact about the cost instead of the quieter half of one act of
      writing — and made a member who had learned the time window learn this one again.

      A cost and a time entry are the two things a matter accrues, they are recorded minutes apart
      by the same person, and the fields they share should not move between them.
    -->
    <div class="flex flex-col gap-4">
      <Label for="{fieldPrefix}-description">Description</Label>
      <Textarea
        id="{fieldPrefix}-description"
        class="resize-none"
        rows={3}
        placeholder={placeholderOf("Description")}
        title="What the cost was, as the client will read it on the bill."
        disabled={readOnly}
        bind:value={descriptionText}
      />
    </div>

    <div class="flex flex-col gap-4" data-internal-only="true">
      <Label>Internal Memo</Label>
      <SoonAffordance reason={gapReason("memo")} reasonPlacement="line">
        {#snippet control(soon)}
          <!-- No title of its own: the Soon composition supplies the hover, which says what the
               field is waiting on — the more useful sentence while it cannot be typed in. -->
          <Textarea class="resize-none" rows={2} placeholder={placeholderOf("Internal Memo")} {...soon} />
        {/snippet}
      </SoonAffordance>
    </div>

    <!--
      WHERE THE RECORD CAME FROM, UNDER THE FIELDS AND NEVER AMONG THEM. Who wrote the cost down
      and when are facts ABOUT the record rather than parts of it: nobody edits them, and putting
      them in the form would invite somebody to try. They stay visible while the fields are open,
      because the question they answer — who should I ask about this figure — is at its sharpest
      exactly when a reader is about to change it.

      Entered By is not a permission. A cost belongs to the matter it was advanced for, not to
      whoever typed it, so this is who to ask and never a gate.
    -->
    {#if entry !== null}
      <p class="text-xs text-text-muted">
        Recorded by <span title={recorderState(entry).kind === "gone" ? GONE_RECORDER_NOTE : undefined}
          >{recorderText(entry)}</span
        >
        on {formatInstant(entry.createdAt)}. The cost was incurred {formatDate(entry.incurredDate)}.
      </p>
    {/if}
  </div>
{/snippet}

{#snippet attachmentsTab()}
  <RecordAttachments
    attachments={[]}
    canEdit={false}
    attachDisabledReason="Not built yet: {gapReason('attachmentPicker')}."
  />
{/snippet}

{#snippet historyTab()}
  <EventRail
    events={[]}
    label="This cost's history"
    emptyMessage="Not built yet: {gapReason('history')}. Who recorded it and when is on Details."
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
        <RecordChain
          current={REVIEW_GATE_ENABLED || entry.status === "billed" ? entry.status : "draft"}
          reviewGate={REVIEW_GATE_ENABLED}
        />
      {/if}
      <div class="flex items-start gap-8 text-sm text-text-muted">
        <Info class="size-16 shrink-0" aria-hidden="true" />
        <span>
          {#if entry.status === "billed"}
            {#if entry.invoiceId == null}
              Billed. Which bill took it up is not recorded on this cost, so there is nothing to
              open from here.
            {:else}
              Billed. <a
                class="underline underline-offset-2"
                href={billHref(entry.matterId, entry.invoiceId)}
                >Open the bill this cost was charged on</a
              >, on the matter it charges.
            {/if}
          {:else if entry.status === "void"}
            Withdrawn. A void cost stays on the record and counts toward nothing.
          {:else}
            Not on a bill yet. Billable costs are added to a draft bill in the Billing section, one line each.
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
      Saves as a draft.
    </span>
  {/if}
  {#if !fieldsOpen}
    <!--
      Withdrawing a submission is a real act of this record and no route serves it, so it is
      rendered where the design puts it rather than left out. It appears only against the status it
      belongs to: a verb offered where it could never apply says nothing true even when refused.
    -->
    {#if entry?.status === "submitted"}
      <SoonAffordance reason={gapReason("unsubmit")}>
        {#snippet control(soon)}
          <Button variant="secondary" {...soon}>Unsubmit</Button>
        {/snippet}
      </SoonAffordance>
    {/if}
    <Button onclick={() => (open = false)}>Close</Button>
  {:else if creating}
    <!-- The one verb this record type adds: costs arrive in runs, and a person who has just
         recorded one vendor invoice is usually about to record the next. -->
    <Button
      variant="secondary"
      disabled={saveRefusal !== undefined}
      title={saveRefusal ?? "Save this draft and record another with the same date"}
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
    { key: "attachments", label: "Attachments", content: attachmentsTab },
    { key: "history", label: "History", content: historyTab },
    { key: "billing", label: "Billing", content: billingTab },
  ] satisfies RecordWindowTab[]}
  defaultTab="billing"
  editDisabledReason={editRefusal}
  saveDisabledReason={saveRefusal}
  saveLabel={"Save & Close"}
  {unsavedChanges}
  onSave={() => void save(false)}
  onCancel={forgetChanges}
  onPrint={() => (printOpen = true)}
/>

{#if sheet !== null}
  <PrintSheet bind:open={printOpen} {sheet} />
{/if}
