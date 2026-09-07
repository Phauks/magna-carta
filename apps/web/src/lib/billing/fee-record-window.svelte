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
   * EACH FACT HAS ONE HOME. The entry number is the subtitle and nowhere else; the entered date and
   * the person who entered it are the History tab's first event, which is where a reader goes for
   * when-and-by-whom. Repeating any of them in the record pane makes a reader check whether the two
   * agree.
   *
   * NOTHING HERE SAVES YET. No route writes a fee record (fee-gaps.ts), so the commit renders where
   * the design puts it, refused, with its Soon mark and one line naming what it waits on. The
   * fields, their validation and their words are real: what is missing is the store behind them.
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
  import Textarea from "@magna-carta/design-system/textarea";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { formatInstant, placeholderOf } from "@magna-carta/design-system/formatters";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import Info from "@lucide/svelte/icons/info";
  import Lock from "@lucide/svelte/icons/lock";
  import { MaturityBadge, soonDependencySentence } from "@magna-carta/design-system/maturity";
  import { gapCellTitle, gapReason, REVIEW_GATE_ENABLED } from "./fee-gaps.ts";
  import { feeEntrySheet } from "./fee-print-sheet.ts";
  import {
    billingSentence,
    feeDraftRefusal,
    feeStatusKey,
    incompleteNote,
    parseAmountMinor,
    type FeeRecord,
  } from "./fee-record.ts";

  let {
    open = $bindable(false),
    fee = null,
    editing = $bindable(false),
    matterTitle,
    matterNumber = null,
    currency,
    canWorkDraft,
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
    matterTitle: string;
    matterNumber?: string | null;
    currency: string;
    /** Whether this account may work this draft, and why not when it may not. */
    canWorkDraft: (fee: FeeRecord) => { allowed: boolean; reason: string };
  } = $props();

  const creating = $derived(fee === null);
  const fieldPrefix = $props.id();

  let serviceDateText = $state("");
  let amountText = $state("");
  let descriptionText = $state("");
  let memoText = $state("");
  let billingChoice = $state("billable");
  let printOpen = $state(false);

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
    serviceDateText = fee?.serviceDate ?? new Date().toISOString().slice(0, 10);
    amountText = fee === null || fee.amountMinor === null ? "" : (fee.amountMinor / 100).toFixed(2);
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
    { value: "billable", label: "Billable, next invoice" },
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
    editing ? feeDraftRefusal({ amountText, description: descriptionText }) : null,
  );

  /*
   * Why the change cannot be committed. The field-level refusal leads where there is one, because
   * it is the thing the reader can act on; the missing store is what stands behind a form that is
   * otherwise complete.
   */
  const saveRefusal = $derived(refusal ?? soonDependencySentence(gapReason("store")));

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
    if (fee === null) return "A new fee is written in its fields; there is nothing to read yet.";
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
          date: (isoDate) => formatDate(isoDate),
          printedAt: formatInstant(new Date()),
        }),
  );

  /* A fee that carries files opens on them: the attachment is in front, not one click away. */
  const openingTab = $derived((fee?.attachmentCount ?? 0) > 0 ? "attachments" : "billing");
</script>

{#snippet subtitle()}
  {#if fee === null}
    <span>{matterTitle}</span>
  {:else if fee.entryNumber === null}
    <span title={gapCellTitle("entryNumber")}>Entry Number not yet recorded</span>
    <Badge {...statusBadgeAttributes(feeStatusKey(fee.status))}>
      {statusEntry(feeStatusKey(fee.status)).label}
    </Badge>
  {:else}
    <span class="tabular-nums">{fee.entryNumber}</span>
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
    {#if fee !== null && fee.incomplete}
      <p class="flex items-start gap-8 text-sm text-status-warning-subtle-foreground">
        <Info class="mt-4 size-16 shrink-0" aria-hidden="true" />
        <span>{incompleteNote(fee)}</span>
      </p>
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
        <Label for="{fieldPrefix}-date">Date</Label>
        <Input id="{fieldPrefix}-date" type="date" disabled={readOnly} bind:value={serviceDateText} />
      </div>

      <div class="flex flex-col gap-4">
        <Label for="{fieldPrefix}-matter">Matter</Label>
        <Input
          id="{fieldPrefix}-matter"
          value={matterNumber === null ? matterTitle : `${matterNumber} — ${matterTitle}`}
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
    emptyMessage="Not built yet. Waiting on {gapReason('history')}. Entered as a draft, with the date
      and the person, is the first event this rail will carry."
  />
{/snippet}

{#snippet billingTab()}
  <div class="flex flex-col gap-16">
    {#if fee === null}
      <p class="flex items-start gap-8 text-sm text-text-muted">
        <Info class="mt-4 size-16 shrink-0" aria-hidden="true" />
        <span>Not on a bill yet. A draft invoice claims it from the Billing tab.</span>
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
            {#if fee.invoiceNumber === null}
              Billed. Which invoice took it up is not served yet: waiting on {gapReason("invoice")}.
            {:else}
              Billed on {fee.invoiceNumber}. A record on a finalized bill is evidence; the
              correction is a credit note beside it.
            {/if}
          {:else if fee.status === "void"}
            Withdrawn. A void fee stays on the record and counts toward nothing.
          {:else}
            Not on a bill yet. A draft invoice claims it from the Billing tab, exactly as it claims
            a cost, and it prints its own line on the bill.
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
      {#if fee.provenance !== null}
        <p class="text-xs text-text-muted">
          Moved here from the {fee.provenance.fromRecordName} ledger on
          <span class="tabular-nums">{formatDate(fee.provenance.movedOn)}</span>
          by {fee.provenance.movedByName}. It kept its entry number, so the number's shape records
          where it was first written down rather than what it is now.
        </p>
      {/if}
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
    <span class="mr-auto flex items-center gap-8 text-xs text-text-muted">
      <MaturityBadge stage="soon" />
      {soonDependencySentence(gapReason("store"))}
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
  defaultTab={openingTab}
  editDisabledReason={editRefusal}
  saveDisabledReason={saveRefusal}
  {unsavedChanges}
  onSave={() => undefined}
  onCancel={forgetChanges}
  onPrint={() => (printOpen = true)}
/>

{#if sheet !== null}
  <PrintSheet bind:open={printOpen} {sheet} />
{/if}
