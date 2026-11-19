<script lang="ts">
  /*
   * CHECKS — one trust account's checks: the payments waiting to be printed, the numbers printed,
   * and the numbers taken out of use.
   *
   * THE QUEUE IS THE SCREEN'S FIRST ANSWER. A payment recorded as paid by check with no number
   * waits here, every one chosen at rest, because the ordinary visit is "print what is waiting".
   * Each chosen row previews the number it will print on, in the order shown, so the reader can
   * check the paper in the printer against the screen before pressing Print.
   *
   * PRINTING IS FOUR STEPS AND TWO OF THEM ARE QUESTIONS. Confirm Print lists the checks in the
   * order they will come out and the number on the first sheet, which the reader may change for
   * the batch; only then does the server number it, the browser compose the PDF off the main
   * thread and hand it to a new tab, and the reader say which checks came out right. Leaving that
   * question unanswered loses nothing: the checks wait in Printed as Not Answered, and Answer asks
   * it again. A check marked Misprinted is voided and its payment goes straight back into Confirm
   * Print, on the next number, so a reprint is one step; a check already recorded as printed is
   * reprinted from its row with Void and Reprint.
   *
   * THE CHECK NUMBER IS THE READER'S. The header's Change sets the account's next number at any
   * point, higher or lower, and Confirm Print sets the first number of one batch.
   *
   * VOIDING NEVER MOVES MONEY, and the panel that does it says so. What the screen can do is read
   * off the session once by the route and handed in as one refusal, the same sentence on every
   * control it governs.
   *
   * THE OUTSIDE WORLD IS HANDED IN. The reads, the writes, the PDF and the new tab are all on
   * `service`, so the developer-console gallery renders this same component over fixtures.
   */
  import { untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { goto } from "$app/navigation";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import * as SegmentedControl from "@magna-carta/design-system/segmented-control";
  import Badge from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
  import Printer from "@lucide/svelte/icons/printer";
  import Ban from "@lucide/svelte/icons/ban";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Settings2 from "@lucide/svelte/icons/settings-2";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { withAccount, type BackDestination } from "$lib/screen/screen-header.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import { trustMoneyText } from "$lib/trust/firm-trust-vocabulary.ts";
  import type {
    PrintTrustChecksResponse,
    TrustCheckRegisterRow,
    TrustCheckToPrint,
    TrustChecksResponse,
  } from "./checks-api.ts";
  import type { TrustChecksService } from "./checks-service.ts";
  import { checkBatchDocument } from "./check-document.ts";
  import { CheckPdfError } from "./check-pdf.ts";
  import {
    QUEUE_COLUMNS,
    REGISTER_COLUMNS,
    queueColumns,
    registerColumns,
  } from "./checks-columns.ts";
  import {
    checkStatusLabel,
    checkStatusTone,
    previewNumbers,
    printedRows,
    voidedRows,
    waitingRows,
    type CheckToAnswer,
    type ChecksView,
  } from "./checks-model.ts";
  import CheckConfirmPrintDialog from "./check-confirm-print-dialog.svelte";
  import CheckNextNumberDialog from "./check-next-number-dialog.svelte";
  import CheckPrintResultsDialog from "./check-print-results-dialog.svelte";
  import CheckVoidDialog from "./check-void-dialog.svelte";

  let {
    trustAccountId,
    accountName,
    back,
    service,
    memberName,
    manageRefusal,
    opening,
  }: {
    trustAccountId: string;
    /** Where the screen was entered from; the account is added to it. */
    back: BackDestination;
    /** The account's own name, or null while the roster is being read. */
    accountName: string | null;
    service: TrustChecksService;
    /** A member identifier as a name, from the firm's roster. */
    memberName: (identifier: string) => string;
    /** Why this reader may not print, answer or void, or undefined where they may. */
    manageRefusal: string | undefined;
    /**
     * A panel to open once the first read lands, for the developer gallery's screenshots of states
     * a reader reaches only by printing: Confirm Print for the waiting payments, the answer panel
     * for the unanswered checks, or Confirm Print again for payments back after a misprint.
     */
    opening?:
      | { readonly panel: "print" }
      | { readonly panel: "answer" }
      | { readonly panel: "reprint"; readonly trustMovementIds: readonly string[] };
  } = $props();

  // ---- the read ----------------------------------------------------------------------------------

  let data = $state<TrustChecksResponse | null>(null);
  let failure = $state<Failure | null>(null);
  let chosenOnce = false;
  /** The payments the last read listed, so a later read can tell which have just arrived. */
  let seen = new Set<string>();

  async function load(): Promise<void> {
    failure = null;
    const outcome = await service.read(trustAccountId);
    if (outcome.kind !== "ok") {
      failure = outcome.failure;
      return;
    }
    data = outcome.value;
    // Every waiting payment starts chosen on the first read; later reads keep the reader's choice,
    // and a payment that has arrived since (a misprint back from the printer) starts chosen too.
    const keys = outcome.value.toPrint.map((row) => row.trustMovementId);
    if (!chosenOnce) {
      chosenOnce = true;
      chosen = new Set(keys);
    } else {
      const arrived = keys.filter((key) => !seen.has(key));
      if (arrived.length > 0) chosen = new Set([...chosen, ...arrived]);
    }
    seen = new Set(keys);
    if (opening !== undefined && !opened) {
      opened = true;
      if (opening.panel === "print") void askToPrint();
      else if (opening.panel === "answer") answerWaiting();
      else askToPrintAgain(opening.trustMovementIds);
    }
  }
  let opened = false;

  let started = false;
  $effect(() => {
    if (started) return;
    started = true;
    void load();
  });

  const currency = $derived(
    data?.toPrint[0]?.currency ?? data?.register.find((row) => row.currency !== null)?.currency ?? "USD",
  );
  const money = (amountMinor: number | null): string =>
    amountMinor === null ? "" : trustMoneyText(amountMinor, currency);

  const stockHref = $derived(`/trust/checks/stock?account=${encodeURIComponent(trustAccountId)}`);
  const trustBack = $derived(withAccount(back, trustAccountId));

  // ---- the three lists ---------------------------------------------------------------------------

  let view = $state<ChecksView>("to-print");

  const toPrint = $derived(data?.toPrint ?? []);
  const printed = $derived(printedRows(data?.register ?? []));
  const voided = $derived(voidedRows(data?.register ?? []));
  const waiting = $derived(waitingRows(data?.register ?? []));

  /*
   * Which payments will print. This is the screen's own choice, not the grid's row selection: a
   * selected row is washed in the selection colour, and a queue that starts all chosen would be a
   * table washed end to end. The checkbox is the whole mark.
   */
  let chosen = $state<ReadonlySet<string>>(new Set());

  const queueGrid: DataTable.DataTableGridState<TrustCheckToPrint> =
    DataTable.createDataTableGrid<TrustCheckToPrint>({
    columns: (): readonly DataTable.GridColumn<TrustCheckToPrint>[] =>
      queueColumns({
        currency,
        memberName,
        previewNumber: (identifier): number | null => previews.get(identifier) ?? null,
      }),
    rows: () => toPrint,
    rowKey: (row) => row.trustMovementId,
    initialSort: { columnId: null, direction: "ascending" },
    itemNoun: { singular: "payment", plural: "payments" },
  });

  /** The chosen payments in the order the queue shows them, which is the order they are numbered. */
  const chosenInOrder: readonly string[] = $derived(
    queueGrid.sortedRows
      .map((row) => row.trustMovementId)
      .filter((identifier) => chosen.has(identifier)),
  );

  const previews: ReadonlyMap<string, number> = $derived(previewNumbers(chosenInOrder, data?.nextCheckNumber ?? 0));

  const printedGrid = DataTable.createDataTableGrid<TrustCheckRegisterRow>({
    columns: () => registerColumns({ currency, voided: false }),
    rows: () => printed,
    rowKey: (row) => row.trustCheckId,
    initialSort: { columnId: REGISTER_COLUMNS.checkNumber, direction: "descending" },
    itemNoun: { singular: "check", plural: "checks" },
  });

  const voidedGrid = DataTable.createDataTableGrid<TrustCheckRegisterRow>({
    columns: () => registerColumns({ currency, voided: true }),
    rows: () => voided,
    rowKey: (row) => row.trustCheckId,
    initialSort: { columnId: REGISTER_COLUMNS.checkNumber, direction: "descending" },
    itemNoun: { singular: "number", plural: "numbers" },
  });

  /*
   * On a phone the lists keep what a reader acts on (the payee, the amount, the number) and set
   * the rest aside; the header menu's Columns submenu still brings any of them back.
   */
  const narrow = new MediaQuery("max-width: 40rem");
  $effect(() => {
    const wide = !narrow.current;
    // The grids' own column state is read and written here, so only the width is tracked.
    untrack(() => {
      for (const id of [
        QUEUE_COLUMNS.matter,
        QUEUE_COLUMNS.memo,
        QUEUE_COLUMNS.approvedBy,
        QUEUE_COLUMNS.checkNumber,
      ]) {
        queueGrid.setColumnVisible(id, wide);
      }
      for (const grid of [printedGrid, voidedGrid]) {
        grid.setColumnVisible(REGISTER_COLUMNS.matter, wide);
        grid.setColumnVisible(REGISTER_COLUMNS.date, wide);
      }
      voidedGrid.setColumnVisible(REGISTER_COLUMNS.settledOn, wide);
    });
  });

  function toggleChosen(key: string): void {
    const next = new Set(chosen);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    chosen = next;
  }

  // ---- printing ----------------------------------------------------------------------------------

  const chosenCount = $derived(chosenInOrder.length);
  const printLabel = $derived(
    chosenCount === 0 ? "Print Checks" : chosenCount === 1 ? "Print 1 Check" : `Print ${chosenCount} Checks`,
  );
  const printRefusal = $derived.by((): string | undefined => {
    if (manageRefusal !== undefined) return manageRefusal;
    if (data === null) return "Reading this account's checks.";
    if (chosenCount === 0) return "Choose the payments to print.";
    return undefined;
  });

  let printing = $state(false);
  let printKey = "";
  let printKeyFor = "";
  let pdfFailure = $state<Failure | null>(null);
  let lastBatch = $state<PrintTrustChecksResponse | null>(null);
  let lastPdf = $state<Blob | null>(null);

  // ---- confirm print -----------------------------------------------------------------------------

  /** The payments Confirm Print is asking about, in print order, and whether it is a reprint. */
  let confirming = $state<{ payments: readonly TrustCheckToPrint[]; again: boolean }>({
    payments: [],
    again: false,
  });
  let confirmOpen = $state(false);

  async function askToPrint(): Promise<void> {
    if (data === null || chosenCount === 0) return;
    if (data.stock === null) {
      await goto(stockHref);
      return;
    }
    const byIdentifier = new Map(toPrint.map((row) => [row.trustMovementId, row]));
    confirming = {
      payments: chosenInOrder.flatMap((identifier) => {
        const row = byIdentifier.get(identifier);
        return row === undefined ? [] : [row];
      }),
      again: false,
    };
    confirmOpen = true;
  }

  /** Confirm Print again, for payments back in To Print after a misprint or a void. */
  function askToPrintAgain(trustMovementIds: readonly string[]): void {
    const byIdentifier = new Map(toPrint.map((row) => [row.trustMovementId, row]));
    const payments = trustMovementIds.flatMap((identifier) => {
      const row = byIdentifier.get(identifier);
      return row === undefined ? [] : [row];
    });
    if (payments.length === 0) return;
    confirming = { payments, again: true };
    confirmOpen = true;
  }

  /** Number the batch from `first`, make its PDF, and ask how it printed. */
  async function print(first: number): Promise<Failure | null> {
    const identifiers = confirming.payments.map((row) => row.trustMovementId);
    // One key per batch and first number: pressing again for the same after a failure is a retry.
    const batch = `${first}:${identifiers.join(",")}`;
    if (printKeyFor !== batch) {
      printKey = crypto.randomUUID();
      printKeyFor = batch;
    }
    printing = true;
    pdfFailure = null;
    const outcome = await service.print(trustAccountId, identifiers, printKey, first);
    if (outcome.kind !== "ok") {
      printing = false;
      return outcome.failure;
    }
    printKeyFor = "";
    lastBatch = outcome.value;
    await composeBatch(outcome.value);
    printing = false;
    answering = outcome.value.checks.map((check) => ({
      trustCheckId: check.trustCheckId,
      checkNumber: check.checkNumber,
      payee: check.payee,
      amountText: money(check.amountMinor),
      trustMovementId: check.trustMovementId,
    }));
    answerOpen = true;
    chosenOnce = false;
    void load();
    return null;
  }

  async function recorded(reprint: readonly string[]): Promise<void> {
    await load();
    askToPrintAgain(reprint);
  }

  async function composeBatch(batch: PrintTrustChecksResponse): Promise<void> {
    if (batch.stock === null) return;
    try {
      const pdf = await service.composePdf(
        checkBatchDocument(
          batch.stock,
          batch.checks.map((check) => ({
            checkNumber: check.checkNumber,
            payee: check.payee,
            amountMinor: check.amountMinor,
            effectiveDate: check.effectiveDate,
            memo: check.memo,
            matterNumber: check.matterNumber,
            matterTitle: check.matterTitle,
          })),
        ),
      );
      lastPdf = pdf;
      service.openPdf(pdf);
    } catch (error) {
      pdfFailure = {
        problem: null,
        request: "Compose the check PDF in this browser",
        failedAt: new Date(),
        cause: error instanceof CheckPdfError ? error.message : String(error),
      };
    }
  }

  // ---- answering ---------------------------------------------------------------------------------

  let answering = $state<readonly CheckToAnswer[]>([]);
  let answerOpen = $state(false);

  function answerWaiting(): void {
    answering = waiting.map((row) => ({
      trustCheckId: row.trustCheckId,
      checkNumber: row.checkNumber,
      payee: row.payee ?? "",
      amountText: money(row.amountMinor),
      trustMovementId: row.trustMovementId,
    }));
    answerOpen = true;
  }

  // ---- voiding -----------------------------------------------------------------------------------

  let voiding = $state<
    | {
        kind: "check";
        trustCheckId: string;
        checkNumber: number;
        payee: string;
        amountText: string;
        trustMovementId: string | null;
        reprint: boolean;
      }
    | { kind: "next"; checkNumber: number }
    | null
  >(null);
  let voidOpen = $state(false);

  function voidCheck(row: TrustCheckRegisterRow, reprint: boolean): void {
    voiding = {
      kind: "check",
      trustCheckId: row.trustCheckId,
      checkNumber: row.checkNumber,
      payee: row.payee ?? "",
      amountText: money(row.amountMinor),
      trustMovementId: row.trustMovementId,
      reprint,
    };
    voidOpen = true;
  }

  async function afterVoid(reprint: string | null): Promise<void> {
    await load();
    if (reprint !== null) askToPrintAgain([reprint]);
  }

  // ---- the next number ---------------------------------------------------------------------------

  let nextNumberOpen = $state(false);
  const usedNumbers = $derived((data?.register ?? []).map((row) => row.checkNumber));

  function voidNextNumber(): void {
    if (data === null) return;
    voiding = { kind: "next", checkNumber: data.nextCheckNumber };
    voidOpen = true;
  }

  const counts = $derived({ toPrint: toPrint.length, printed: printed.length, voided: voided.length });
</script>

{#snippet queueCell({ row, column, text }: DataTable.GridCellContext<TrustCheckToPrint>)}
  {#if column.id === QUEUE_COLUMNS.chosen}
    <!-- The press is the checkbox's alone: a row click would replace the whole choice with this row. -->
    <span
      class="inline-flex"
      role="presentation"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => {
        if (event.key === " " || event.key === "Enter") event.stopPropagation();
      }}
    >
      <Checkbox
        checked={chosen.has(row.trustMovementId)}
        aria-label={`Print the check to ${row.payee}`}
        disabled={manageRefusal !== undefined}
        onCheckedChange={() => toggleChosen(row.trustMovementId)}
      />
    </span>
  {:else if column.id === QUEUE_COLUMNS.checkNumber}
    <span
      class="tabular-nums text-text-muted"
      title={row.earlierCheckNumbers.length === 0
        ? undefined
        : `Printed before on ${row.earlierCheckNumbers.join(", ")}, since voided.`}
    >
      {text}
    </span>
  {:else}
    {text}
  {/if}
{/snippet}

{#snippet registerCell({ row, column, text }: DataTable.GridCellContext<TrustCheckRegisterRow>)}
  {#if column.id === REGISTER_COLUMNS.status}
    <Badge variant={checkStatusTone(row.status)}>{checkStatusLabel(row.status)}</Badge>
  {:else if column.id === REGISTER_COLUMNS.checkNumber}
    <span class="tabular-nums">{text}</span>
  {:else if column.id === REGISTER_COLUMNS.act}
    {#if row.status === "numbered"}
      <Button
        variant="secondary"
        size="sm"
        disabled={manageRefusal !== undefined}
        title={manageRefusal}
        onclick={answerWaiting}
      >
        Answer
      </Button>
    {:else}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class={buttonClasses({ variant: "ghost", size: "icon-sm" })}
          aria-label={`More for check ${row.checkNumber}`}
        >
          <EllipsisVertical class="size-16" aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Item
            disabled={manageRefusal !== undefined || row.trustMovementId === null}
            title={manageRefusal}
            onSelect={() => voidCheck(row, true)}
          >
            <RotateCcw class="size-16 shrink-0" aria-hidden="true" />
            Void and Reprint
          </DropdownMenu.Item>
          <DropdownMenu.Item
            disabled={manageRefusal !== undefined}
            title={manageRefusal}
            onSelect={() => voidCheck(row, false)}
          >
            <Ban class="size-16 shrink-0" aria-hidden="true" />
            Void
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
  {:else}
    {text}
  {/if}
{/snippet}

{#snippet pageMenu()}
  <!-- On a phone the title row has room for one action, so Check Stock moves in here. -->
  {#if narrow.current}
    <DropdownMenu.Item onSelect={() => void goto(stockHref)}>
      <Settings2 class="size-16 shrink-0" aria-hidden="true" />
      Check Stock
    </DropdownMenu.Item>
  {/if}
  <DropdownMenu.Item
    disabled={manageRefusal !== undefined || data === null}
    title={manageRefusal}
    onSelect={voidNextNumber}
  >
    <Ban class="size-16 shrink-0" aria-hidden="true" />
    Void Next Number
  </DropdownMenu.Item>
{/snippet}

<div class="flex h-full min-h-0 flex-col gap-16">
  <ScreenHeader title={accountName ?? "Checks"} back={trustBack} {pageMenu}>
    {#snippet meta()}
      {#if data !== null}
        <span class="inline-flex items-center gap-4">
          <span class="tabular-nums">Next check number {data.nextCheckNumber}</span>
          {#if manageRefusal === undefined && data.stock !== null}
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Change the next check number, now ${data.nextCheckNumber}`}
              onclick={() => (nextNumberOpen = true)}
            >
              Change
            </Button>
          {/if}
        </span>
        {#if data.stock !== null}
          <Masthead.MetaSeparator />
          <span>{data.stock.name}</span>
        {/if}
      {/if}
    {/snippet}
    {#snippet actions()}
      {#if !narrow.current}
        <Button variant="secondary" href={stockHref}>Check Stock</Button>
      {/if}
      <Button
        variant="primary"
        disabled={printRefusal !== undefined || printing}
        title={data?.stock === null ? "Set up this account's check stock first." : printRefusal}
        onclick={() => void askToPrint()}
      >
        <Printer class="size-16" aria-hidden="true" />
        {printing ? "Printing" : printLabel}
      </Button>
    {/snippet}
  </ScreenHeader>

  {#if failure !== null}
    <FailureNotice
      {failure}
      title="This Account's Checks Could Not Be Read"
      fallback="Nothing was printed or changed. Every check on the account is still on its record."
      onRetry={() => void load()}
    />
  {:else}
    {#if pdfFailure !== null && lastBatch !== null}
      <FailureNotice
        failure={pdfFailure}
        title="The Check PDF Could Not Be Made"
        fallback="The checks are numbered and waiting for an answer. Make the PDF again before you print."
        onRetry={() => {
          if (lastBatch !== null) void composeBatch(lastBatch).then(() => (pdfFailure = null));
        }}
      />
    {/if}
    {#if waiting.length > 0}
      <div class="flex flex-wrap items-center gap-12">
        <Alert.Root variant="warning" class="min-w-0 flex-1">
          <Alert.Description>
            {waiting.length === 1
              ? `Check ${waiting[0]?.checkNumber} has not been answered for.`
              : `Checks ${waiting[0]?.checkNumber} to ${waiting.at(-1)?.checkNumber} have not been answered for.`}
          </Alert.Description>
        </Alert.Root>
        <Button
          variant="secondary"
          disabled={manageRefusal !== undefined}
          title={manageRefusal}
          onclick={answerWaiting}
        >
          Answer
        </Button>
      </div>
    {/if}

    <span id="checks-view-label" class="sr-only">Which checks</span>
    <SegmentedControl.Root
      aria-labelledby="checks-view-label"
      class="w-full sm:w-md"
      value={view}
      onValueChange={(next) => (view = next as ChecksView)}
    >
      <SegmentedControl.Item value="to-print">To Print ({counts.toPrint})</SegmentedControl.Item>
      <SegmentedControl.Item value="printed">Printed ({counts.printed})</SegmentedControl.Item>
      <SegmentedControl.Item value="voided">Voided ({counts.voided})</SegmentedControl.Item>
    </SegmentedControl.Root>

    <div class="flex min-h-0 flex-1 flex-col gap-8">
      {#if view === "to-print"}
        <DataTable.Grid
          grid={queueGrid}
          cell={queueCell}
          class="min-h-0 flex-1"
          caption="Payments waiting to be printed as checks"
          loading={data === null}
        />
        <DataTable.GridFooter grid={queueGrid} />
      {:else if view === "printed"}
        <DataTable.Grid
          grid={printedGrid}
          cell={registerCell}
          class="min-h-0 flex-1"
          caption="Checks printed on this account"
          loading={data === null}
        />
        <DataTable.GridFooter grid={printedGrid} />
      {:else}
        <DataTable.Grid
          grid={voidedGrid}
          cell={registerCell}
          class="min-h-0 flex-1"
          caption="Check numbers misprinted or voided on this account"
          loading={data === null}
        />
        <DataTable.GridFooter grid={voidedGrid} />
      {/if}
    </div>
  {/if}
</div>

<CheckPrintResultsDialog
  bind:open={answerOpen}
  {trustAccountId}
  checks={answering}
  {service}
  pdf={lastPdf}
  onRecorded={(reprint) => void recorded(reprint)}
/>

<CheckConfirmPrintDialog
  bind:open={confirmOpen}
  payments={confirming.payments}
  again={confirming.again}
  suggestedFirst={data?.nextCheckNumber ?? 1}
  {accountName}
  money={(amountMinor) => money(amountMinor)}
  {manageRefusal}
  onPrint={print}
/>

<CheckNextNumberDialog
  bind:open={nextNumberOpen}
  {trustAccountId}
  stock={data?.stock ?? null}
  nextCheckNumber={data?.nextCheckNumber ?? 1}
  {usedNumbers}
  {service}
  onSaved={() => void load()}
/>

<CheckVoidDialog
  bind:open={voidOpen}
  {trustAccountId}
  subject={voiding}
  {service}
  onVoided={(reprint) => void afterVoid(reprint)}
/>
