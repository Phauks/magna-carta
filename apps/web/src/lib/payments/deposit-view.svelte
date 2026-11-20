<script lang="ts">
  /*
   * A recorded deposit, read back on its own page: where it went and when, every line with its
   * matter and bill, the bank fees, the totals, and the notes and files kept with it.
   *
   * A RECORDED DEPOSIT IS NOT EDITED. Its lines are in the books; a payment recorded in error is
   * reversed from its bill, and the line here stays, marked Reversed, because the deposit happened.
   * What can still be added is a note or a file, on the deposit or on one of its lines.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Dropzone from "@magna-carta/design-system/dropzone";
  import { formatDate, formatInstant } from "@magna-carta/design-system/formatters";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import FileText from "@lucide/svelte/icons/file-text";
  import Plus from "@lucide/svelte/icons/plus";
  import type { BillingDepositDetail } from "@magna-carta/api-client";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { WriteIntent } from "$lib/api/write-intent.ts";
  import { formatByteSize } from "$lib/firm-usage/firm-usage-format.ts";
  import { moneyText as money } from "$lib/payments/deposit-money.ts";
  import BankMark from "./bank-mark.svelte";
  import FilePreview from "./file-preview.svelte";
  import { FILE_TYPES, MAXIMUM_FILE_BYTES, billLabel, matterLabel } from "./deposit-form.svelte.ts";
  import { depositFileAddress, fileAsBase64, type DepositService } from "./deposit-service.ts";
  import { methodEntry } from "./payment-methods.ts";

  let {
    deposit,
    bankName = null,
    logo = null,
    service,
    unsent = [],
    canWrite = true,
    onChanged,
  }: {
    deposit: BillingDepositDetail;
    bankName?: string | null;
    logo?: string | null;
    service: DepositService;
    /** Files the Record step could not attach, named so they can be added here. */
    unsent?: readonly string[];
    canWrite?: boolean;
    onChanged: () => void;
  } = $props();

  const DEPOSIT_WIDE = "";
  let attachTo = $state(DEPOSIT_WIDE);
  let noteOn = $state(DEPOSIT_WIDE);
  let noteText = $state("");
  let noteOpen = $state(false);
  let busy = $state(false);
  let failure = $state<StatedFailure | null>(null);
  let fileRefusal = $state<string | null>(null);
  let shownFile = $state<string | null>(null);
  const noteIntent = new WriteIntent();

  const lineByReceipt = $derived(new Map(deposit.lines.map((line) => [line.receiptId, line])));
  const whereOptions = $derived([
    { value: DEPOSIT_WIDE, label: "The whole deposit" },
    ...deposit.lines.map((line) => ({
      value: line.receiptId,
      label: `Line ${line.lineNumber}`,
      aside: `${matterLabel(line)}, ${money(line.amountMinor)}`,
    })),
  ]);
  const previews = $derived(
    deposit.files.map((file) => ({
      key: file.id,
      name: file.name,
      url: depositFileAddress(deposit.id, file.id),
      contentType: file.contentType,
    })),
  );

  function where(receiptId: string | null): string {
    if (receiptId === null) return "The whole deposit";
    const line = lineByReceipt.get(receiptId);
    return line === undefined ? "A line" : `Line ${line.lineNumber}`;
  }

  /** A line's details as one quiet sentence: "Bank: Wells Fargo · Account Ending In: 6621". */
  function detailText(line: BillingDepositDetail["lines"][number]): string {
    const fields = methodEntry(line.method).details;
    const parts = fields
      .filter((field) => typeof line.details[field.key] === "string")
      .map((field) => {
        const value = String(line.details[field.key]);
        return `${field.label}: ${field.shape.kind === "date" ? formatDate(value) : value}`;
      });
    if (typeof line.details["cashCount"] === "object") parts.push("Counted by bill and coin");
    if (line.memo !== null) parts.push(`Memo: ${line.memo}`);
    return parts.join(" · ");
  }

  async function attach(files: File[]): Promise<void> {
    const admitted = files.filter(
      (file) => ["application/pdf", "image/png", "image/jpeg"].includes(file.type) && file.size <= MAXIMUM_FILE_BYTES,
    );
    fileRefusal =
      admitted.length === files.length ? null : "Scans and files must be PDF, PNG or JPEG, up to 25 MB.";
    if (admitted.length === 0) return;
    busy = true;
    failure = null;
    try {
      for (const file of admitted) {
        const outcome = await service.attachFile(
          deposit.id,
          {
            receiptId: attachTo === DEPOSIT_WIDE ? null : attachTo,
            kind: attachTo === DEPOSIT_WIDE ? "file" : "scan",
            name: file.name,
            dataBase64: await fileAsBase64(file),
          },
          crypto.randomUUID(),
        );
        if (outcome.kind !== "ok") {
          failure = stated(outcome.failure, `${file.name} was not attached.`);
          break;
        }
      }
      onChanged();
    } finally {
      busy = false;
    }
  }

  async function saveNote(): Promise<void> {
    if (noteText.trim() === "") return;
    busy = true;
    failure = null;
    try {
      const { value: outcome } = await noteIntent.submit((key) =>
        service.addNote(deposit.id, { receiptId: noteOn === DEPOSIT_WIDE ? null : noteOn, body: noteText.trim() }, key),
      );
      if (outcome.kind !== "ok") {
        failure = stated(outcome.failure, "The note was not saved.");
        return;
      }
      noteText = "";
      noteOpen = false;
      onChanged();
    } finally {
      busy = false;
    }
  }
