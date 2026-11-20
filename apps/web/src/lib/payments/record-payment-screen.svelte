<script lang="ts">
  /*
   * Record a Payment: payments the firm received by hand, deposited together.
   *
   * One deposit, many lines (owner's rulings, 2026-11-19 and 2026-11-20). The deposit says where
   * the money went and when; each line is one payment with its own matter and bill, how it was
   * paid, who paid it and the date it was received. Bank fees taken out of the deposit are lines
   * below the payments, and the deposit total is worked out from the lines, never typed.
   *
   * THE BOOKS FOLLOW QUICKBOOKS' UNDEPOSITED FUNDS. Each line comes off the bill on its date
   * received; the deposit reaches the bank account on its date deposited, less its fees. The
   * screen does not say this in accounting words: it says what each bill still owes afterwards.
   *
   * FILES GO AFTER THE DEPOSIT. Each line's scans are sent once the deposit is recorded and the
   * line has its receipt; a file that does not go leaves the deposit recorded and is named.
   */
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import { DatePicker, civilDateTextOrEmpty, civilDateValue } from "@magna-carta/design-system/date-picker";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import Input from "@magna-carta/design-system/input";
  import Label, { necessityMark } from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import Info from "@lucide/svelte/icons/info";
  import Minus from "@lucide/svelte/icons/minus";
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import { tick, untrack } from "svelte";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { WriteIntent } from "$lib/api/write-intent.ts";
  import { moneyText as money } from "$lib/payments/deposit-money.ts";
  import BankMark from "./bank-mark.svelte";
  import DepositLineRow from "./deposit-line-row.svelte";
  import PendingFiles from "./pending-files.svelte";
  import { releaseObjectAddress } from "./object-addresses.ts";
  import { fileAsBase64, type DepositService } from "./deposit-service.ts";
  import {
    DepositForm,
    MAXIMUM_FEES,
    MAXIMUM_FILE_BYTES,
    MAXIMUM_LINES,
    fieldId,
    tidyAmount,
    type DepositAccount,
    type DepositLine,
    type OpenBill,
    type PendingFile,
  } from "./deposit-form.svelte.ts";

  let {
    accounts,
    bills,
    service,
    today,
    start,
    seed,
    onRecorded,
    onCancel,
  }: {
    accounts: readonly DepositAccount[];
    bills: readonly OpenBill[];
    service: DepositService;
    today: string;
    /** A bill to start the first line on, when the screen was opened from one. */
    start?: { invoiceId: string; matterId: string } | undefined;
    /** Fills the form before it is shown: the developer gallery's states, never the live page. */
    seed?: (form: DepositForm) => void;
    /** The deposit is recorded; `unsent` names any file that could not be attached. */
    onRecorded: (depositId: string, unsent: readonly string[]) => void;
    onCancel: () => void;
  } = $props();

  // The form is made once, from what the screen opened with: the default account, the bill it was
  // opened from, and the gallery's seed. The page makes the screen again if those change.
  const form = untrack(() => {
    const made = new DepositForm({
      bills: () => bills,
      today,
      depositToAccountId:
        accounts.find((account) => account.isDefault)?.ledgerAccountId ??
        (accounts.length === 1 ? accounts[0]?.ledgerAccountId : undefined),
    });
    const first = made.lines[0];
    if (start !== undefined && first !== undefined) {
      made.pickMatter(first, start.matterId);
      made.pickBill(first, start.invoiceId);
    }
    seed?.(made);
    return made;
  });

  let busy = $state(false);
  let progress = $state<string | null>(null);
  let failure = $state<StatedFailure | null>(null);
  let depositFileShown = $state<string | null>(null);
  let fileRefusal = $state<string | null>(null);
  const intent = new WriteIntent();

  const refusals = $derived(form.refusals);
  const refusal = (id: string): string | undefined => (form.attempted ? refusals.get(id) : undefined);

  const account = $derived(accounts.find((candidate) => candidate.ledgerAccountId === form.depositToAccountId));
  const accountOptions = $derived(
    accounts.map((candidate) => ({
      value: candidate.ledgerAccountId,
      label: candidate.name,
      aside: candidate.lastFour === null ? undefined : `ending ${candidate.lastFour}`,
      keywords: candidate.bankName === null ? [] : [candidate.bankName],
    })),
  );
  const accountByValue = $derived(new Map(accounts.map((candidate) => [candidate.ledgerAccountId, candidate])));

  const requiredMark = necessityMark("required");
  const COLUMNS: ReadonlyArray<{ label: string; width: string; required: boolean; end?: boolean }> = [
    { label: "Matter", width: "flex-3", required: true },
    { label: "Bill", width: "w-96 shrink-0", required: true },
    { label: "Method", width: "flex-2", required: true },
    { label: "Ref No.", width: "flex-2", required: false },
    { label: "Received From", width: "flex-2", required: true },
    { label: "Date Received", width: "flex-2", required: true },
    { label: "Scan", width: "w-40 shrink-0 text-center", required: false },
    { label: "Amount", width: "flex-2 text-end", required: true },
  ];

  function admit(files: File[]): File[] {
    const refused = files.filter(
      (file) => !["application/pdf", "image/png", "image/jpeg"].includes(file.type) || file.size > MAXIMUM_FILE_BYTES,
    );
    fileRefusal =
      refused.length === 0
        ? null
        : `${refused.map((file) => file.name).join(", ")} ${refused.length === 1 ? "was" : "were"} not added. Scans and files must be PDF, PNG or JPEG, up to 25 MB.`;
    return files.filter((file) => !refused.includes(file));
  }

  function addLineFiles(line: DepositLine, files: File[], kind: "scan" | "file"): void {
    const admitted = admit(files);
    line.files = [
      ...line.files,
      ...admitted.map((file): PendingFile => ({ key: crypto.randomUUID(), file, kind })),
    ];
  }

  function removeLineFile(line: DepositLine, key: string): void {
    const gone = line.files.find((pending) => pending.key === key);
    if (gone !== undefined) releaseObjectAddress(gone.file);
    line.files = line.files.filter((pending) => pending.key !== key);
  }

  async function focusLine(key: string): Promise<void> {
    await tick();
    document.getElementById(fieldId.line(key, "matter"))?.focus();
  }

  async function addLine(): Promise<void> {
    const line = form.addLine();
    if (line !== null) await focusLine(line.key);
  }

  async function addFee(): Promise<void> {
    const fee = form.addFee();
    if (fee === null) return;
    await tick();
    document.getElementById(fieldId.fee(fee.key, "description"))?.focus();
  }

  async function focusFirstRefusal(): Promise<void> {
    const [first] = refusals.keys();
    if (first === undefined) return;
    const line = form.lines.find((candidate) => first.startsWith(fieldId.line(candidate.key, "")));
    if (line !== undefined && first.includes("-detail-")) line.expanded = true;
    await tick();
    document.getElementById(first)?.focus();
  }

  async function record(): Promise<void> {
    form.attempted = true;
    failure = null;
    if (form.firstRefusal !== undefined) {
      await focusFirstRefusal();
      return;
    }
    busy = true;
    progress = "Recording";
    try {
      const request = form.toRequest();
      const { value: outcome } = await intent.submit((key) => service.record(request, key));
      if (outcome.kind !== "ok") {
        failure = stated(outcome.failure, "Nothing was recorded.");
        return;
      }
      const { depositId, receiptIds } = outcome.value;
      const uploads: Array<{ pending: PendingFile; receiptId: string | null }> = [
        ...form.lines.flatMap((line, index) =>
          line.files.map((pending) => ({ pending, receiptId: receiptIds[index] ?? null })),
        ),
        ...form.files.map((pending) => ({ pending, receiptId: null })),
      ];
      const unsent: string[] = [];
      for (const [index, upload] of uploads.entries()) {
        progress = `Attaching file ${index + 1} of ${uploads.length}`;
        const sent = await service.attachFile(
          depositId,
          {
            receiptId: upload.receiptId,
            kind: upload.pending.kind,
            name: upload.pending.file.name,
            dataBase64: await fileAsBase64(upload.pending.file),
          },
          `${depositId}:${upload.pending.key}`,
        );
        if (sent.kind !== "ok") unsent.push(upload.pending.file.name);
      }
      onRecorded(depositId, unsent);
    } finally {
      busy = false;
      progress = null;
    }
  }
