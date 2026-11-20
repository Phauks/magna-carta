<script lang="ts">
  /*
   * RECONCILIATION — every period reconciled on one trust account, newest first, each with its
   * full dates and years. A period covers whatever dates its statement covers, so half months and
   * odd periods read plainly. Change is the end balance less the start. Every column but the dates
   * can be turned off from the header menu.
   *
   * The list reads itself again every few seconds, so a period somebody else finishes shows here
   * without a Refresh button.
   */
  import { goto } from "$app/navigation";
  import { MediaQuery } from "svelte/reactivity";
  import { untrack } from "svelte";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as SegmentedControl from "@magna-carta/design-system/segmented-control";
  import * as Select from "@magna-carta/design-system/select";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import { formatDate, formatInstantDate } from "@magna-carta/design-system/formatters";
  import Plus from "@lucide/svelte/icons/plus";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import type { TrustAccountListing } from "$lib/trust/trust-api.ts";
  import { trustMoneyText } from "$lib/trust/firm-trust-vocabulary.ts";
  import type {
    TrustBankReconciliationList,
    TrustBankReconciliationSummary,
  } from "./reconciliation-api.ts";
  import type { ReconciliationService } from "./reconciliation-service.ts";
  import { LIST_COLUMNS, listColumns } from "./reconciliation-columns.ts";
  import { statusLabel, statusOf, statusTone } from "./reconciliation-model.ts";
  import { readLive } from "./live-read.ts";
  import ReconciliationNewDialog from "./reconciliation-new-dialog.svelte";

  type ListFilter = "all" | "in-progress" | "finished" | "review";

  let {
    trustAccountId,
    accounts,
    service,
    manageRefusal,
    today,
    reconciliationHref = (reconciliationId: string) =>
      `/reconciliation/${encodeURIComponent(reconciliationId)}`,
    onAccountChange,
  }: {
    trustAccountId: string;
    /** The firm's trust accounts, for the picker; null while they are read. */
    accounts: readonly TrustAccountListing[] | null;
    service: ReconciliationService;
    /** Why this reader may not start a reconciliation, or undefined where they may. */
    manageRefusal: string | undefined;
    /** Today where the account is held, as YYYY-MM-DD. */
    today: string;
    reconciliationHref?: (reconciliationId: string) => string;
    onAccountChange: (trustAccountId: string) => void;
  } = $props();

  const account = $derived(accounts?.find((one) => one.id === trustAccountId) ?? null);
  const currency = $derived(account?.currency ?? "USD");
  const money = (minor: number): string => trustMoneyText(minor, currency);

  let data = $state<TrustBankReconciliationList | null>(null);
  let failure = $state<Failure | null>(null);

  async function load(): Promise<void> {
    const outcome = await service.readList(trustAccountId);
    if (outcome.kind !== "ok") {
      // A failed re-read keeps the list on screen; only a first read that fails says so.
      if (data === null) failure = outcome.failure;
      return;
    }
    failure = null;
    data = outcome.value;
  }

  $effect(() => {
    void trustAccountId;
    untrack(() => {
      data = null;
      void load();
    });
    return readLive(() => void load(), 15_000);
  });

  let filter = $state<ListFilter>("all");
  const all = $derived(data?.reconciliations ?? []);
  const counts = $derived({
    all: all.length,
    inProgress: all.filter((row) => row.reconciliation.finishedAt === null).length,
    finished: all.filter((row) => row.reconciliation.finishedAt !== null).length,
    review: all.filter((row) => row.needsReviewCount > 0).length,
  });
  const shown = $derived(
    all.filter((row) => {
      if (filter === "in-progress") return row.reconciliation.finishedAt === null;
      if (filter === "finished") return row.reconciliation.finishedAt !== null;
      if (filter === "review") return row.needsReviewCount > 0;
      return true;
    }),
  );
  const inProgress = $derived(all.find((row) => row.reconciliation.finishedAt === null) ?? null);

  const grid = DataTable.createDataTableGrid<TrustBankReconciliationSummary>({
    columns: () => listColumns(currency),
    rows: () => shown,
    rowKey: (row) => row.reconciliation.trustBankReconciliationId,
    initialSort: { columnId: LIST_COLUMNS.dates, direction: "descending" },
    itemNoun: { singular: "reconciliation", plural: "reconciliations" },
    onActivate: (row) => void goto(reconciliationHref(row.reconciliation.trustBankReconciliationId)),
  });

  const narrow = new MediaQuery("max-width: 40rem");
  $effect(() => {
    const wide = !narrow.current;
    untrack(() => {
      for (const id of [
        LIST_COLUMNS.startBalance,
        LIST_COLUMNS.deposited,
        LIST_COLUMNS.withdrawn,
        LIST_COLUMNS.change,
        LIST_COLUMNS.endBalance,
        LIST_COLUMNS.files,
        LIST_COLUMNS.notes,
      ]) {
        grid.setColumnVisible(id, wide);
      }
    });
  });

  const newRefusal = $derived.by((): string | undefined => {
    if (manageRefusal !== undefined) return manageRefusal;
    if (data === null) return "Reading this account's reconciliations.";
    if (inProgress !== null) return "Finish the reconciliation in progress first.";
    return undefined;
  });
  let newOpen = $state(false);

  const accountLine = $derived.by((): string | undefined => {
    if (account === null) return undefined;
    const parts = [account.name];
    if (account.bankName !== null) parts.push(account.bankName);
    if (account.accountNumberLastFour !== null) {
      parts.push(`account ending ${account.accountNumberLastFour}`);
    }
    return parts.join(", ");
  });

  function finishedLine(row: TrustBankReconciliationSummary): string | null {
    const header = row.reconciliation;
    if (header.finishedAt === null) return null;
    const who = header.finishedByName ?? "Someone";
    return `${who}, ${formatInstantDate(header.finishedAt)}`;
  }
