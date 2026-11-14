<script lang="ts">
  /*
   * The cost ledger's details panel: what its three faces say, over the shared panel shell
   * ($lib/details-panel), which carries the frame, the header grammar and the ruled sections.
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
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import Maximize2 from "@lucide/svelte/icons/maximize-2";
  import Printer from "@lucide/svelte/icons/printer";
  import * as DetailsPanel from "$lib/details-panel/index.ts";
  import Send from "@lucide/svelte/icons/send";
  import Stamp from "@lucide/svelte/icons/stamp";
  import { SoonAffordance } from "@magna-carta/design-system/maturity";
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import Receipt from "@lucide/svelte/icons/receipt";
  import { costStatusKey } from "$lib/matters/cost-api.ts";
  import { expenseCodeText, type ExpenseCodeLabels } from "./cost-columns.ts";
  import { billHref } from "$lib/money/index.ts";
  import { COST_LEDGER_GAPS, REVIEW_GATE_ENABLED, gapCellTitle, gapReason } from "./cost-gaps.ts";
  import { matterCostSummary, selectionSummary } from "./cost-figures.ts";
  import type { CostLedgerEntry } from "./cost-operations.ts";
  import { GONE_PAYEE_NOTE, billingSentence, payeeState, payeeText, sourceLabel } from "./cost-vocabulary.ts";
import { GONE_RECORDER_NOTE, recorderState, recorderText, returnedDraftReason } from "$lib/records/work-in-progress-record.ts";

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
  const recorder = $derived(sole === null ? null : recorderState(sole));
</script>

<DetailsPanel.Root label="Cost details">
  {#if sole !== null}
    <DetailsPanel.Header>
      <DetailsPanel.Title>Cost Entry</DetailsPanel.Title>
      <DetailsPanel.Subtitle title={gapCellTitle("entryNumber")}>
        {COST_LEDGER_GAPS.entryNumber.field} not yet recorded
      </DetailsPanel.Subtitle>
      {#snippet actions()}
        <Button
          variant="ghost"
          size="icon"
          title="Print this cost by itself"
          aria-label="Print this cost by itself"
          onclick={() => onPrint(sole)}
        >
          <Printer class="size-16" aria-hidden="true" />
        </Button>
        <DetailsPanel.Close
          label="Let go of this cost and show the matter summary"
          onclick={onLetGo}
        />
      {/snippet}
    </DetailsPanel.Header>
    <DetailsPanel.Body>
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

      <DetailsPanel.Section label="Standing">
        <div>
          <Badge {...statusBadgeAttributes(costStatusKey(sole.status))}>
            {statusEntry(costStatusKey(sole.status)).label}
          </Badge>
        </div>
        <!-- Above the chain, because a returned draft is not a stage of the chain — it is a draft
             again, with an instruction attached, and the instruction is what the reader needs. -->
        {#if returnedDraftReason(sole) !== null}
          <p class="text-sm text-text-default">
            <span class="text-text-muted">Sent back for changes:</span>
            {returnedDraftReason(sole)}
          </p>
        {/if}
        {#if chainStage !== null}
          <RecordChain current={chainStage} reviewGate={REVIEW_GATE_ENABLED} />
        {:else}
          <p class="text-xs text-text-muted">
            Frozen. A void cost stays on the record as what was withdrawn and counts toward nothing:
            a withdrawn cost was never charged.
          </p>
        {/if}
        <!-- A billed cost names its bill, and the bill is read on the matter it charges, where the
             acts against it live. A cost billed before the mirror was written carries no reference,
             so the way through is stated as missing rather than offered and then failing. -->
        {#if sole.status === "billed"}
          {#if sole.invoiceId == null}
            <p class="text-xs text-text-muted">
              Billed, but the bill isn't linked to this cost. Find it in the matter's Billing section.
            </p>
          {:else}
            <Button
              variant="secondary"
              size="sm"
              href={billHref(sole.matterId, sole.invoiceId)}
              title="Open the bill this cost was billed onto, on the matter it charges."
            >
              <Receipt class="size-16" aria-hidden="true" />
              Open the Bill
            </Button>
          {/if}
        {/if}
      </DetailsPanel.Section>

      <DetailsPanel.Facts ruled>
        <DetailsPanel.Fact label="Date Incurred" value={formatDate(sole.incurredDate)} />
        <DetailsPanel.Fact
          label="Date Entered"
          value={formatInstant(sole.createdAt)}
          title="When this cost was written down, which is not the day the money went out."
        />
        <DetailsPanel.Fact
          label="Payee"
          value={payeeText(sole)}
          title={payee?.kind === "gone" ? GONE_PAYEE_NOTE : undefined}
        />
        <DetailsPanel.Fact
          label="Entered By"
          value={recorderText(sole)}
          title={recorder?.kind === "gone" ? GONE_RECORDER_NOTE : undefined}
        />
        <DetailsPanel.Fact label="Amount" value={money(sole.amountMinor)} />
        <DetailsPanel.Fact label="Billing" value={billingSentence(sole.billable)} />
        <DetailsPanel.Fact
          label="Expense Code"
          value={expenseCodeText(sole, expenseCodeLabels) === ""
            ? "—"
            : expenseCodeText(sole, expenseCodeLabels)}
        />
        <DetailsPanel.Fact label="Attachments" value="Not served" title={gapCellTitle("attachments")} />
        <DetailsPanel.Fact label="Source" value={sourceLabel(sole.source)} />
      </DetailsPanel.Facts>

      <DetailsPanel.Section label="Internal Memo">
        <p class="text-xs text-text-muted">{gapCellTitle("memo")}</p>
      </DetailsPanel.Section>

      <DetailsPanel.Section label="History">
        <p class="text-xs text-text-muted">{gapCellTitle("history")}</p>
      </DetailsPanel.Section>
    </DetailsPanel.Body>
  {:else if selected.length > 1}
    <DetailsPanel.Header>
      <DetailsPanel.Title>{selection.count} Costs Selected</DetailsPanel.Title>
      <DetailsPanel.Subtitle>{selection.statusLine}</DetailsPanel.Subtitle>
      {#snippet actions()}
        <DetailsPanel.Close
          label="Let go of all {selection.count} selected costs"
          onclick={onLetGo}
        />
      {/snippet}
    </DetailsPanel.Header>
    <DetailsPanel.Body>
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
      <DetailsPanel.Facts>
        <DetailsPanel.Fact
          label="Amount"
          value={selection.excludesVoids
            ? `${money(selection.amountMinor)} (voids excluded)`
            : money(selection.amountMinor)}
        />
        <DetailsPanel.Fact label="Billable" value={money(selection.billableMinor)} />
      </DetailsPanel.Facts>
    </DetailsPanel.Body>
  {:else}
    <DetailsPanel.Header>
      <DetailsPanel.Title>This Matter&rsquo;s Costs</DetailsPanel.Title>
      <DetailsPanel.Subtitle>Select a cost for its details</DetailsPanel.Subtitle>
    </DetailsPanel.Header>
    <DetailsPanel.Body>
      <DetailsPanel.Facts>
        <DetailsPanel.Fact
          label="Costs"
          value={summary.voidCount === 0
            ? String(summary.liveCount)
            : `${String(summary.liveCount)} (${String(summary.voidCount)} void)`}
        />
        <DetailsPanel.Fact label="Recorded" value={money(summary.recordedMinor)} />
        <DetailsPanel.Fact label="Absorbed" value={money(summary.absorbedMinor)} />
      </DetailsPanel.Facts>
      {#if summary.largestPayees.length > 0}
        <DetailsPanel.Section label="Largest Payees">
          <DetailsPanel.Facts>
            {#each summary.largestPayees as share (share.name)}
              <DetailsPanel.Fact label={share.name} value={money(share.amountMinor)} />
            {/each}
          </DetailsPanel.Facts>
        </DetailsPanel.Section>
      {/if}
    </DetailsPanel.Body>
  {/if}
</DetailsPanel.Root>
