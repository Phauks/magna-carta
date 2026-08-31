<script lang="ts">
  /*
   * The details panel: the SMALLER altitude, beside the list.
   *
   * Three faces, one panel. Nothing selected, it speaks for the matter's cost position. One cost
   * selected, it shows that cost's identity, its standing and its facts. Several selected, it
   * speaks for the selection and counts what a verb would actually act on — never a verb that
   * pretends to cover rows it cannot touch.
   *
   * SELECTION IS NOT PRESENTATION. Clicking a row selects it and does nothing else; this panel
   * opens from its own control alone, and while it is open it follows whatever is selected.
   *
   * THE PANEL REACHES THE RECORD; THE RECORD WINDOW HOLDS IT. Open raises the product's one record
   * window, where the fields, the tabs and the print control live. What stays here are the verbs
   * that act on a cost without opening it.
   *
   * THE REVIEW VOCABULARY IS ABSENT, NOT DISABLED, WHERE THE FIRM DOES NOT RUN REVIEW. Nothing here
   * solicits a submission when the gate is off, and the chain is not drawn at all.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import RecordChain from "@magna-carta/design-system/record-chain";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import Maximize2 from "@lucide/svelte/icons/maximize-2";
  import Printer from "@lucide/svelte/icons/printer";
  import Send from "@lucide/svelte/icons/send";
  import Stamp from "@lucide/svelte/icons/stamp";
  import X from "@lucide/svelte/icons/x";
  import SoonAffordance from "$lib/maturity/soon-affordance.svelte";
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import Receipt from "@lucide/svelte/icons/receipt";
  import { costStatusKey } from "$lib/matters/cost-api.ts";
  import { expenseCodeText, type ExpenseCodeLabels } from "./cost-columns.ts";
  import { COST_LEDGER_GAPS, REVIEW_GATE_ENABLED, gapCellTitle, gapReason } from "./cost-gaps.ts";
  import { matterCostSummary, selectionSummary } from "./cost-figures.ts";
  import type { CostLedgerEntry } from "./cost-operations.ts";
  import {
    GONE_PAYEE_NOTE,
    billingSentence,
    payeeState,
    payeeText,
    sourceLabel,
  } from "./cost-vocabulary.ts";

  let {
    costs,
    selected,
    currency,
    expenseCodeLabels,
    canApprove,
    onOpen,
    onPrint,
    onSubmit,
    onApprove,
    onLetGo,
  }: {
    /** Every cost the matter carries, for the summary the panel gives when nothing is selected. */
    costs: readonly CostLedgerEntry[];
    /** What is selected right now, in the order the list holds it. */
    selected: readonly CostLedgerEntry[];
    currency: string;
    expenseCodeLabels: ExpenseCodeLabels;
    /** Whether this account holds the approve permission the review verbs are gated on. */
    canApprove: boolean;
    onOpen: (cost: CostLedgerEntry) => void;
    onPrint: (cost: CostLedgerEntry) => void;
    onSubmit: (costs: readonly CostLedgerEntry[]) => void;
    onApprove: (costs: readonly CostLedgerEntry[]) => void;
    onLetGo: () => void;
  } = $props();

  const sole = $derived(selected.length === 1 ? (selected[0] ?? null) : null);
  const summary = $derived(matterCostSummary(costs));
  const selection = $derived(
    selectionSummary(selected, (status) => statusEntry(costStatusKey(status)).label),
  );

  const money = (amountMinor: number): string => formatMoney(amountMinor / 100, { currency });

  /* What a verb over the selection can actually reach. A count is only honest if it is this. */
  const submittable = $derived(selected.filter((cost) => cost.status === "draft"));
  const approvable = $derived(
    canApprove ? selected.filter((cost) => cost.status === "submitted") : [],
  );

  /** Where the chain has got to. A void has left the chain rather than reached a step of it. */
  const chainStage = $derived.by(() => {
    if (sole === null || sole.status === "void") return null;
    return sole.status;
  });

  const payee = $derived(sole === null ? null : payeeState(sole));
</script>

