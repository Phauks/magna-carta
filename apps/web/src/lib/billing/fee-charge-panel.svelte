<script lang="ts">
  /*
   * The fee panel: the agreement, or one charge under it.
   *
   * WITH NOTHING SELECTED THE PANEL SPEAKS FOR THE AGREEMENT. That is the fee fact the matter owns —
   * the cause of every charge in the list beside it — and the matter's fee position beneath it. A
   * panel that went blank when nothing was selected would waste the one place this surface has to
   * say what the matter actually charges.
   *
   * WITH ONE CHARGE SELECTED IT SHOWS THAT CHARGE AS INVOICE EVIDENCE. A fee line is born on a bill,
   * so its standing is the bill's standing and its lock reason is the bill's lock reason. Nothing
   * here submits, approves or voids: corrections happen in the register, as credit notes beside the
   * bill.
   *
   * WITH SEVERAL SELECTED IT SUMS THEM AND OFFERS NOTHING. There is no bulk act on evidence.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EventRail from "@magna-carta/design-system/event-rail";
  import ProgressSteps from "@magna-carta/design-system/progress-steps";
  import RecordChain from "@magna-carta/design-system/record-chain";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import type { ProgressStep } from "@magna-carta/design-system/progress-steps";
  import Clock from "@lucide/svelte/icons/clock";
  import Printer from "@lucide/svelte/icons/printer";
  import Receipt from "@lucide/svelte/icons/receipt";
  import X from "@lucide/svelte/icons/x";
  import SoonAffordance from "$lib/maturity/soon-affordance.svelte";
  import type { ArrangementRecord } from "./billing-api.ts";
  import {
    AMENDMENT_STANDING_NOTE,
    ARRANGEMENT_KIND_LABELS,
    arrangementTerms,
    versionPeriod,
    versionTitle,
  } from "./fee-agreement.ts";
  import {
    FEE_CHARGE_GAPS,
    FEE_KIND_LABELS,
    FEE_KIND_MEANINGS,
    feePosition,
    invoiceStandingLine,
    type FeeCharge,
  } from "./fee-charges.ts";
  import { billStage, type InvoiceRow } from "./invoice-standing.ts";

  let {
    charges,
    selected,
    arrangement,
    unbilledMinor,
    currency,
    rowOf,
    onPrint,
    onShowBill,
    onLetGo,
  }: {
    /** Every charge on the matter, for the position the panel states with nothing selected. */
    charges: readonly FeeCharge[];
    selected: readonly FeeCharge[];
    arrangement: ArrangementRecord | null;
    /** Billable time on this matter that no bill has taken up, priced. */
    unbilledMinor: number;
    currency: string;
    /** The bill a charge rides, so its standing can be read off it. */
    rowOf: (invoiceId: string) => InvoiceRow | null;
    onPrint: (charge: FeeCharge) => void;
    /** Show the bill this charge rides, in the register on the same screen. */
    onShowBill: (invoiceId: string) => void;
    onLetGo: () => void;
  } = $props();

  const money = (amountMinor: number): string => formatMoney(amountMinor / 100, { currency });

  const sole = $derived(selected.length === 1 ? (selected[0] ?? null) : null);
  const position = $derived(feePosition(charges, unbilledMinor));
  const inForce = $derived(arrangement?.inForce ?? null);
  const history = $derived(arrangement?.history ?? []);

  const soleRow = $derived(sole === null ? null : rowOf(sole.invoiceId));

  /** The bill's chain, which is the charge's chain: a fee line does not have one of its own. */
  const chain = $derived.by((): readonly ProgressStep[] => {
    if (soleRow === null) return [];
    const stage = billStage(soleRow);
    const reached = stage === "draft" ? 0 : stage === "finalized" ? 1 : 2;
    return ["Draft", "Finalized", "Paid"].map((label, index) => ({
      label,
      status: index < reached ? "done" : index === reached ? "active" : "pending",
    }));
  });

  const selectionKinds = $derived.by((): string => {
    const counts = new Map<string, number>();
    for (const charge of selected) {
      counts.set(charge.kind, (counts.get(charge.kind) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([kind, count]) => `${String(count)} ${FEE_KIND_LABELS[kind as FeeCharge["kind"]].toLowerCase()}`)
      .join(" · ");
  });
</script>

{#snippet fact(label: string, value: string, title?: string)}
  <div class="flex items-baseline justify-between gap-16">
    <dt class="text-text-muted">{label}</dt>
    <dd class="text-right tabular-nums" {title}>{value}</dd>
  </div>
{/snippet}

<aside
  class="flex h-full w-full flex-col border-l border-border-default bg-surface-default"
  aria-label="Charge details"
>
  {#if sole !== null}
    <header class="flex items-start gap-8 border-b border-border-default p-12">
      <div class="min-w-0 flex-1">
        <h2 class="text-base leading-tight font-semibold">
          {sole.kind === "credit" ? "Credit Note Line" : "Fee Charge"}
        </h2>
        <p class="font-mono text-xs text-text-muted">{sole.reference}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        title="Print this charge by itself"
        aria-label="Print this charge by itself"
        onclick={() => onPrint(sole)}
      >
        <Printer class="size-16" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title="Let go of this charge and show the agreement"
        aria-label="Let go of this charge and show the agreement"
        onclick={onLetGo}
      >
        <X class="size-16" aria-hidden="true" />
      </Button>
    </header>

    <div class="flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto p-16">
      <p class="text-sm">{sole.narrative}</p>

      <section class="flex flex-col gap-8 border-t border-border-default pt-12">
        <h3 class="text-xs text-text-subtle uppercase">Standing</h3>
        <div>
          <Badge {...statusBadgeAttributes(sole.standing)}>
            {statusEntry(sole.standing).label}
          </Badge>
        </div>
        {#if soleRow !== null}
          {#if soleRow.summary.status !== "void"}
            <ProgressSteps steps={chain} />
          {/if}
          <RecordChain
            current={billStage(soleRow) === "paid" ? "paid" : "billed"}
            lock={{ reason: invoiceStandingLine(soleRow, (isoDate) => formatDate(isoDate)) }}
          />
          <Button
            variant="secondary"
            size="sm"
            class="self-start"
            title="Show the bill this charge rides, in the register"
            onclick={() => onShowBill(sole.invoiceId)}
          >
            <Receipt class="size-16" aria-hidden="true" />
            Show {sole.document} In The Register
          </Button>
        {/if}
      </section>

      <dl class="flex flex-col gap-4 border-t border-border-default pt-12 text-sm">
        {@render fact("Date", formatDate(sole.date))}
        {@render fact(sole.kind === "credit" ? "Credit Note" : "Invoice", sole.document)}
        {@render fact("Kind", FEE_KIND_LABELS[sole.kind], FEE_KIND_MEANINGS[sole.kind])}
        {@render fact("Amount", money(sole.amountMinor))}
        {@render fact(
          "Agreement",
          sole.arrangementLabel ?? "Not arrangement-composed",
          "The agreement version rides only arrangement-composed lines. An hourly fee line derives from time entries and the rate cards in force.",
        )}
      </dl>

      <section class="flex flex-col gap-8 border-t border-border-default pt-12">
        <h3 class="text-xs text-text-subtle uppercase">Drawn From</h3>
        <SoonAffordance reason={FEE_CHARGE_GAPS.drawnFrom} reasonPlacement="line">
          {#snippet control(soon)}
            <Button variant="secondary" size="sm" {...soon}>
              <Clock class="size-16" aria-hidden="true" />
              View The Entries On Time
            </Button>
          {/snippet}
        </SoonAffordance>
      </section>

      <section class="flex flex-col gap-8 border-t border-border-default pt-12">
        <h3 class="text-xs text-text-subtle uppercase">History</h3>
        <EventRail
          events={[]}
          label="This charge's history"
          emptyMessage="Not built yet. Waiting on {FEE_CHARGE_GAPS.history}."
        />
      </section>
    </div>
  {:else if selected.length > 1}
    <header class="flex items-start gap-8 border-b border-border-default p-12">
      <div class="min-w-0 flex-1">
        <h2 class="text-base leading-tight font-semibold">
          {selected.length} Charges Selected
        </h2>
        <p class="text-xs text-text-muted">{selectionKinds}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        title="Let go of all {selected.length} selected charges"
        aria-label="Let go of all {selected.length} selected charges"
        onclick={onLetGo}
      >
        <X class="size-16" aria-hidden="true" />
      </Button>
    </header>
    <div class="flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto p-16">
      <dl class="flex flex-col gap-4 text-sm">
        {@render fact(
          "Net Amount",
          money(selected.reduce((total, charge) => total + charge.amountMinor, 0)),
        )}
      </dl>
      <p class="text-sm text-text-muted">
        Fee charges are invoice evidence: nothing here submits, approves or voids. Corrections happen
        in the register, as credit notes beside the bill.
      </p>
    </div>
  {:else}
    <header class="border-b border-border-default p-12">
      <h2 class="text-base leading-tight font-semibold">The Agreement</h2>
      <p class="text-xs text-text-muted">Select a charge for its details</p>
    </header>
    <div class="flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto p-16">
      <dl class="flex flex-col gap-4 text-sm">
        {@render fact(
          "Billed As",
          inForce === null ? "Hourly, by absence" : ARRANGEMENT_KIND_LABELS[inForce.kind],
          inForce === null
            ? "No agreement was ever recorded, and a matter with none is billed hourly."
            : undefined,
        )}
        {@render fact(
          "In Force Since",
          inForce === null ? "Not recorded" : formatDate(inForce.validFrom),
        )}
        {@render fact(
          "Version",
          inForce === null ? "None" : `${String(inForce.version)} of ${String(history.length)}`,
        )}
        {@render fact(
          "Recorded By",
          "Not carried by this read",
          "Who recorded a version is on the firm's audit trail; the agreement read does not carry it.",
        )}
      </dl>
      <p class="text-xs text-text-muted">{arrangementTerms(inForce, money)}</p>

      <section class="flex flex-col gap-8 border-t border-border-default pt-12">
        <h3 class="text-xs text-text-subtle uppercase">Fee Position</h3>
        <dl class="flex flex-col gap-4 text-sm">
          {@render fact(
            "Unbilled",
            money(position.unbilledMinor),
            "Billable time on this matter that no bill has taken up, priced at its resolved rates. It becomes the next fee line when a draft bill claims it.",
          )}
          {@render fact("Billed", money(position.billedMinor))}
          {@render fact(
            "Collected",
            money(position.collectedMinor),
            "Fees the client has actually paid, net of the credit notes recorded beside the bills.",
          )}
        </dl>
      </section>

      {#if history.length > 0}
        <section class="flex flex-col gap-8 border-t border-border-default pt-12">
          <h3 class="text-xs text-text-subtle uppercase">Versions</h3>
          <ul class="flex flex-col gap-8">
            {#each history as version (version.id)}
              <li class="flex flex-col gap-4 text-sm">
                <span class="font-semibold">{versionTitle(version)}</span>
                <span class="text-xs text-text-subtle tabular-nums">
                  {versionPeriod(version, (isoDate) => formatDate(isoDate))}
                </span>
                <span class="text-xs text-text-muted">{arrangementTerms(version, money)}</span>
              </li>
            {/each}
          </ul>
          <p class="text-xs text-text-subtle">{AMENDMENT_STANDING_NOTE}</p>
        </section>
      {/if}
    </div>
  {/if}
</aside>
