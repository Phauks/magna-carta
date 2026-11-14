<script lang="ts">
  /*
   * A fee, opened.
   *
   * The window is the product's one record window: the left pane is the record — dense,
   * top-aligned, the changeable facts — and the right pane is the context somebody goes looking for
   * beside it. Nothing about that shape is decided here; this file contributes the field list, the
   * tab set and the action bar, which is the whole of what a record type is allowed to contribute.
   *
   * THERE IS NO ARITHMETIC, AND THAT IS THE DESIGN. A fee is a flat charge typed exactly: no hours,
   * no rate, nothing multiplied, and nothing consolidated out of anybody's time. Where the time
   * record puts its worked-billed-rate line, a fee puts what the charge will be recorded as, and
   * that is the whole of the computation.
   *
   * THE DESCRIPTION WRAPS AND GROWS. It is the line the client reads on the bill, so the one window
   * whose job is to show the record whole never clips it, never scrolls it sideways and never hides
   * it behind an ellipsis. The internal memo beside it behaves the same way.
   *
   * EACH FACT HAS ONE HOME. The entered date and the person who entered it sit under the fields on
   * the record pane, which is where a reader goes for when-and-by-whom; the History rail beside them
   * is for what happened to the record AFTERWARDS. Repeating either in both places makes a reader
   * check whether the two agree.
   *
   * A RETURNED DRAFT SAYS SO, ABOVE THE FIELDS IT WANTS CHANGED. A fee a reviewer sent back is the
   * same status as one nobody has submitted and looks identical everywhere else, so without this the
   * person who has to fix it is told only that it is a draft. It shows whether or not the firm runs
   * review, unlike the review VERBS: a reason already written on the record is a fact about this
   * fee, and hiding it would lose the one explanation the record carries.
   */
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
  import { MaturityBadge, soonDependencySentence } from "@magna-carta/design-system/maturity";
  import * as Alert from "@magna-carta/design-system/alert";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import { billHref } from "$lib/money/index.ts";
  import MatterPicker from "$lib/time/matter-picker.svelte";
  import type { SheetMatter } from "$lib/time/time-sheet-model.ts";
  import {
    GONE_RECORDER_NOTE,
    recorderState,
    recorderText,
    returnedDraftReason,
  } from "$lib/records/work-in-progress-record.ts";
  import { FEE_LEDGER_GAPS, gapCellTitle, gapReason, REVIEW_GATE_ENABLED } from "./fee-gaps.ts";
  import { feeEntrySheet } from "./fee-print-sheet.ts";
  import { todayInUtc } from "@magna-carta/civil-time/civil-date";
  import { createFee, patchFee, writeKey } from "./fee-operations.ts";
  import { printSheetDates } from "$lib/print-sheet";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import {
    billingSentence,
    feeDraftRefusal,
    feeStatusKey,
    parseAmountMinor,
    type FeeRecord,
  } from "./fee-record.ts";

  let {
    open = $bindable(false),
    fee = null,
    editing = $bindable(false),
    matterId,
    matterTitle,
    matterNumber = null,
    matters = [],
    mattersCapped = false,
    currency,
    canWorkDraft,
    onSaved,
  }: {
    open?: boolean;
    /** The fee being read, or null while a new one is being written. */
    fee?: FeeRecord | null;
    /**
     * Whether the record's fields are open for change. The window owns this — its Edit control
     * raises it and its abandon lowers it — and it is bound here so the ledger can open a fee
     * straight into its fields.
     */
    editing?: boolean;
    /** The matter a NEW fee is written against, where the surface stands on one. */
    matterId: string;
    matterTitle: string;
    matterNumber?: string | null;
    /**
     * The firm's matters, for a NEW fee written from a surface that stands on none.
     *
     * Empty is the matter ledger's case and the default: the matter is already decided, the field
     * is absent, and `matterId` above is what a new fee is written against. Non-empty is the firm's
     * own period screen, where the reader picks the matter per fee — the same arrangement the cost
     * window and the Time Sheet have, and for the same reason: a charge with no matter has nobody
     * to bill it to, so the choice is made at capture rather than left for somebody to file later.
     */
    matters?: readonly SheetMatter[];
    /** Whether the list above is a page of the record rather than all of it. */
    mattersCapped?: boolean;
    currency: string;
    /** Whether this account may work this draft, and why not when it may not. */
    canWorkDraft: (fee: FeeRecord) => { allowed: boolean; reason: string };
    /** A write landed. The consumer re-reads the matter's fees. */
    onSaved: () => void;
  } = $props();

  const creating = $derived(fee === null);
  const fieldPrefix = $props.id();

  /*
   * Which matter a NEW fee is written against.
   *
   * On a surface standing in a matter it is that matter and the picker is absent. On one standing
   * in none it starts unchosen: a fee pre-filled with whichever matter happened to be first would
   * be a wrong answer arriving faster than no answer, and a charge lands on the wrong client's bill
   * exactly once before somebody stops trusting the ledger.
   */
  const picksItsMatter = $derived(matters.length > 0);
  let chosenMatterId = $state<string | null>(null);
  const writingAgainst = $derived(picksItsMatter ? chosenMatterId : matterId);
  const chosenMatterTitle = $derived(
    matters.find((candidate) => candidate.id === chosenMatterId)?.title ?? null,
  );

  let serviceDateText = $state("");
  let amountText = $state("");
  let descriptionText = $state("");
  let memoText = $state("");
  let billingChoice = $state("billable");
  let printOpen = $state(false);
  let saving = $state(false);
  let saveFailure = $state<string | null>(null);

  /*
   * What the fields held when they were last seeded. Keeping it is what lets this window answer
   * honestly whether walking away would lose anything, and it is what abandoning puts back.
   */
  const seeded = $state({
    serviceDate: "",
    amount: "",
    description: "",
    memo: "",
    billing: "billable",
  });

  function rememberWhatIsInTheFields(): void {
    seeded.serviceDate = serviceDateText;
    seeded.amount = amountText;
    seeded.description = descriptionText;
    seeded.memo = memoText;
    seeded.billing = billingChoice;
  }

  /*
   * The fields are re-seeded from the record whenever the window opens on a different fee, and
   * never while it is being edited: a re-seed mid-edit would silently discard what somebody typed.
   */
  let seededFor = $state<string | null>(null);
  $effect(() => {
    const identity = fee === null ? "new" : fee.id;
    if (!open) {
      seededFor = null;
      return;
    }
    if (seededFor === identity) return;
    seededFor = identity;
    serviceDateText = fee?.serviceDate ?? todayInUtc();
    amountText = fee === null ? "" : (fee.amountMinor / 100).toFixed(2);
    descriptionText = fee?.description ?? "";
    memoText = fee?.memo ?? "";
    billingChoice = fee === null || fee.billable ? "billable" : "nonbillable";
    rememberWhatIsInTheFields();
  });

  const unsavedChanges = $derived(
    serviceDateText !== seeded.serviceDate ||
      amountText !== seeded.amount ||
      descriptionText !== seeded.description ||
      memoText !== seeded.memo ||
      billingChoice !== seeded.billing,
  );

  function forgetChanges(): void {
    serviceDateText = seeded.serviceDate;
    amountText = seeded.amount;
    descriptionText = seeded.description;
    memoText = seeded.memo;
    billingChoice = seeded.billing;
    if (fee === null) open = false;
  }

  const BILLING_CHOICES = [
    { value: "billable", label: "Billable, next bill" },
    { value: "nonbillable", label: "Non-billable" },
  ] as const;

  const billable = $derived(billingChoice === "billable");
  const billingChoiceLabel = $derived(
    BILLING_CHOICES.find((choice) => choice.value === billingChoice)?.label ?? "",
  );
  const amountMinor = $derived(parseAmountMinor(amountText));

  /** What the charge will be recorded as, once the field reads as an amount at all. */
  const recordedAs = $derived(
    amountMinor === null ? "—" : formatMoney(amountMinor / 100, { currency }),
  );

  const refusal = $derived(
    editing
      ? // The matter leads the refusals for a new fee on a matterless surface: it is the one field
        // whose absence makes the record meaningless rather than merely incomplete.
        (creating && picksItsMatter && writingAgainst === null
          ? "Name the matter this fee charges."
          : feeDraftRefusal({ amountText, description: descriptionText }))
      : null,
  );

  /** Why the change cannot be committed as it stands. A save in flight is one of those reasons. */
  const saveRefusal = $derived(saving ? "Saving this fee." : (refusal ?? undefined));

  /*
   * The write. A new fee is a capture; an open one is a patch of exactly the fields this window
   * offers. The memo is not among them: it is on the record and on the contract, and the field is
   * still waiting on the read that would show a reader what they were about to overwrite.
   */
  async function save(): Promise<void> {
    if (refusal !== null || saving) return;
    const minor = parseAmountMinor(amountText);
    if (minor === null) return;
    saving = true;
    saveFailure = null;
    const outcome =
      fee === null
        ? await createFee(
            fetch,
            {
              matterId: writingAgainst ?? matterId,
              serviceDate: serviceDateText,
              timekeeperUserId: null,
              description: descriptionText.trim(),
              amountMinor: minor,
              currency,
              billable,
              memo: null,
            },
            writeKey(),
          )
        : await patchFee(
            fetch,
            fee.id,
            {
              serviceDate: serviceDateText,
              description: descriptionText.trim(),
              amountMinor: minor,
              billable,
            },
            writeKey(),
          );
    saving = false;
    if (outcome.kind !== "ok") {
      saveFailure =
        outcome.kind === "problem"
          ? `The fee was not saved. The server answered ${String(outcome.problem.status)}.${
              outcome.problem.detail === undefined ? "" : ` ${outcome.problem.detail}`
            }`
          : "Couldn't connect. The fee wasn't saved.";
      return;
    }
    onSaved();
    editing = false;
    open = false;
  }

  const heading = $derived(creating ? "New Fee" : editing ? "Edit Fee" : "Fee");

  /* The lock the record is under, in the chain's own words. */
  const lockLine = $derived.by((): string | null => {
    if (fee === null) return null;
    if (fee.status === "draft") {
      const verdict = canWorkDraft(fee);
      return verdict.allowed ? null : verdict.reason;
    }
    return statusEntry(feeStatusKey(fee.status)).meaning;
  });

  const editRefusal = $derived.by((): string | undefined => {
    if (fee === null) return "A new fee has no history yet.";
    if (fee.status !== "draft") return statusEntry(feeStatusKey(fee.status)).meaning;
    const verdict = canWorkDraft(fee);
    return verdict.allowed ? undefined : verdict.reason;
  });

  const sheet = $derived(
    fee === null
      ? null
      : feeEntrySheet(fee, {
          matterTitle,
          matterNumber,
          money: (amount) => formatMoney(amount, { currency: fee.currency }),
          ...printSheetDates(),
          instant: (isoInstant) => formatInstant(isoInstant),
          printedAt: formatInstant(new Date()),
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
    fee === null && picksItsMatter
      ? { facts: [chosenMatterTitle ?? "No matter chosen yet"] }
      : {
          reference: { kind: "Matter", number: matterNumber },
          facts:
            fee === null
              ? [matterTitle]
              : [matterTitle, `${FEE_LEDGER_GAPS.entryNumber.field} not yet recorded`],
        },
  );

  const recorder = $derived(fee === null ? null : recorderState(fee));
</script>

{#snippet subtitle()}
  <!-- The matter this sits on, by its number. On a matterless surface the line follows the pick, so
       the window answers "which matter" as soon as it has been decided rather than standing empty
       above a filled form. -->
  <RecordSubjectLine subject={subjectLine} />
  {#if fee !== null}
    <Badge {...statusBadgeAttributes(feeStatusKey(fee.status))}>
      {statusEntry(feeStatusKey(fee.status)).label}
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

    {#if fee !== null && returnedDraftReason(fee) !== null}
      <Alert.Root variant="warning">
        <Alert.Title>Sent Back For Changes</Alert.Title>
        <Alert.Description>{returnedDraftReason(fee)}</Alert.Description>
      </Alert.Root>
    {/if}

    {#if creating && picksItsMatter}
      <!-- First, because a fee is a fact about a matter before it is a fact about an amount, and
           because the refusal that names it leads the others. -->
      <div class="flex flex-col gap-4">
        <Label for="{fieldPrefix}-pick-matter">Matter</Label>
        <MatterPicker
          {matters}
          value={chosenMatterId}
          inputId="{fieldPrefix}-pick-matter"
          disabled={readOnly}
          capped={mattersCapped}
          title="The matter this fee charges. A charge with no matter has nobody to bill it to."
          onpick={(picked) => (chosenMatterId = picked)}
        />
      </div>
    {/if}

    <!-- The description leads: it is the line the client reads, and it grows to fit. -->
    <div class="flex flex-col gap-4">
      <Label for="{fieldPrefix}-description">Description</Label>
      <Textarea
        id="{fieldPrefix}-description"
        rows={2}
        placeholder={placeholderOf("Description")}
        title="Description"
        disabled={readOnly}
        bind:value={descriptionText}
      />
      <p class="text-xs text-text-muted">What the charge is for, as the client will read it.</p>
    </div>

    <div class="grid gap-12 sm:grid-cols-3">
      <div class="flex flex-col gap-4">
        <DatePicker
          label="Date"
          value={civilDateValue(serviceDateText)}
          onValueChange={(next) => (serviceDateText = civilDateTextOrEmpty(next))}
          disabled={readOnly}
        />
      </div>

      <div class="flex flex-col gap-4">
        <Label for="{fieldPrefix}-matter">Matter</Label>
        <Input
          id="{fieldPrefix}-matter"
          value={matterTitle === ""
            ? "Not resolved"
            : matterNumber === null
              ? matterTitle
              : `${matterNumber} — ${matterTitle}`}
          title={gapCellTitle("matterMove")}
          disabled
        />
      </div>

      <div class="flex flex-col gap-4">
        <Label for="{fieldPrefix}-timekeeper">Timekeeper</Label>
        <Input
          id="{fieldPrefix}-timekeeper"
          value={fee?.timekeeperName ?? "Not recorded"}
          title="Whose professional services the charge is for. A former member's name stays on the record forever."
          disabled
        />
      </div>
    </div>

    <div class="grid gap-12 sm:grid-cols-3">
      <div class="flex flex-col gap-4">
        <Label for="{fieldPrefix}-amount">Amount</Label>
        <Input
          id="{fieldPrefix}-amount"
          placeholder={placeholderOf("Amount")}
          title="The flat charge, typed exactly. A fee is recorded, never computed from hours."
          disabled={readOnly}
          bind:value={amountText}
        />
      </div>

      <div class="flex flex-col gap-4">
        <span class="text-xs text-text-subtle">Recorded As</span>
        <span class="pb-8 tabular-nums">{recordedAs}</span>
      </div>

      <div class="flex flex-col gap-4">
        <Label for="{fieldPrefix}-billing">Billing</Label>
        {#if readOnly}
          <Input id="{fieldPrefix}-billing" value={billingSentence(billable)} disabled />
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
              title="Whether the client may be asked for this charge. Recording it non-billable keeps it on the file and off every bill."
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

    <!-- Internal, not hidden: it shows on a read-only record too, and never reaches the paper. -->
    <div class="flex flex-col gap-4">
      <Label for="{fieldPrefix}-memo">Internal Memo</Label>
      <Textarea
        id="{fieldPrefix}-memo"
        rows={2}
        placeholder={placeholderOf("Internal Memo")}
        title={gapCellTitle("memo")}
        disabled
        bind:value={memoText}
      />
      <p class="flex items-center gap-8 text-xs text-text-muted">
        For the firm only. It never appears on a bill or a printed sheet.
        <MaturityBadge stage="soon" />
      </p>
      <p class="text-xs text-text-muted">{soonDependencySentence(gapReason("memo"))}</p>
    </div>

    <!--
      WHEN AND BY WHOM, under the fields rather than in them. It is not editable and never was: it
      is what the record says about its own capture, and it is here because a reader checking a
      figure that looks wrong wants to know who to ask before they want anything else.
    -->
    {#if fee !== null}
      <p class="text-xs text-text-muted">
        Recorded {formatInstant(fee.createdAt)} by <span
          title={recorder?.kind === "gone" ? GONE_RECORDER_NOTE : undefined}
          >{recorderText(fee)}</span
        >.
      </p>
    {/if}
  </div>
{/snippet}

{#snippet attachmentsTab()}
  <RecordAttachments
    attachments={[]}
    canEdit={false}
    attachDisabledReason={soonDependencySentence(gapReason("attachmentPicker"))}
  />
{/snippet}

{#snippet historyTab()}
  <EventRail
    events={[]}
    label="This fee's history"
    emptyMessage="Not built yet: {gapReason('history')}."
  />
{/snippet}

{#snippet billingTab()}
  <div class="flex flex-col gap-16">
    {#if fee === null}
      <p class="flex items-start gap-8 text-sm text-text-muted">
        <Info class="mt-4 size-16 shrink-0" aria-hidden="true" />
        <span>Not on a bill yet. Add it to a draft bill from the Billing tab.</span>
      </p>
    {:else}
      <div>
        <Badge {...statusBadgeAttributes(feeStatusKey(fee.status))}>
          {statusEntry(feeStatusKey(fee.status)).label}
        </Badge>
      </div>
      {#if fee.status !== "void"}
        <RecordChain current={fee.status} reviewGate={REVIEW_GATE_ENABLED} />
      {/if}
      <p class="flex items-start gap-8 text-sm text-text-muted">
        <Info class="mt-4 size-16 shrink-0" aria-hidden="true" />
        <span>
          {#if fee.status === "billed"}
            {#if fee.invoiceId === null}
              Billed. The bill isn't linked to this fee.
            {:else}
              Billed. <a class="underline underline-offset-2" href={billHref(fee.matterId, fee.invoiceId)}
                >Open the bill this fee is on</a
              >. To correct a finalized bill, add a credit note.
            {/if}
          {:else if fee.status === "void"}
            Withdrawn. A void fee stays on the record and counts toward nothing.
          {:else}
            Not on a bill yet. Add it to a draft bill from the Billing tab, where it prints as its own line.
          {/if}
        </span>
      </p>
      <dl class="flex flex-col gap-4 text-sm">
        <div class="flex items-baseline justify-between gap-16">
          <dt class="text-text-muted">Billing</dt>
          <dd>{billingSentence(fee.billable)}</dd>
        </div>
        <div class="flex items-baseline justify-between gap-16">
          <dt class="text-text-muted">Date</dt>
          <dd class="tabular-nums">{formatDate(fee.serviceDate)}</dd>
        </div>
      </dl>
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
    <Button onclick={() => (open = false)}>Close</Button>
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
  {unsavedChanges}
  onSave={() => void save()}
  onCancel={forgetChanges}
  onPrint={() => (printOpen = true)}
/>

{#if sheet !== null}
  <PrintSheet bind:open={printOpen} {sheet} />
{/if}
