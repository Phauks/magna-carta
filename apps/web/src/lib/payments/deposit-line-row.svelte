<script lang="ts">
  /*
   * One line of the deposit: a payment, its matter and bill, how it was paid and by whom.
   *
   * WIDE, a row of the register under its column heads; NARROW, the same fields stacked two to a
   * row with their names showing, so nothing scrolls sideways at any width. Opening the line (the
   * chevron) shows the method's details, the cash count, and the line's scans, notes and files.
   *
   * THE "..." MENU holds what is done TO the line (owner's ask, 2026-11-20: "add ... menu to each
   * line, for controls like duplicate"). It opens on click only, as every "..." does.
   */
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import { DatePicker, civilDateTextOrEmpty, civilDateValue } from "@magna-carta/design-system/date-picker";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import FileText from "@lucide/svelte/icons/file-text";
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import Plus from "@lucide/svelte/icons/plus";
  import ScanLine from "@lucide/svelte/icons/scan-line";
  import StickyNote from "@lucide/svelte/icons/sticky-note";
  import X from "@lucide/svelte/icons/x";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import { moneyText as money } from "$lib/payments/deposit-money.ts";
  import CashCount from "./cash-count.svelte";
  import DetailField from "./detail-field.svelte";
  import PendingFiles from "./pending-files.svelte";
  import { chooseFiles } from "./choose-files.ts";
  import { objectAddress } from "./object-addresses.ts";
  import {
    FILE_TYPES,
    amountText,
    billLabel,
    fieldId,
    matterLabel,
    tidyAmount,
    type DepositForm,
    type DepositLine,
  } from "./deposit-form.svelte.ts";
  import { PAYMENT_METHOD_ENTRIES, methodEntry, type PaymentMethod } from "./payment-methods.ts";

  let {
    form,
    line,
    index,
    refusal,
    disabled = false,
    onAddFiles,
    onRemoveFile,
    onFocusLine,
  }: {
    form: DepositForm;
    line: DepositLine;
    index: number;
    /** Why a field stands refused, once Record has been pressed; undefined otherwise. */
    refusal: (id: string) => string | undefined;
    disabled?: boolean;
    onAddFiles: (line: DepositLine, files: File[], kind: "scan" | "file") => void;
    onRemoveFile: (line: DepositLine, key: string) => void;
    /** Move focus to another line's first field, after the menu adds or moves one. */
    onFocusLine: (key: string) => void;
  } = $props();

  const number = $derived(index + 1);
  const id = (field: string) => fieldId.line(line.key, field);
  const entry = $derived(methodEntry(line.method));
  const counted = $derived(line.method === "cash" && line.countedMinor !== null);
  const scan = $derived(line.files.find((file) => file.kind === "scan") ?? line.files[0]);
  let shownFile = $state<string | null>(null);
  let counting = $state(false);

  const matterOptions = $derived(
    form.matters.map((bill) => ({
      value: bill.matterId,
      label: matterLabel(bill),
      aside: bill.clientName ?? undefined,
      keywords: bill.clientName === null ? [] : [bill.clientName],
    })),
  );
  const billOptions = $derived(
    form.billsOf(line.matterId).map((bill) => ({
      value: bill.invoiceId,
      label: billLabel(bill),
      aside: `owes ${money(bill.owedMinor)}`,
    })),
  );
  const methodOptions = PAYMENT_METHOD_ENTRIES.map((candidate) => ({
    value: candidate.method,
    label: candidate.label,
  }));

  const requiredDetails = $derived(entry.details.filter((field) => field.required));
  const shownOptional = $derived(
    entry.details.filter(
      (field) =>
        !field.required &&
        (line.shownDetails.includes(field.key) || (line.details[field.key] ?? "") !== ""),
    ),
  );
  const addableOptional = $derived(
    entry.details.filter((field) => !field.required && !shownOptional.includes(field)),
  );

  const summary = $derived.by(() => {
    const parts: string[] = [];
    if (line.files.length > 0) parts.push(line.files.length === 1 ? "1 file" : `${line.files.length} files`);
    if (line.note.trim() !== "") parts.push("Note");
    if (counted) parts.push("Counted by bill and coin");
    if (line.memo.trim() !== "") parts.push(`Memo: ${line.memo.trim()}`);
    return parts;
  });

  function setDetail(key: string, value: string): void {
    line.details = { ...line.details, [key]: value };
  }

  function removeDetail(key: string): void {
    const { [key]: _removed, ...rest } = line.details;
    line.details = rest;
    line.shownDetails = line.shownDetails.filter((shown) => shown !== key);
  }

  async function attach(kind: "scan" | "file"): Promise<void> {
    const files = await chooseFiles(FILE_TYPES, true);
    if (files.length === 0) return;
    onAddFiles(line, files, kind);
    line.expanded = true;
  }

  function showScan(): void {
    if (scan === undefined) return;
    line.expanded = true;
    shownFile = scan.key;
  }

  const cell = "flex min-w-0 flex-col gap-4";
  const head = "@5xl:sr-only";
