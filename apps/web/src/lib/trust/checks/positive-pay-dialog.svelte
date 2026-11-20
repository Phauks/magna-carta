<script lang="ts">
  /*
   * The positive pay file: the checks this account issued and voided between two dates, as the CSV
   * a bank takes, saved to this computer. Nothing is recorded and nothing is sent anywhere.
   *
   * THE ACCOUNT NUMBER IS TYPED EACH TIME AND NEVER KEPT. The account record holds only the last
   * four digits, the file needs the whole number, and it lives in this dialog's state alone: not in
   * the browser's storage, not on the server, and gone when the dialog closes. Empty or not all
   * digits, the field turns red and says nothing under itself, and Download does nothing.
   *
   * THE DATES START ON THIS MONTH SO FAR, from the first of the month to today in the reader's zone,
   * which is the usual upload. The line under the fields counts what the file will hold as the dates
   * change, and a range that holds no check shuts Download.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import { civilDateParts, startOfCivilMonth } from "@magna-carta/civil-time/civil-date";
  import { zonedReading } from "@magna-carta/civil-time/time-zone";
  import { civilDateTextOrEmpty, civilDateValue, viewerTimeZone } from "$lib/dates";
  import type { TrustCheckRegisterRow } from "./checks-api.ts";
  import type { TrustChecksService } from "./checks-service.ts";
  import {
    isAccountNumber,
    positivePayCountText,
    positivePayCsv,
    positivePayFilename,
    positivePayRows,
  } from "./positive-pay.ts";

  let {
    open = $bindable(false),
    accountName,
    register,
    service,
  }: {
    open?: boolean;
    /** The trust account's own name, which the file is named after. */
    accountName: string;
    /** The account's checks, as the Checks screen read them. */
    register: readonly TrustCheckRegisterRow[];
    service: TrustChecksService;
  } = $props();

  const timeZone = viewerTimeZone();

  let from = $state("");
  let to = $state("");
  let accountNumber = $state("");

  function opened(): void {
    const today = zonedReading(Date.now(), timeZone).civilDate;
    const { year, month } = civilDateParts(today);
    from = startOfCivilMonth(year, month);
    to = today;
    accountNumber = "";
  }

  const accountValid = $derived(isAccountNumber(accountNumber));
  const datesChosen = $derived(from !== "" && to !== "");
  const rows = $derived(
    datesChosen ? positivePayRows(register, { from, to, timeZone }) : [],
  );

  const refusal = $derived.by((): string | undefined => {
    if (!datesChosen) return "Choose the dates.";
    if (from > to) return "The From date is after the To date.";
    if (rows.length === 0) return "No checks in these dates.";
    if (!accountValid) return "Enter the whole account number, digits only.";
    return undefined;
  });

  const subtitle = $derived<RecordSubject>({ facts: [accountName] });

  async function commit(): Promise<ActionOutcome> {
    if (refusal !== undefined) return "refused";
    await service.saveFile(
      positivePayCsv(rows, accountNumber),
      positivePayFilename(accountName, from, to),
      "text/csv",
    );
    return "committed";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Download Positive Pay File"
  {subtitle}
  commitLabel="Download"
  commitBusyLabel="Downloading"
  commitRefusal={refusal}
  width="narrow"
  unsavedChanges={false}
  onOpen={opened}
  onCommit={commit}
>
  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <div class="grid grid-cols-1 gap-16 sm:grid-cols-2">
        <div class="flex flex-col">
          <DatePicker
            necessity="required"
            label="From"
            value={civilDateValue(from)}
            onValueChange={(next) => (from = civilDateTextOrEmpty(next))}
            disabled={busy}
          />
        </div>
        <div class="flex flex-col">
          <DatePicker
            necessity="required"
            label="To"
            value={civilDateValue(to)}
            onValueChange={(next) => (to = civilDateTextOrEmpty(next))}
            disabled={busy}
          />
        </div>
      </div>
      <LabelledField
        necessity="required"
        label="Account Number"
        error={accountValid ? undefined : "Enter the whole account number, digits only."}
      >
        {#snippet children({ props })}
          <Input
            {...props}
            bind:value={accountNumber}
            inputmode="numeric"
            autocomplete="off"
            spellcheck={false}
            class="tabular-nums"
            disabled={busy}
          />
        {/snippet}
      </LabelledField>
      <p class="text-sm text-text-muted" role="status">{positivePayCountText(rows)}</p>
    </div>
  {/snippet}
</ActionDialog>
