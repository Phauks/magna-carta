<script lang="ts">
  /*
   * Importing one period of a trust bank account from the file the institution sent.
   *
   * TWO STEPS, ONE PANEL. Choosing the file and reading what it holds are one act — a member
   * checking that their bank's export was understood — and splitting them across two panels would
   * make the reader carry the answer from one to the other. So the panel reads the file, reports
   * what it found in the pane beside the fields, and the commit turns on once there is something
   * to commit.
   *
   * NOTHING IS STORED BY A PREVIEW, AND THE REPORT SAYS SO INSIDE ITS OWN FRAME. The sentence sits
   * in the report's structure rather than on the canvas beside it, because a reader who has just
   * watched forty rows appear needs it exactly where the rows are.
   *
   * THE COMMIT QUOTES THE PREVIEW'S FINGERPRINT. That is what makes the two steps honest: the
   * server refuses an import whose file no longer reads the way the previewed one did, so a file
   * edited or swapped between the review and the press cannot land as rows nobody saw. The refusal
   * comes back with the server's own words, which the failure notice renders.
   *
   * THE ROWS ARE THE PRODUCT'S ONE TABLE, and so are the rejections. A rejected row is not an
   * absence of data, it is a row with a reason, and a member deciding whether to fix the file or
   * import it as it stands is reading those reasons one by one.
   *
   * THE IDEMPOTENCY KEY IS MINTED WHEN THE PANEL OPENS, not when the commit is pressed, for the
   * same reason it is on every other write on this surface: a retry after a timeout has to be the
   * SAME submission rather than a second statement for the period.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import FileInput from "@magna-carta/design-system/file-input";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import Button from "@magna-carta/design-system/button";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { formatDateRange, placeholderOf } from "@magna-carta/design-system/formatters";
  import FileSearch from "@lucide/svelte/icons/file-search";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import { fieldRefusal } from "./trust-write-requests.ts";
  import {
    importTrustBankStatement,
    previewTrustStatementImport,
    type TrustStatementDateFormat,
    type TrustStatementImportPreview,
    type TrustStatementImportRow,
  } from "./trust-api.ts";
  import { trustMoneyText } from "./firm-trust-vocabulary.ts";
  import {
    STATEMENT_DATE_FORMAT_CHOICES,
    importColumnRows,
    importDateSpanText,
    previousCalendarMonth,
    readTrustStatementImportRequest,
    readTrustStatementPreviewRequest,
    readsAsStatementDateFormat,
  } from "./statement-entry.ts";
  import { statementLineDirectionLabel } from "./reconciliation-columns.ts";

  let {
    open = $bindable(false),
    trustAccountId,
    currency,
    timeZone,
    onRecorded,
  }: {
    open?: boolean;
    trustAccountId: string;
    /** The account's currency, so every figure on the panel reads in the account's own money. */
    currency: string;
    /** The holding office's zone: the day the account's month ends in. */
    timeZone: string;
    /** The statement was recorded. The surface re-reads its statements and selects this one. */
    onRecorded: (statementId: string) => void;
  } = $props();

  const fieldPrefix = $props.id();

  let periodStart = $state("");
  let periodEnd = $state("");
  let openingBalanceText = $state("");
  let closingBalanceText = $state("");
  let statementReference = $state("");
  let fileName = $state("");
  let fileText = $state("");
  let dateFormat = $state<TrustStatementDateFormat>("iso");
  let preview = $state<TrustStatementImportPreview | null>(null);
  let previewing = $state(false);
  let failure = $state<StatedFailure | null>(null);

  /** The submission this panel is making, reused on every retry of it. */
  let submissionKey = "";

  const money = (amountMinor: number): string => trustMoneyText(amountMinor, currency);

  function reset(): void {
    const period = previousCalendarMonth(timeZone);
    periodStart = period.periodStart;
    periodEnd = period.periodEnd;
    openingBalanceText = "";
    closingBalanceText = "";
    statementReference = "";
    fileName = "";
    fileText = "";
    dateFormat = "iso";
    preview = null;
    previewing = false;
    failure = null;
    submissionKey = crypto.randomUUID();
  }

  const draft = $derived({
    trustAccountId,
    periodStart,
    periodEnd,
    openingBalanceText,
    closingBalanceText,
    statementReference,
    fileText,
    dateFormat,
    preview,
  });

  const previewReading = $derived(readTrustStatementPreviewRequest(draft));
  const previewRefusal = $derived(
    previewReading.kind === "refused" ? previewReading.reason : undefined,
  );

  const reading = $derived(readTrustStatementImportRequest(draft));
  const commitRefusal = $derived(reading.kind === "refused" ? reading.reason : undefined);

  const started = $derived(fileText !== "");
  const problem = $derived(failure?.failure.problem ?? null);

  /*
   * Choosing a different file, or a different way of reading its days, retires the preview: the
   * fingerprint in hand describes the file that was reviewed, and keeping it beside a file nobody
   * has looked at is how an unreviewed import gets pressed.
   */
  async function chooseFile(event: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    const chosen = event.currentTarget.files?.[0] ?? null;
    preview = null;
    failure = null;
    if (chosen === null) {
      fileName = "";
      fileText = "";
      return;
    }
    fileName = chosen.name;
    fileText = await chosen.text();
  }

  function changeDateFormat(next: string): void {
    if (!readsAsStatementDateFormat(next)) return;
    dateFormat = next;
    preview = null;
  }

  async function readFile(): Promise<void> {
    if (previewReading.kind !== "request") return;
    previewing = true;
    failure = null;
    const outcome = await previewTrustStatementImport(
      fetch,
      previewReading.request,
      crypto.randomUUID(),
    );
    previewing = false;
    if (outcome.kind === "ok") {
      preview = outcome.value;
      return;
    }
    preview = null;
    failure = stated(
      outcome.failure,
      "The file was not read, so there is nothing to review yet.",
      "Nothing answered, so the file was not read. Nothing has been stored either way.",
    );
  }

  const columnRows = $derived(preview === null ? [] : importColumnRows(preview.columnMapping));
  const dateSpan = $derived(
    preview === null
      ? null
      : importDateSpanText(preview, (from, to) => formatDateRange(from, to)),
  );

  const rowGrid = DataTable.createDataTableGrid<TrustStatementImportRow>({
    columns: () => [
      { id: "rowNumber", label: "Row", type: "number", anchored: true, filter: "none", value: (row) => row.rowNumber },
      { id: "postedOn", label: "Posted On", type: "date", value: (row) => row.postedOn },
      {
        id: "direction",
        label: "Direction",
        type: "text",
        filter: "set",
        value: (row) => statementLineDirectionLabel(row.direction),
      },
      {
        id: "amount",
        label: "Amount",
        type: "number",
        align: "end",
        filter: "none",
        value: (row) => row.amountMinor,
        text: (row) => money(row.amountMinor),
      },
      { id: "description", label: "Description", type: "text", filter: "text", value: (row) => row.description },
      {
        id: "reference",
        label: "Reference",
        type: "text",
        value: (row) => row.reference,
        text: (row) => row.reference ?? "",
      },
      {
        id: "counterparty",
        label: "Counterparty",
        type: "text",
        filter: "set",
        value: (row) => row.counterpartyName,
        text: (row) => row.counterpartyName ?? "",
      },
    ],
    rows: () => preview?.rows ?? [],
    rowKey: (row) => String(row.rowNumber),
    initialSort: { columnId: "rowNumber", direction: "ascending" },
    itemNoun: { singular: "row", plural: "rows" },
  });

  const rejectionGrid = DataTable.createDataTableGrid<{ rowNumber: number; reason: string }>({
    columns: () => [
      { id: "rowNumber", label: "Row", type: "number", anchored: true, filter: "none", value: (row) => row.rowNumber },
      { id: "reason", label: "Reason", type: "text", filter: "text", value: (row) => row.reason },
    ],
    rows: () => preview?.rejections ?? [],
    rowKey: (row) => String(row.rowNumber),
    initialSort: { columnId: "rowNumber", direction: "ascending" },
    itemNoun: { singular: "row", plural: "rows" },
  });

  async function importStatement(): Promise<ActionOutcome> {
    if (reading.kind !== "request") return "refused";
    failure = null;
    const outcome = await importTrustBankStatement(fetch, reading.request, submissionKey);
    if (outcome.kind === "ok") {
      onRecorded(outcome.value.trustBankStatementId);
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "No statement was recorded.",
      "Nothing answered, so no statement was recorded. Retrying sends this same submission rather than recording a second statement for the period.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Import Statement"
  commitLabel="Import Statement"
  commitBusyLabel="Importing"
  {commitRefusal}
  unsavedChanges={started}
  onOpen={reset}
  onCommit={importStatement}
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
      <div class="flex flex-col gap-8">
        <Label for="{fieldPrefix}-file">Statement File</Label>
        <FileInput
          id="{fieldPrefix}-file"
          accept="text/csv,text/plain,.csv,.txt"
          disabled={busy || previewing}
          onchange={(event) => void chooseFile(event)}
        />
        <DefinitionList.Root>
          <DefinitionList.Row term="Chosen" empty={fileName === ""}>{fileName}</DefinitionList.Row>
        </DefinitionList.Root>
      </div>

      <div class="flex flex-col gap-8">
        <Label for="{fieldPrefix}-date-format">Date Format</Label>
        <ChoicePicker
          inputId="{fieldPrefix}-date-format"
          label="Date Format"
          options={STATEMENT_DATE_FORMAT_CHOICES}
          value={dateFormat}
          disabled={busy || previewing}
          onchange={changeDateFormat}
        />
      </div>

      <div class="grid gap-12 sm:grid-cols-2">
        <DatePicker
          label="Period Start"
          value={civilDateValue(periodStart)}
          onValueChange={(next) => (periodStart = civilDateTextOrEmpty(next))}
          disabled={busy}
        />
        <DatePicker
          label="Period End"
          value={civilDateValue(periodEnd)}
          onValueChange={(next) => (periodEnd = civilDateTextOrEmpty(next))}
          disabled={busy}
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

      <div class="flex">
        <Button
          variant="secondary"
          disabled={busy || previewing || previewRefusal !== undefined}
          title={previewRefusal}
          onclick={() => void readFile()}
        >
          <FileSearch class="size-16" aria-hidden="true" />
          {previewing ? "Reading" : "Preview"}
        </Button>
      </div>
    </div>
  {/snippet}

  {#snippet context()}
    <div class="flex flex-col gap-16">
      <FieldLabel as="p">What the File Holds</FieldLabel>

      <LoadingRegion loading={previewing} label="Reading the statement file">
        <DefinitionList.Root>
          <DefinitionList.Row term="Rows Read" empty={preview === null}>
            {preview === null ? "" : String(preview.rows.length)}
          </DefinitionList.Row>
          <DefinitionList.Row term="Rows Rejected" empty={preview === null}>
            {preview === null ? "" : String(preview.rejections.length)}
          </DefinitionList.Row>
          <DefinitionList.Row term="Deposits" empty={preview === null}>
            {preview === null ? "" : money(preview.depositTotalMinor)}
          </DefinitionList.Row>
          <DefinitionList.Row term="Withdrawals" empty={preview === null}>
            {preview === null ? "" : money(preview.withdrawalTotalMinor)}
          </DefinitionList.Row>
          <DefinitionList.Row term="Days Covered" empty={dateSpan === null}>
            {dateSpan ?? ""}
          </DefinitionList.Row>
          <DefinitionList.Empty term="What the File Holds">
            {preview === null
              ? "Preview the file to read what it holds. Nothing is stored by a preview."
              : "Nothing above has been stored. Import Statement is what records it."}
          </DefinitionList.Empty>
        </DefinitionList.Root>

        <div class="flex flex-col gap-8">
          <FieldLabel as="p">Column Mapping</FieldLabel>
          <DefinitionList.Root>
            {#each columnRows as row (row.field)}
              <DefinitionList.Row term={row.label} empty={row.column === null}>
                {row.column ?? ""}
              </DefinitionList.Row>
            {/each}
            {#if columnRows.length === 0}
              <DefinitionList.Empty term="Column Mapping">
                Which column each field was read from is stated once the file has been previewed.
              </DefinitionList.Empty>
            {/if}
          </DefinitionList.Root>
        </div>

        <div class="flex flex-col gap-8">
          <FieldLabel as="p">Rows</FieldLabel>
          <DataTable.Grid
            grid={rowGrid}
            caption="The rows the preview read out of the statement file"
            density="compact"
          />
        </div>

        <div class="flex flex-col gap-8">
          <FieldLabel as="p">Rejections</FieldLabel>
          <DataTable.Grid
            grid={rejectionGrid}
            caption="The rows the preview could not read, and why"
            density="compact"
          />
        </div>
      </LoadingRegion>
    </div>
  {/snippet}
</ActionDialog>