</script>

<li
  class="border-b border-border-default last:border-b-0 data-expanded:bg-surface-sunken"
  data-expanded={line.expanded ? "" : undefined}
  aria-label="Line {number}"
>
  <div class="grid grid-cols-2 gap-x-12 gap-y-8 p-12 @5xl:flex @5xl:items-start @5xl:gap-8 @5xl:px-8 @5xl:py-8">
    <div class="flex items-center gap-4 @5xl:w-64 @5xl:shrink-0 @5xl:pt-4">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-expanded={line.expanded}
        aria-label={line.expanded ? `Close line ${number}` : `Open line ${number}`}
        onclick={() => (line.expanded = !line.expanded)}
      >
        {#if line.expanded}
          <ChevronDown class="size-16" aria-hidden="true" />
        {:else}
          <ChevronRight class="size-16" aria-hidden="true" />
        {/if}
      </Button>
      <span class="text-sm text-text-muted tabular-nums">
        <span class="@5xl:hidden">Line&nbsp;</span>{number}
      </span>
    </div>

    <div class="flex justify-end @5xl:order-last @5xl:w-32 @5xl:shrink-0">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class={buttonClasses({ variant: "ghost", size: "icon-sm" })}
          aria-label="More for line {number}"
          {disabled}
        >
          <Ellipsis class="size-16" aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Item
            onSelect={() => {
              const twin = form.duplicateLine(line.key);
              if (twin !== null) onFocusLine(twin.key);
            }}>Duplicate</DropdownMenu.Item
          >
          <DropdownMenu.Item
            onSelect={() => {
              const added = form.insertLineBelow(line.key);
              if (added !== null) onFocusLine(added.key);
            }}>Insert Line Below</DropdownMenu.Item
          >
          <DropdownMenu.Separator />
          <DropdownMenu.Item onSelect={() => void attach("scan")}>Attach a Scan</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => void attach("file")}>Attach a File</DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => {
              line.noteShown = true;
              line.expanded = true;
            }}>Add Note</DropdownMenu.Item
          >
          <DropdownMenu.Separator />
          <DropdownMenu.Item disabled={index === 0} onSelect={() => form.moveLine(line.key, -1)}>Move Up</DropdownMenu.Item>
          <DropdownMenu.Item disabled={index === form.lines.length - 1} onSelect={() => form.moveLine(line.key, 1)}
            >Move Down</DropdownMenu.Item
          >
          <DropdownMenu.Separator />
          <DropdownMenu.Item onSelect={() => form.clearLine(line.key)}>Clear Line</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => form.removeLine(line.key)}>Delete Line</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>

    <div class="{cell} col-span-2 @5xl:flex-3" title={refusal(id("matter"))}>
      <Label for={id("matter")} necessity="required" class={head}>Matter</Label>
      <ChoicePicker
        inputId={id("matter")}
        label="Matter"
        options={matterOptions}
        value={line.matterId}
        fillsCell
        invalid={refusal(id("matter")) !== undefined}
        title={refusal(id("matter"))}
        {disabled}
        whenNoMatch={(query) => `No matter with a bill owing matches "${query}".`}
        onchange={(value) => form.pickMatter(line, value)}
      />
    </div>

    <div class="{cell} @5xl:w-96 @5xl:shrink-0" title={refusal(id("bill"))}>
      <Label for={id("bill")} necessity="required" class={head}>Bill</Label>
      <ChoicePicker
        inputId={id("bill")}
        label={line.matterId === "" ? "Matter first" : "Bill"}
        options={billOptions}
        value={line.invoiceId}
        fillsCell
        invalid={refusal(id("bill")) !== undefined}
        title={refusal(id("bill"))}
        disabled={disabled || line.matterId === ""}
        onchange={(value) => form.pickBill(line, value)}
      />
    </div>

    <div class="{cell} @5xl:flex-2">
      <Label for={id("method")} necessity="required" class={head}>Method</Label>
      <ChoicePicker
        inputId={id("method")}
        label="Method"
        options={methodOptions}
        value={line.method}
        fillsCell
        {disabled}
        onchange={(value) => form.pickMethod(line, value as PaymentMethod)}
      />
    </div>

    <div class="{cell} @5xl:flex-2" title={refusal(id("reference"))}>
      <Label for={id("reference")} necessity={entry.referenceRequired ? "required" : undefined} class={head}>
        {entry.reference}
      </Label>
      <Input
        id={id("reference")}
        bind:value={line.reference}
        placeholder={entry.reference}
        autocomplete="off"
        maxlength={100}
        size="default"
        {disabled}
        aria-invalid={refusal(id("reference")) !== undefined ? "true" : undefined}
      />
    </div>

    <div class="{cell} @5xl:flex-2" title={refusal(id("from"))}>
      <Label for={id("from")} necessity="required" class={head}>Received From</Label>
      <Input
        id={id("from")}
        bind:value={line.receivedFrom}
        autocomplete="off"
        maxlength={200}
        {disabled}
        aria-invalid={refusal(id("from")) !== undefined ? "true" : undefined}
      />
    </div>

    <div class="{cell} @5xl:flex-2" title={refusal(id("received"))}>
      <Label for={id("received")} necessity="required" class={head}>Date Received</Label>
      <div class="grid min-w-0">
        <DatePicker
          id={id("received")}
          aria-label="Date Received"
          class="min-w-0"
          value={civilDateValue(line.receivedOn)}
          onValueChange={(next) => (line.receivedOn = civilDateTextOrEmpty(next))}
          aria-invalid={refusal(id("received")) !== undefined}
          {disabled}
        />
      </div>
    </div>

    <div class="{cell} @5xl:w-40 @5xl:shrink-0 @5xl:items-center">
      <span class="text-sm font-medium {head}">Scan</span>
      {#if scan !== undefined}
        <button
          type="button"
          class="flex size-32 items-center justify-center overflow-hidden rounded-sm border border-border-default bg-surface-raised"
          aria-label="Show {scan.file.name}"
          title={scan.file.name}
          onclick={showScan}
        >
          {#if scan.file.type.startsWith("image/")}
            <img src={objectAddress(scan.file)} alt="" class="size-32 object-cover" />
          {:else}
            <FileText class="size-16 text-text-muted" aria-hidden="true" />
          {/if}
        </button>
      {:else}
        <Button
          variant="ghost"
          size="icon-sm"
          class="border border-dashed border-border-default"
          aria-label="Attach a scan to line {number}"
          title="Attach a scan"
          {disabled}
          onclick={() => void attach("scan")}
        >
          <ScanLine class="size-16" aria-hidden="true" />
        </Button>
      {/if}
    </div>

    <div class="{cell} @5xl:flex-2" title={counted ? "Totalled from the cash count" : refusal(id("amount"))}>
      <Label for={id("amount")} necessity="required" class={head}>Amount</Label>
      <Input
        id={id("amount")}
        value={counted ? amountText(line.countedMinor ?? 0) : line.amountText}
        readonly={counted}
        inputmode="decimal"
        autocomplete="off"
        class="text-end tabular-nums"
        {disabled}
        aria-invalid={refusal(id("amount")) !== undefined ? "true" : undefined}
        oninput={(event) => (line.amountText = event.currentTarget.value)}
        onblur={() => (line.amountText = tidyAmount(line.amountText))}
      />
    </div>
  </div>

  {#if !line.expanded && summary.length > 0}
    <p class="-mt-4 flex flex-wrap gap-x-12 gap-y-4 px-12 pb-8 text-xs text-text-muted @5xl:ps-64">
      {#each summary as part (part)}
        <span class="inline-flex items-center gap-4">
          {#if part.endsWith("file") || part.endsWith("files")}
            <Paperclip class="size-12" aria-hidden="true" />
          {:else if part === "Note"}
            <StickyNote class="size-12" aria-hidden="true" />
          {/if}
          {part}
        </span>
      {/each}
    </p>
  {/if}

  {#if line.expanded}
    <div class="grid gap-24 border-t border-dashed border-border-default px-12 py-16 @3xl:grid-cols-2 @5xl:ps-64">
      <section class="flex min-w-0 flex-col gap-12" aria-label="{entry.label} details, line {number}">
        <FieldLabel as="h3">{entry.label} Details</FieldLabel>
        <div class="grid gap-12 @lg:grid-cols-2">
          {#if line.memoShown || line.memo !== ""}
            <div class="flex min-w-0 flex-col gap-4" title={refusal(id("memo"))}>
              <div class="flex items-center justify-between gap-4">
                <Label for={id("memo")}>Memo</Label>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="-my-4"
                  aria-label="Remove Memo"
                  title="Remove"
                  {disabled}
                  onclick={() => {
                    line.memo = "";
                    line.memoShown = false;
                  }}
                >
                  <X class="size-16" aria-hidden="true" />
                </Button>
              </div>
              <Input id={id("memo")} bind:value={line.memo} maxlength={500} autocomplete="off" {disabled} />
            </div>
          {/if}
          {#each requiredDetails as field (field.key)}
            <DetailField
              {field}
              id={id(`detail-${field.key}`)}
              value={line.details[field.key] ?? ""}
              refusal={refusal(id(`detail-${field.key}`))}
              {disabled}
              onChange={(value) => setDetail(field.key, value)}
            />
          {/each}
          {#each shownOptional as field (field.key)}
            <DetailField
              {field}
              id={id(`detail-${field.key}`)}
              value={line.details[field.key] ?? ""}
              refusal={refusal(id(`detail-${field.key}`))}
              {disabled}
              onChange={(value) => setDetail(field.key, value)}
              onRemove={() => removeDetail(field.key)}
            />
          {/each}
        </div>
        <div class="flex flex-wrap gap-8">
          {#if addableOptional.length > 0 || !(line.memoShown || line.memo !== "")}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger class={buttonClasses({ variant: "secondary", size: "sm" })} {disabled}>
                <Plus class="size-16" aria-hidden="true" />Add Detail
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                {#if !(line.memoShown || line.memo !== "")}
                  <DropdownMenu.Item onSelect={() => (line.memoShown = true)}>Memo</DropdownMenu.Item>
                {/if}
                {#each addableOptional as field (field.key)}
                  <DropdownMenu.Item onSelect={() => (line.shownDetails = [...line.shownDetails, field.key])}>
                    {field.label}
                  </DropdownMenu.Item>
                {/each}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          {/if}
          {#if line.method === "cash"}
            <Button
              variant="secondary"
              size="sm"
              aria-expanded={counting || counted}
              {disabled}
              onclick={() => (counting = !(counting || counted))}
            >
              {counting || counted ? "Hide the Count" : "Count by Bill and Coin"}
            </Button>
          {/if}
        </div>
        {#if line.method === "cash" && (counting || counted)}
          <CashCount {line} {disabled} />
        {/if}
      </section>

      <section class="flex min-w-0 flex-col gap-12" aria-label="Scans, notes and files, line {number}">
        <FieldLabel as="h3">Scans, Notes and Files for This Line</FieldLabel>
        <PendingFiles
          files={line.files}
          label="Files for line {number}"
          bind:shownKey={shownFile}
          {disabled}
          onAdd={(files) => onAddFiles(line, files, line.files.length === 0 ? "scan" : "file")}
          onRemove={(key) => onRemoveFile(line, key)}
        />
        {#if line.noteShown || line.note !== ""}
          <div class="flex flex-col gap-4">
            <div class="flex items-center justify-between gap-4">
              <Label for={id("note")}>Note</Label>
              <Button
                variant="ghost"
                size="icon-sm"
                class="-my-4"
                aria-label="Remove note"
                title="Remove"
                {disabled}
                onclick={() => {
                  line.note = "";
                  line.noteShown = false;
                }}
              >
                <X class="size-16" aria-hidden="true" />
              </Button>
            </div>
            <Textarea id={id("note")} bind:value={line.note} maxlength={4000} rows={3} {disabled} />
          </div>
        {:else}
          <Button variant="secondary" size="sm" class="self-start" {disabled} onclick={() => (line.noteShown = true)}>
            <Plus class="size-16" aria-hidden="true" />Add Note
          </Button>
        {/if}
      </section>
    </div>
  {/if}
</li>
