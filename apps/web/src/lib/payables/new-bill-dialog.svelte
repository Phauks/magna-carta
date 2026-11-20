<script lang="ts">
  /*
   * New Bill: one bill from one vendor, line by line.
   *
   * A LINE ON A MATTER IS A REAL COST ON THAT MATTER. It goes onto the matter as an approved cost
   * the moment the bill is saved, and the matter's next draft invoice picks it up. A hard cost
   * (money the firm fronted for the client: a filing fee, a court reporter) is carried as Client
   * Costs Advanced until the client pays it back; a soft cost, or a line with no matter, is the
   * firm's own expense and goes to the account the line names. Each line says so in plain words
   * under the lines, so nobody has to know the posting to know where the money went.
   *
   * THE VENDOR'S USUAL ACCOUNT FILLS IN FIRST. Picking a vendor reads the account its bills usually
   * go to and fills every line that has none; Save as the Usual Account sets it from this bill.
   */
  import ActionDialog, { type ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import { DatePicker, civilDateTextOrEmpty, civilDateValue } from "@magna-carta/design-system/date-picker";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import * as SegmentedControl from "@magna-carta/design-system/segmented-control";
  import type { PickableEntity } from "@magna-carta/design-system/entity-picker";
  import { todayInUtc } from "@magna-carta/civil-time/civil-date";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { LedgerChartAccount } from "@magna-carta/api-client";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import DirectoryEntityPicker from "$lib/directory/directory-entity-picker.svelte";
  import { directoryPickerSearch } from "$lib/directory/directory-picker-source.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { WriteIntent } from "$lib/api/write-intent.ts";
  import MatterPicker from "$lib/time/matter-picker.svelte";
  import { matterDisplay, type SheetMatter } from "$lib/time/time-sheet-model.ts";
  import { readVendorDefaultAccount, recordVendorBill, setVendorDefaultAccount } from "./payables-api.ts";
  import { money, parseAmountMinor } from "./vendor-bill-view.ts";

  let {
    open = $bindable(false),
    expenseAccounts,
    matters,
    mattersCapped = false,
    onRecorded,
  }: {
    open?: boolean;
    /** The chart's expense accounts a line may go to: active, with nothing under them. */
    expenseAccounts: readonly LedgerChartAccount[];
    matters: readonly SheetMatter[];
    mattersCapped?: boolean;
    onRecorded: () => void;
  } = $props();

  interface DraftLine {
    key: string;
    description: string;
    matterId: string | null;
    costType: "hard" | "soft";
    accountId: string;
    amountText: string;
  }

  const blankLine = (accountId = ""): DraftLine => ({
    key: crypto.randomUUID(),
    description: "",
    matterId: null,
    costType: "hard",
    accountId,
    amountText: "",
  });

  let vendor = $state<PickableEntity | null>(null);
  let billReference = $state("");
  let billDate = $state("");
  let dueDate = $state("");
  let lines = $state<DraftLine[]>([blankLine()]);
  let usualAccountId = $state<string | null>(null);
  let saveAsUsual = $state(false);
  let attempted = $state(false);
  let failure = $state<StatedFailure | null>(null);
  const intent = new WriteIntent();
  const vendorSearch = directoryPickerSearch(fetch);

  const accountOptions = $derived(
    expenseAccounts.map((account) => ({
      value: account.ledgerAccountId,
      label: account.code === null ? account.name : `${account.code} ${account.name}`,
    })),
  );
  const accountName = (accountId: string): string =>
    accountOptions.find((option) => option.value === accountId)?.label ?? "an expense account";
  const matterName = (matterId: string): string => {
    const matter = matters.find((candidate) => candidate.id === matterId);
    return matter === undefined ? "the matter" : matterDisplay(matter);
  };

  function reset(): void {
    vendor = null;
    billReference = "";
    billDate = todayInUtc();
    dueDate = "";
    lines = [blankLine()];
    usualAccountId = null;
    saveAsUsual = false;
    attempted = false;
    failure = null;
  }

  async function pickVendor(entity: PickableEntity | null): Promise<void> {
    vendor = entity;
    usualAccountId = null;
    if (entity === null) return;
    const outcome = await readVendorDefaultAccount(entity.identifier);
    if (outcome.kind !== "ok" || vendor?.identifier !== entity.identifier) return;
    usualAccountId = outcome.value.ledgerAccountId;
    if (usualAccountId !== null) {
      const fill = usualAccountId;
      lines = lines.map((line) => (line.accountId === "" ? { ...line, accountId: fill } : line));
    }
  }

  const needsAccount = (line: DraftLine): boolean => line.matterId === null || line.costType === "soft";

  function lineRefusal(line: DraftLine, index: number): string | null {
    if (line.description.trim() === "") return `Line ${index + 1} needs a description.`;
    if (parseAmountMinor(line.amountText) === null) return `Line ${index + 1} needs an amount.`;
    if (needsAccount(line) && line.accountId === "") return `Line ${index + 1} needs an account.`;
    return null;
  }

  const refusal = $derived.by((): string | undefined => {
    if (vendor === null) return "Pick the vendor.";
    if (billDate === "") return "Enter the bill date.";
    if (dueDate !== "" && dueDate < billDate) return "The due date is before the bill date.";
    for (const [index, line] of lines.entries()) {
      const reason = lineRefusal(line, index);
      if (reason !== null) return reason;
    }
    return undefined;
  });

  const totalMinor = $derived(
    lines.reduce((total, line) => total + (parseAmountMinor(line.amountText) ?? 0), 0),
  );

  /** Where each line goes, in the words a bookkeeper would use. */
  function destination(line: DraftLine): string {
    if (line.matterId === null) {
      return line.accountId === "" ? "The firm's own expense." : `The firm's own expense, in ${accountName(line.accountId)}.`;
    }
    if (line.costType === "hard") {
      return `A hard cost on ${matterName(line.matterId)}, held as Client Costs Advanced until the client pays it back. It goes on the matter's next draft invoice.`;
    }
    return `A soft cost on ${matterName(line.matterId)}, in ${accountName(line.accountId)}. It goes on the matter's next draft invoice.`;
  }

  const firstAccount = $derived(lines.find((line) => needsAccount(line) && line.accountId !== "")?.accountId ?? null);

  async function commit(): Promise<ActionOutcome> {
    attempted = true;
    failure = null;
    if (refusal !== undefined || vendor === null) return "refused";
    const vendorId = vendor.identifier;
    const { value: outcome } = await intent.submit((key) =>
      recordVendorBill(
        {
          vendorId,
          billReference: billReference.trim() || null,
          billDate,
          dueDate: dueDate || null,
          lines: lines.map((line) => ({
            description: line.description.trim(),
            amountMinor: parseAmountMinor(line.amountText) ?? 0,
            matterId: line.matterId,
            disbursementClass: line.matterId === null ? null : line.costType,
            ledgerAccountId: needsAccount(line) ? line.accountId : null,
          })),
        },
        key,
      ),
    );
    if (outcome.kind !== "ok") {
      failure = stated(outcome.failure, "The bill was not saved.");
      return "refused";
    }
    if (saveAsUsual && firstAccount !== null && firstAccount !== usualAccountId) {
      // The bill is saved either way; a failed default is only a missed convenience.
      await setVendorDefaultAccount(vendorId, firstAccount, crypto.randomUUID());
    }
    onRecorded();
    return "committed";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  width="wide"
  heading="New Bill"
  commitLabel="Save Bill"
  commitBusyLabel="Saving"
  commitRefusal={attempted ? refusal : undefined}
  unsavedChanges={vendor !== null || lines.some((line) => line.description.trim() !== "" || line.amountText.trim() !== "")}
  onOpen={reset}
  onCommit={commit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Bill Was Not Saved"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <div class="grid gap-12 sm:grid-cols-2">
        <div class="flex flex-col gap-4">
          <Label necessity="required" for="new-bill-vendor">Vendor</Label>
          <DirectoryEntityPicker
            search={vendorSearch}
            value={vendor}
            onSelect={(entity) => void pickVendor(entity)}
            onClear={() => void pickVendor(null)}
            label="Vendor"
            inputId="new-bill-vendor"
            disabled={busy}
          />
        </div>
        <LabelledField label="Bill No.">
          {#snippet children({ props })}
            <Input {...props} bind:value={billReference} maxlength={100} disabled={busy} autocomplete="off" />
          {/snippet}
        </LabelledField>
      </div>
      <div class="grid gap-12 sm:grid-cols-2">
        <DatePicker
          necessity="required"
          label="Bill Date"
          value={civilDateValue(billDate)}
          onValueChange={(next) => (billDate = civilDateTextOrEmpty(next))}
          disabled={busy}
        />
        <DatePicker
          label="Due Date"
          value={civilDateValue(dueDate)}
          onValueChange={(next) => (dueDate = civilDateTextOrEmpty(next))}
          disabled={busy}
        />
      </div>

      <section class="flex flex-col gap-12" aria-label="Lines">
        {#each lines as line, index (line.key)}
          <div class="flex flex-col gap-8 rounded-md border border-border-default p-12">
            <div class="flex items-center justify-between gap-8">
              <span class="text-sm font-semibold">Line {index + 1}</span>
              {#if lines.length > 1}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove line {index + 1}"
                  disabled={busy}
                  onclick={() => (lines = lines.filter((candidate) => candidate.key !== line.key))}
                >
                  <Trash2 class="size-16" aria-hidden="true" />
                </Button>
              {/if}
            </div>
            <div class="grid gap-8 sm:grid-cols-[2fr_1fr]">
              <LabelledField necessity="required" label="Description">
                {#snippet children({ props })}
                  <Input {...props} bind:value={line.description} maxlength={500} disabled={busy} autocomplete="off" />
                {/snippet}
              </LabelledField>
              <LabelledField necessity="required" label="Amount">
                {#snippet children({ props })}
                  <Input {...props} bind:value={line.amountText} inputmode="decimal" class="tabular-nums" disabled={busy} autocomplete="off" />
                {/snippet}
              </LabelledField>
            </div>
            <div class="grid gap-8 sm:grid-cols-2">
              <div class="flex flex-col gap-4">
                <Label for="new-bill-matter-{line.key}">Matter</Label>
                <MatterPicker
                  {matters}
                  value={line.matterId}
                  inputId="new-bill-matter-{line.key}"
                  disabled={busy}
                  capped={mattersCapped}
                  noMatterLabel="None, the firm's own expense"
                  title="A line on a matter is a cost on that matter and goes on its next draft invoice."
                  onpick={(picked) => (line.matterId = picked)}
                />
              </div>
              {#if line.matterId !== null}
                <div class="flex flex-col gap-4">
                  <span class="text-sm font-medium">Type</span>
                  <SegmentedControl.Root
                    value={line.costType}
                    onValueChange={(next) => (line.costType = next === "soft" ? "soft" : "hard")}
                    aria-label="Hard or soft cost"
                  >
                    <SegmentedControl.Item value="hard">Hard Cost</SegmentedControl.Item>
                    <SegmentedControl.Item value="soft">Soft Cost</SegmentedControl.Item>
                  </SegmentedControl.Root>
                </div>
              {/if}
            </div>
            {#if needsAccount(line)}
              <LabelledField necessity="required" label="Account">
                {#snippet children({ props })}
                  <ChoicePicker
                    inputId={props.id}
                    label="Account"
                    options={accountOptions}
                    bind:value={line.accountId}
                    disabled={busy}
                  />
                {/snippet}
              </LabelledField>
            {/if}
            <p class="text-sm text-text-muted">{destination(line)}</p>
          </div>
        {/each}
        <div class="flex flex-wrap items-center justify-between gap-8">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onclick={() => (lines = [...lines, blankLine(usualAccountId ?? "")])}
          >
            <Plus class="size-16" aria-hidden="true" />
            Add Line
          </Button>
          <span class="text-sm">Total <strong class="tabular-nums">{money(totalMinor)}</strong></span>
        </div>
      </section>

      {#if vendor !== null && firstAccount !== null && firstAccount !== usualAccountId}
        <label class="flex items-center gap-8 text-sm">
          <Checkbox bind:checked={saveAsUsual} disabled={busy} />
          Save {accountName(firstAccount)} as {vendor.name}'s usual account
        </label>
      {/if}
    </div>
  {/snippet}
</ActionDialog>