{#snippet fact(label: string, value: string, title?: string)}
  <div class="flex items-baseline justify-between gap-16">
    <dt class="text-text-muted">{label}</dt>
    <dd class="text-right tabular-nums" {title}>{value}</dd>
  </div>
{/snippet}

<aside
  class="flex h-full w-full flex-col border-l border-border-default bg-surface-default"
  aria-label="Cost details"
>
  {#if sole !== null}
    <header class="flex items-start gap-8 border-b border-border-default p-12">
      <div class="min-w-0 flex-1">
        <h2 class="text-base leading-tight font-semibold">Cost Entry</h2>
        <p class="text-xs text-text-muted" title={gapCellTitle("entryNumber")}>
          {COST_LEDGER_GAPS.entryNumber.field} not yet recorded
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        title="Print this cost by itself"
        aria-label="Print this cost by itself"
        onclick={() => onPrint(sole)}
      >
        <Printer class="size-16" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title="Let go of this cost and show the matter summary"
        aria-label="Let go of this cost and show the matter summary"
        onclick={onLetGo}
      >
        <X class="size-16" aria-hidden="true" />
      </Button>
    </header>
    <div class="flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto p-16">
      <p class="text-sm">{sole.description}</p>

      <div class="flex flex-wrap items-center gap-8">
        <Button onclick={() => onOpen(sole)}>
          <Maximize2 class="size-16" aria-hidden="true" />
          Open
        </Button>
        {#if REVIEW_GATE_ENABLED}
          <Button
            variant="secondary"
            disabled={sole.status !== "draft"}
            title={sole.status === "draft"
              ? "Send this draft to review. It locks until it is approved or kicked back."
              : statusEntry(costStatusKey(sole.status)).meaning}
            onclick={() => onSubmit([sole])}
          >
            <Send class="size-16" aria-hidden="true" />
            Submit for Review
          </Button>
        {/if}
      </div>

      <SoonAffordance reason={gapReason("attachmentPicker")} reasonPlacement="line">
        {#snippet control(soon)}
          <Button variant="secondary" {...soon}>
            <Paperclip class="size-16" aria-hidden="true" />
            Attach File
          </Button>
        {/snippet}
      </SoonAffordance>

      <section class="flex flex-col gap-8 border-t border-border-default pt-12">
        <h3 class="text-xs text-text-subtle uppercase">Standing</h3>
        <div>
          <Badge {...statusBadgeAttributes(costStatusKey(sole.status))}>
            {statusEntry(costStatusKey(sole.status)).label}
          </Badge>
        </div>
        {#if chainStage !== null}
          <RecordChain current={chainStage} reviewGate={REVIEW_GATE_ENABLED} />
        {:else}
          <p class="text-xs text-text-muted">
            Frozen. A void cost stays on the record as what was withdrawn and counts toward nothing:
            a withdrawn cost was never charged.
          </p>
        {/if}
        <!-- A billed cost is linkable to its bill, and the link is the invoice reference the
             listing does not yet carry. -->
        {#if sole.status === "billed"}
          <SoonAffordance reason={gapReason("invoice")} reasonPlacement="line">
            {#snippet control(soon)}
              <Button variant="secondary" size="sm" {...soon}>
                <Receipt class="size-16" aria-hidden="true" />
                Open the Invoice
              </Button>
            {/snippet}
          </SoonAffordance>
        {/if}
      </section>

      <dl class="flex flex-col gap-4 border-t border-border-default pt-12 text-sm">
        {@render fact("Date Incurred", formatDate(sole.incurredDate))}
        {@render fact("Date Entered", "Not served", gapCellTitle("dateEntered"))}
        {@render fact("Payee", payeeText(sole), payee?.kind === "gone" ? GONE_PAYEE_NOTE : undefined)}
        {@render fact("Entered By", "Not served", gapCellTitle("enteredBy"))}
        {@render fact("Amount", money(sole.amountMinor))}
        {@render fact("Billing", billingSentence(sole.billable))}
        {@render fact(
          "Expense Code",
          expenseCodeText(sole, expenseCodeLabels) === ""
            ? "—"
            : expenseCodeText(sole, expenseCodeLabels),
        )}
        {@render fact("Attachments", "Not served", gapCellTitle("attachments"))}
        {@render fact("Source", sourceLabel(sole.source))}
      </dl>

      <section class="flex flex-col gap-8 border-t border-border-default pt-12">
        <h3 class="text-xs text-text-subtle uppercase">Internal Memo</h3>
        <p class="text-xs text-text-muted">{gapCellTitle("memo")}</p>
      </section>

      <section class="flex flex-col gap-8 border-t border-border-default pt-12">
        <h3 class="text-xs text-text-subtle uppercase">History</h3>
        <p class="text-xs text-text-muted">{gapCellTitle("history")}</p>
      </section>
    </div>
  {:else if selected.length > 1}
    <header class="flex items-start gap-8 border-b border-border-default p-12">
      <div class="min-w-0 flex-1">
        <h2 class="text-base leading-tight font-semibold">{selection.count} Costs Selected</h2>
        <p class="text-xs text-text-muted">{selection.statusLine}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        title="Let go of all {selection.count} selected costs"
        aria-label="Let go of all {selection.count} selected costs"
        onclick={onLetGo}
      >
        <X class="size-16" aria-hidden="true" />
      </Button>
    </header>
    <div class="flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto p-16">
      {#if REVIEW_GATE_ENABLED}
        <div class="flex flex-wrap items-center gap-8">
          <Button
            variant="secondary"
            disabled={submittable.length === 0}
            title={submittable.length === 0
              ? "No selected cost is a draft this account can submit."
              : `Send the ${submittable.length} selected ${submittable.length === 1 ? "draft" : "drafts"} to review together.`}
            onclick={() => onSubmit(submittable)}
          >
            <Send class="size-16" aria-hidden="true" />
            Submit {submittable.length === 0
              ? ""
              : `${submittable.length} `}{submittable.length === 1 ? "Draft" : "Drafts"}
          </Button>
          <Button
            variant="secondary"
            disabled={approvable.length === 0}
            title={approvable.length === 0
              ? "No selected cost is waiting for review."
              : `Approve the ${approvable.length} selected submitted ${approvable.length === 1 ? "cost" : "costs"}.`}
            onclick={() => onApprove(approvable)}
          >
            <Stamp class="size-16" aria-hidden="true" />
            Approve {approvable.length === 0 ? "" : `${approvable.length} `}{approvable.length === 1
              ? "Cost"
              : "Costs"}
          </Button>
        </div>
      {/if}
      <dl class="flex flex-col gap-4 text-sm">
        {@render fact(
          "Amount",
          selection.excludesVoids
            ? `${money(selection.amountMinor)} (voids excluded)`
            : money(selection.amountMinor),
        )}
        {@render fact("Billable", money(selection.billableMinor))}
      </dl>
    </div>
  {:else}
    <header class="border-b border-border-default p-12">
      <h2 class="text-base leading-tight font-semibold">This Matter&rsquo;s Costs</h2>
      <p class="text-xs text-text-muted">Select a cost for its details</p>
    </header>
    <div class="flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto p-16">
      <dl class="flex flex-col gap-4 text-sm">
        {@render fact(
          "Costs",
          summary.voidCount === 0
            ? String(summary.liveCount)
            : `${String(summary.liveCount)} (${String(summary.voidCount)} void)`,
        )}
        {@render fact("Recorded", money(summary.recordedMinor))}
        {@render fact("Absorbed", money(summary.absorbedMinor))}
      </dl>
      {#if summary.largestPayees.length > 0}
        <section class="flex flex-col gap-8 border-t border-border-default pt-12">
          <h3 class="text-xs text-text-subtle uppercase">Largest Payees</h3>
          <dl class="flex flex-col gap-4 text-sm">
            {#each summary.largestPayees as share (share.name)}
              {@render fact(share.name, money(share.amountMinor))}
            {/each}
          </dl>
        </section>
      {/if}
    </div>
  {/if}
</aside>