</script>

{#snippet cell({ row, column, text }: DataTable.GridCellContext<TrustBankReconciliationSummary>)}
  {#if column.id === LIST_COLUMNS.dates}
    <a
      class="font-medium text-text-default underline-offset-4 hover:underline"
      href={reconciliationHref(row.reconciliation.trustBankReconciliationId)}
    >
      {text}
    </a>
  {:else if column.id === LIST_COLUMNS.status}
    {@const status = statusOf(row)}
    <span class="flex flex-col items-start gap-2">
      <Badge variant={statusTone(status)}>{statusLabel(status)}</Badge>
      {#if finishedLine(row) !== null}
        <span class="text-xs text-text-muted">{finishedLine(row)}</span>
      {:else if !row.reconciliation.startCarriedOver}
        <span class="text-xs text-text-muted">First one, start typed by hand</span>
      {/if}
    </span>
  {:else if column.id === LIST_COLUMNS.change && text !== "" && !text.startsWith("-")}
    <span class="tabular-nums">+{text}</span>
  {:else}
    {text}
  {/if}
{/snippet}

<div class="flex h-full min-h-0 flex-col gap-16">
  <ScreenHeader title="Reconciliation">
    {#snippet meta()}
      {#if accountLine !== undefined}<span>{accountLine}</span>{/if}
    {/snippet}
    {#snippet actions()}
      {#if accounts !== null && accounts.length > 1}
        <Select.Root
          type="single"
          items={accounts.map((one) => ({ value: one.id, label: one.name }))}
          allowDeselect={false}
          value={trustAccountId}
          onValueChange={(next) => {
            if (next !== "" && next !== trustAccountId) onAccountChange(next);
          }}
        >
          <Select.Trigger aria-label="Account" class="w-auto min-w-48">
            <Select.Value placeholder="Account" />
          </Select.Trigger>
          <Select.Content>
            {#each accounts as one (one.id)}
              <Select.Item value={one.id} label={one.name} />
            {/each}
          </Select.Content>
        </Select.Root>
      {/if}
      {#if inProgress !== null}
        <Button
          variant="primary"
          href={reconciliationHref(inProgress.reconciliation.trustBankReconciliationId)}
        >
          Open In Progress
        </Button>
      {:else}
        <Button
          variant="primary"
          disabled={newRefusal !== undefined}
          title={newRefusal}
          onclick={() => (newOpen = true)}
        >
          <Plus class="size-16" aria-hidden="true" />
          New Reconciliation
        </Button>
      {/if}
    {/snippet}
  </ScreenHeader>

  {#if failure !== null}
    <FailureNotice
      {failure}
      title="This Account's Reconciliations Could Not Be Read"
      fallback="Nothing was changed."
      onRetry={() => void load()}
    />
  {:else}
    <div class="flex flex-wrap items-center justify-between gap-12">
      <span id="reconciliation-filter-label" class="sr-only">Which reconciliations</span>
      <SegmentedControl.Root
        aria-labelledby="reconciliation-filter-label"
        class="w-full sm:w-xl"
        value={filter}
        onValueChange={(next) => (filter = next as ListFilter)}
      >
        <SegmentedControl.Item value="all">All ({counts.all})</SegmentedControl.Item>
        <SegmentedControl.Item value="in-progress">In Progress ({counts.inProgress})</SegmentedControl.Item>
        <SegmentedControl.Item value="finished">Finished ({counts.finished})</SegmentedControl.Item>
        <SegmentedControl.Item value="review">Needs Review ({counts.review})</SegmentedControl.Item>
      </SegmentedControl.Root>
      {#if data?.nextStart != null && inProgress === null}
        <span class="text-sm text-text-muted tabular-nums">
          Next one starts {formatDate(data.nextStart.startDate)} at {money(data.nextStart.startBalanceMinor)}
        </span>
      {/if}
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-8">
      <DataTable.Grid
        {grid}
        {cell}
        class="min-h-0 flex-1"
        caption="Reconciliations of this trust account"
        loading={data === null}
      />
      <DataTable.GridFooter {grid} />
    </div>
  {/if}
</div>

<ReconciliationNewDialog
  bind:open={newOpen}
  {trustAccountId}
  accountName={account?.name ?? null}
  nextStart={data?.nextStart ?? null}
  {today}
  {money}
  {service}
  onStarted={(reconciliationId) => void goto(reconciliationHref(reconciliationId))}
/>