</script>

<div class="@container flex flex-col gap-24">
  {#if unsent.length > 0}
    <p class="rounded-md border border-status-warning bg-status-warning-subtle px-12 py-8 text-sm text-status-warning-subtle-foreground" role="status">
      The deposit is recorded, but {unsent.length === 1 ? "this file was" : "these files were"} not attached:
      {unsent.join(", ")}. Add {unsent.length === 1 ? "it" : "them"} under Files.
    </p>
  {/if}
  {#if failure !== null}
    <FailureNotice failure={failure.failure} title="Not Saved" fallback={failure.fallback} />
  {/if}

  <dl class="grid gap-x-24 gap-y-12 text-sm @lg:grid-cols-2 @3xl:grid-cols-4">
    <div class="flex flex-col gap-4">
      <dt class="text-text-muted">Deposit To</dt>
      <dd class="flex items-center gap-8">
        <BankMark name={bankName ?? deposit.depositToName} {logo} size="sm" />{deposit.depositToName}
      </dd>
    </div>
    <div class="flex flex-col gap-4">
      <dt class="text-text-muted">Date Deposited</dt>
      <dd>{formatDate(deposit.depositedOn)}</dd>
    </div>
    {#if deposit.slipNumber !== null}
      <div class="flex flex-col gap-4">
        <dt class="text-text-muted">Deposit Slip No.</dt>
        <dd>{deposit.slipNumber}</dd>
      </div>
    {/if}
    <div class="flex flex-col gap-4">
      <dt class="text-text-muted">Recorded</dt>
      <dd>{formatInstant(deposit.recordedAt)}</dd>
    </div>
  </dl>

  <section class="flex flex-col gap-12" aria-labelledby="deposit-lines">
    <FieldLabel as="h2" id="deposit-lines">Lines</FieldLabel>
    <div class="overflow-hidden rounded-md border border-border-default">
      <DataTable.Root>
        <DataTable.Header>
          <DataTable.Row>
            <DataTable.Head>#</DataTable.Head>
            <DataTable.Head>Payment</DataTable.Head>
            <DataTable.Head class="hidden @3xl:table-cell">Method</DataTable.Head>
            <DataTable.Head class="hidden @3xl:table-cell">Received</DataTable.Head>
            <DataTable.Head class="text-end">Amount</DataTable.Head>
          </DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          {#each deposit.lines as line (line.receiptId)}
            <DataTable.Row>
              <DataTable.Cell class="tabular-nums text-text-muted">{line.lineNumber}</DataTable.Cell>
              <DataTable.Cell>
                <span class="block">{matterLabel(line)}</span>
                <span class="block text-xs text-text-muted">Bill {billLabel(line)}</span>
                <span class="block text-xs text-text-muted @3xl:hidden">
                  {methodEntry(line.method).label}{line.reference === null ? "" : ` ${line.reference}`} · {line.receivedFrom} · {formatDate(line.receivedOn)}
                </span>
                {#if detailText(line) !== ""}
                  <span class="block text-xs text-text-muted">{detailText(line)}</span>
                {/if}
                {#if line.reversed}
                  <Badge variant="secondary" class="mt-4">Reversed</Badge>
                {/if}
              </DataTable.Cell>
              <DataTable.Cell class="hidden @3xl:table-cell">
                {methodEntry(line.method).label}
                {#if line.reference !== null}
                  <span class="block text-xs text-text-muted">{methodEntry(line.method).reference} {line.reference}</span>
                {/if}
              </DataTable.Cell>
              <DataTable.Cell class="hidden @3xl:table-cell">
                {line.receivedFrom}
                <span class="block text-xs text-text-muted">{formatDate(line.receivedOn)}</span>
              </DataTable.Cell>
              <DataTable.Cell class="text-end tabular-nums {line.reversed ? 'text-text-muted line-through' : ''}">
                {money(line.amountMinor)}
              </DataTable.Cell>
            </DataTable.Row>
          {/each}
          {#each deposit.fees as fee (fee.lineNumber)}
            <DataTable.Row>
              <DataTable.Cell class="text-text-muted">Fee</DataTable.Cell>
              <DataTable.Cell>{fee.description}</DataTable.Cell>
              <DataTable.Cell class="hidden @3xl:table-cell"></DataTable.Cell>
              <DataTable.Cell class="hidden @3xl:table-cell"></DataTable.Cell>
              <DataTable.Cell class="text-end tabular-nums">-{money(fee.amountMinor)}</DataTable.Cell>
            </DataTable.Row>
          {/each}
        </DataTable.Body>
      </DataTable.Root>
      <dl class="grid grid-cols-2 gap-x-24 gap-y-4 border-t border-border-strong px-12 py-12 text-sm @lg:ms-auto @lg:w-sm">
        <dt class="text-text-muted">Payments</dt>
        <dd class="text-end tabular-nums">{money(deposit.paymentsMinor)}</dd>
        {#if deposit.fees.length > 0}
          <dt class="text-text-muted">Bank Fees</dt>
          <dd class="text-end tabular-nums">-{money(deposit.feesMinor)}</dd>
        {/if}
        <dt class="font-semibold">Deposit Total</dt>
        <dd class="border-b-4 border-double border-text-default text-end font-semibold tabular-nums">
          {money(deposit.depositMinor)}
        </dd>
      </dl>
    </div>
  </section>

  <section class="flex flex-col gap-12" aria-labelledby="deposit-files">
    <FieldLabel as="h2" id="deposit-files">Files</FieldLabel>
    {#if deposit.files.length > 0}
      <ul class="flex flex-col gap-4">
        {#each deposit.files as file (file.id)}
          <li class="flex flex-wrap items-center gap-8 rounded-md border border-border-default bg-surface-raised px-8 py-4">
            <FileText class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
            <button
              type="button"
              class="min-w-0 flex-1 truncate text-start text-sm text-text-link underline underline-offset-2"
              onclick={() => (shownFile = shownFile === file.id ? null : file.id)}
            >
              {file.name}
            </button>
            <span class="text-xs text-text-muted">{where(file.receiptId)}</span>
            <span class="text-xs text-text-muted tabular-nums">{formatByteSize(file.sizeBytes)}</span>
          </li>
        {/each}
      </ul>
    {/if}
    {#if shownFile !== null}
      <FilePreview files={previews} shownKey={shownFile} onShow={(key) => (shownFile = key)} onClose={() => (shownFile = null)} />
    {/if}
    {#if canWrite}
      <div class="grid gap-8 @2xl:grid-cols-3">
        <div class="flex flex-col gap-4">
          <Label for="deposit-attach-to">Attach To</Label>
          <ChoicePicker inputId="deposit-attach-to" label="Attach To" options={whereOptions} bind:value={attachTo} disabled={busy} />
        </div>
        <Dropzone
          class="flex-row flex-wrap gap-8 px-12 py-8 text-start @2xl:col-span-2"
          label="Attach a scan or file"
          prompt="Drop a scan, a confirmation or a receipt here, or choose a file"
          accept={FILE_TYPES}
          multiple
          disabled={busy}
          invalid={fileRefusal !== null}
          title={fileRefusal ?? undefined}
          onFiles={(files) => void attach(files)}
        />
      </div>
    {/if}
  </section>

  <section class="flex flex-col gap-12" aria-labelledby="deposit-notes">
    <FieldLabel as="h2" id="deposit-notes">Notes</FieldLabel>
    {#each deposit.notes as note (note.id)}
      <article class="flex flex-col gap-4 rounded-md border border-border-default px-12 py-8">
        <p class="text-xs text-text-muted">{where(note.receiptId)} · {formatInstant(note.writtenAt)}</p>
        <p class="text-sm whitespace-pre-wrap">{note.body}</p>
      </article>
    {/each}
    {#if canWrite}
      {#if noteOpen}
        <div class="grid gap-8 @2xl:grid-cols-3">
          <div class="flex flex-col gap-4">
            <Label for="deposit-note-on">Note On</Label>
            <ChoicePicker inputId="deposit-note-on" label="Note On" options={whereOptions} bind:value={noteOn} disabled={busy} />
          </div>
          <div class="flex flex-col gap-4 @2xl:col-span-2">
            <Label for="deposit-note" necessity="required">Note</Label>
            <Textarea id="deposit-note" bind:value={noteText} maxlength={4000} rows={3} disabled={busy} />
          </div>
        </div>
        <div class="flex justify-end gap-8">
          <Button variant="secondary" size="sm" disabled={busy} onclick={() => (noteOpen = false)}>Cancel</Button>
          <Button variant="primary" size="sm" disabled={busy || noteText.trim() === ""} onclick={() => void saveNote()}>
            Save Note
          </Button>
        </div>
      {:else}
        <Button variant="secondary" size="sm" class="self-start" onclick={() => (noteOpen = true)}>
          <Plus class="size-16" aria-hidden="true" />Add Note
        </Button>
      {/if}
    {/if}
  </section>
</div>