</script>

<div class="@container flex flex-col gap-24">
  <p class="flex items-start gap-8 text-sm text-text-muted">
    <Info class="mt-4 size-16 shrink-0" aria-hidden="true" />
    <span>
      For money going into an operating account. Money to hold in trust is a trust deposit; apply it to a bill afterwards with Apply Trust Funds.
    </span>
  </p>

  {#if failure !== null}
    <FailureNotice failure={failure.failure} title="Nothing Was Recorded" fallback={failure.fallback} />
  {/if}

  <section class="flex flex-col gap-12" aria-labelledby="record-payment-deposit">
    <FieldLabel as="h2" id="record-payment-deposit">Deposit</FieldLabel>
    <div class="grid gap-12 @2xl:grid-cols-3">
      <div class="flex min-w-0 flex-col gap-4" title={refusal(fieldId.depositTo)}>
        <Label for={fieldId.depositTo} necessity="required">Deposit To</Label>
        <div class="flex items-center gap-8">
          {#if account !== undefined}
            <BankMark name={account.bankName ?? account.name} logo={account.logo} />
          {/if}
          <div class="min-w-0 flex-1">
            <ChoicePicker
              inputId={fieldId.depositTo}
              label="Deposit To"
              options={accountOptions}
              bind:value={form.depositToAccountId}
              invalid={refusal(fieldId.depositTo) !== undefined}
              title={refusal(fieldId.depositTo)}
              disabled={busy}
              whenNoMatch={() => "No open bank account matches. Add one under Accounts."}
            >
              {#snippet row(option)}
                {@const candidate = accountByValue.get(option.value)}
                <span class="flex items-center gap-8">
                  <BankMark name={candidate?.bankName ?? option.label} logo={candidate?.logo ?? null} size="sm" />
                  <span>{option.label}</span>
                  {#if option.aside !== undefined}<span class="text-xs text-text-muted">{option.aside}</span>{/if}
                </span>
              {/snippet}
            </ChoicePicker>
          </div>
        </div>
      </div>
      <div class="flex min-w-0 flex-col gap-4" title={refusal(fieldId.depositedOn)}>
        <Label for={fieldId.depositedOn} necessity="required">Date Deposited</Label>
        <div class="grid">
          <DatePicker
            id={fieldId.depositedOn}
            aria-label="Date Deposited"
            value={civilDateValue(form.depositedOn)}
            onValueChange={(next) => (form.depositedOn = civilDateTextOrEmpty(next))}
            aria-invalid={refusal(fieldId.depositedOn) !== undefined}
            disabled={busy}
          />
        </div>
      </div>
      {#if form.slipShown || form.slipNumber !== ""}
        <div class="flex min-w-0 flex-col gap-4">
          <div class="flex items-center justify-between gap-4">
            <Label for={fieldId.slip}>Deposit Slip No.</Label>
            <Button
              variant="ghost"
              size="icon-sm"
              class="-my-4"
              aria-label="Remove Deposit Slip No."
              title="Remove"
              disabled={busy}
              onclick={() => {
                form.slipNumber = "";
                form.slipShown = false;
              }}
            >
              <X class="size-16" aria-hidden="true" />
            </Button>
          </div>
          <Input id={fieldId.slip} bind:value={form.slipNumber} maxlength={100} autocomplete="off" disabled={busy} />
        </div>
      {/if}
    </div>
    {#if !(form.slipShown || form.slipNumber !== "")}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class="{buttonClasses({ variant: 'secondary', size: 'sm' })} self-start" disabled={busy}>
          <Plus class="size-16" aria-hidden="true" />Add Detail
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start">
          <DropdownMenu.Item onSelect={() => (form.slipShown = true)}>Deposit Slip No.</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
  </section>

  <section class="flex flex-col gap-12" aria-labelledby="record-payment-lines">
    <FieldLabel as="h2" id="record-payment-lines">Lines</FieldLabel>
    <div class="overflow-hidden rounded-md border border-border-default bg-surface-default">
      <div
        class="hidden items-center gap-8 border-b border-border-default bg-surface-sunken px-8 py-8 @5xl:flex"
        aria-hidden="true"
      >
        <FieldLabel class="w-64 shrink-0 ps-32">#</FieldLabel>
        {#each COLUMNS as column (column.label)}
          <FieldLabel class="{column.width} min-w-0 truncate">
            {column.label}{#if column.required && requiredMark !== null}<span class="mc-label-necessity" data-necessity="required"
                >{requiredMark.text}</span
              >{/if}
          </FieldLabel>
        {/each}
        <span class="w-32 shrink-0"></span>
      </div>
      <ol>
        {#each form.lines as line, index (line.key)}
          <DepositLineRow
            {form}
            {line}
            {index}
            {refusal}
            disabled={busy}
            onAddFiles={addLineFiles}
            onRemoveFile={removeLineFile}
            onFocusLine={(key) => void focusLine(key)}
          />
        {/each}
      </ol>

      {#if form.fees.length > 0}
        <ul class="border-t border-border-default" aria-label="Bank fees">
          {#each form.fees as fee, index (fee.key)}
            <li class="grid grid-cols-2 items-start gap-8 px-12 py-8 @5xl:flex @5xl:px-8">
              <span class="col-span-2 text-sm text-text-muted @5xl:w-64 @5xl:shrink-0 @5xl:ps-32 @5xl:pt-8">Fee</span>
              <div class="col-span-2 flex min-w-0 flex-col gap-4 @5xl:flex-12" title={refusal(fieldId.fee(fee.key, "description"))}>
                <Label for={fieldId.fee(fee.key, "description")} necessity="required" class="@5xl:sr-only">Bank Fee</Label>
                <Input
                  id={fieldId.fee(fee.key, "description")}
                  bind:value={fee.description}
                  maxlength={200}
                  autocomplete="off"
                  disabled={busy}
                  aria-invalid={refusal(fieldId.fee(fee.key, "description")) !== undefined ? "true" : undefined}
                />
              </div>
              <span class="hidden w-40 shrink-0 @5xl:block" aria-hidden="true"></span>
              <div class="flex min-w-0 flex-col gap-4 @5xl:flex-2" title={refusal(fieldId.fee(fee.key, "amount"))}>
                <Label for={fieldId.fee(fee.key, "amount")} necessity="required" class="@5xl:sr-only">Fee Amount</Label>
                <Input
                  id={fieldId.fee(fee.key, "amount")}
                  bind:value={fee.amountText}
                  inputmode="decimal"
                  autocomplete="off"
                  class="text-end tabular-nums"
                  disabled={busy}
                  aria-invalid={refusal(fieldId.fee(fee.key, "amount")) !== undefined ? "true" : undefined}
                  onblur={() => (fee.amountText = tidyAmount(fee.amountText))}
                />
              </div>
              <div class="flex items-end justify-end @5xl:w-32 @5xl:shrink-0 @5xl:pt-4">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove bank fee {index + 1}"
                  title="Remove"
                  disabled={busy}
                  onclick={() => form.removeFee(fee.key)}
                >
                  <X class="size-16" aria-hidden="true" />
                </Button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="flex flex-wrap gap-8 border-t border-border-default px-8 py-8">
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || form.lines.length >= MAXIMUM_LINES}
          title={form.lines.length >= MAXIMUM_LINES ? `A deposit holds up to ${MAXIMUM_LINES} lines.` : undefined}
          onclick={() => void addLine()}
        >
          <Plus class="size-16" aria-hidden="true" />Add Line
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || form.fees.length >= MAXIMUM_FEES}
          onclick={() => void addFee()}
        >
          <Minus class="size-16" aria-hidden="true" />Add Bank Fee
        </Button>
      </div>

      <dl class="grid grid-cols-2 gap-x-24 gap-y-4 border-t border-border-strong px-12 py-12 text-sm @lg:ms-auto @lg:w-sm">
        <dt class="text-text-muted">Payments</dt>
        <dd class="text-end tabular-nums">{money(form.paymentsMinor)}</dd>
        {#if form.fees.length > 0}
          <dt class="text-text-muted">Bank Fees</dt>
          <dd class="text-end tabular-nums">{form.feesMinor > 0 ? "-" : ""}{money(form.feesMinor)}</dd>
        {/if}
        <dt class="font-semibold">Deposit Total</dt>
        <dd class="border-b-4 border-double border-text-default text-end font-semibold tabular-nums">
          {money(form.depositMinor)}
        </dd>
      </dl>
    </div>
    <p class="text-xs text-text-muted">
      {requiredMark?.text ?? ""} Required. Ref No. is required for every method except cash and other.
    </p>
    {#if fileRefusal !== null}
      <p class="text-sm text-status-danger" role="status">{fileRefusal}</p>
    {/if}
  </section>

  {#if form.billsPaid.length > 0}
    <section class="flex flex-col gap-12" aria-labelledby="record-payment-bills">
      <FieldLabel as="h2" id="record-payment-bills">Bills Paid</FieldLabel>
      <div class="overflow-hidden rounded-md border border-border-default">
        <DataTable.Root>
          <DataTable.Header>
            <DataTable.Row>
              <DataTable.Head>Matter</DataTable.Head>
              <DataTable.Head class="hidden @lg:table-cell">Bill</DataTable.Head>
              <DataTable.Head class="hidden text-end @2xl:table-cell">Owed</DataTable.Head>
              <DataTable.Head class="text-end">This Deposit</DataTable.Head>
              <DataTable.Head class="text-end">Left to Pay</DataTable.Head>
            </DataTable.Row>
          </DataTable.Header>
          <DataTable.Body>
            {#each form.billsPaid as bill (`${bill.invoiceId}:${bill.matterId}`)}
              <DataTable.Row>
                <DataTable.Cell>
                  {bill.matterLabel}
                  <span class="block text-xs text-text-muted @lg:hidden">Bill {bill.invoiceNumber ?? "Unnumbered"}</span>
                </DataTable.Cell>
                <DataTable.Cell class="hidden tabular-nums @lg:table-cell">{bill.invoiceNumber ?? "Unnumbered"}</DataTable.Cell>
                <DataTable.Cell class="hidden text-end tabular-nums @2xl:table-cell">{money(bill.owedMinor)}</DataTable.Cell>
                <DataTable.Cell class="text-end tabular-nums">{money(bill.thisDepositMinor)}</DataTable.Cell>
                <DataTable.Cell class="text-end tabular-nums {bill.leftMinor < 0 ? 'text-status-danger' : ''}">
                  {money(bill.leftMinor)}
                </DataTable.Cell>
              </DataTable.Row>
            {/each}
          </DataTable.Body>
        </DataTable.Root>
      </div>
    </section>
  {/if}

  <section class="flex flex-col gap-12" aria-labelledby="record-payment-more">
    <FieldLabel as="h2" id="record-payment-more">
      Notes and Files for the Whole Deposit
    </FieldLabel>
    <PendingFiles
      files={form.files}
      label="Files for the whole deposit"
      bind:shownKey={depositFileShown}
      disabled={busy}
      onAdd={(files) => {
        form.files = [...form.files, ...admit(files).map((file): PendingFile => ({ key: crypto.randomUUID(), file, kind: "file" }))];
      }}
      onRemove={(key) => {
        const gone = form.files.find((pending) => pending.key === key);
        if (gone !== undefined) releaseObjectAddress(gone.file);
        form.files = form.files.filter((pending) => pending.key !== key);
      }}
    />
    {#if form.noteShown || form.note !== ""}
      <div class="flex flex-col gap-4">
        <div class="flex items-center justify-between gap-4">
          <Label for="record-payment-note">Note</Label>
          <Button
            variant="ghost"
            size="icon-sm"
            class="-my-4"
            aria-label="Remove note"
            title="Remove"
            disabled={busy}
            onclick={() => {
              form.note = "";
              form.noteShown = false;
            }}
          >
            <X class="size-16" aria-hidden="true" />
          </Button>
        </div>
        <Textarea id="record-payment-note" bind:value={form.note} maxlength={4000} rows={3} disabled={busy} />
      </div>
    {:else}
      <Button variant="secondary" size="sm" class="self-start" disabled={busy} onclick={() => (form.noteShown = true)}>
        <Plus class="size-16" aria-hidden="true" />Add Note
      </Button>
    {/if}
  </section>

  <div class="flex flex-wrap items-center justify-end gap-8 border-t border-border-default pt-16">
    {#if progress !== null}
      <span class="me-auto text-sm text-text-muted" role="status">{progress}</span>
    {/if}
    <Button variant="secondary" disabled={busy} onclick={onCancel}>Cancel</Button>
    <Button
      variant="primary"
      disabled={busy}
      title={form.attempted ? form.firstRefusal : undefined}
      onclick={() => void record()}
    >
      {busy ? "Recording" : "Record Payment"}
    </Button>
  </div>
</div>
