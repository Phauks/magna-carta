<script lang="ts">
  /*
   * The details panel: everything about one bill, beside the register.
   *
   * THREE FACES, ONE PANEL. Nothing selected, it speaks for the matter's billing position. One bill
   * selected, it shows that bill — its verbs, where it has got to, its identity, and either the
   * draft workbench or the finalized record. Several selected, it counts them and offers nothing:
   * there is no bulk act on invoice evidence, and a panel that implied one would be lying.
   *
   * THE VERBS LIVE AT THE TOP AND THE FACTS BELOW THEM. A person who opened a bill came either to
   * read it or to act on it, and the acts are the shorter list.
   *
   * WHAT CANNOT BE SERVED STILL RENDERS. The claims a draft holds, the applications against a
   * finalized bill, and the trust transfer all have real anatomy here with their affordances
   * disabled and the dependency named. The alternative — leaving them out — would show a bill that
   * looks complete and is not.
   */
  import * as Card from "@magna-carta/design-system/card";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EventRail from "@magna-carta/design-system/event-rail";
  import ProgressSteps from "@magna-carta/design-system/progress-steps";
  import RecordChain from "@magna-carta/design-system/record-chain";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import type { ProgressStep } from "@magna-carta/design-system/progress-steps";
  import Plus from "@lucide/svelte/icons/plus";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import X from "@lucide/svelte/icons/x";
  import SoonAffordance from "$lib/maturity/soon-affordance.svelte";
  import type { CostSummary } from "$lib/matters/cost-api.ts";
  import type { TimeEntrySummary } from "$lib/matters/time-api.ts";
  import type { ClientCredit, InvoiceDelivery, InvoiceLine } from "./billing-api.ts";
  import { BILL_DEPENDENCIES, billActions, type BillActionContext } from "./bill-actions.ts";
  import type { BillFigure } from "./bill-figures.ts";
  import {
    billLockLine,
    billStage,
    billUnpaidMinor,
    draftTotalMinor,
    invoiceStanding,
    type InvoiceRow,
  } from "./invoice-standing.ts";

  let {
    row,
    selectedCount,
    matterId,
    clientName,
    currency,
    figures,
    actionContext,
    deliveries,
    clientCredits,
    unbilledTime,
    unbilledCosts,
    claiming,
    onAction,
    onEditLine,
    onClaim,
    onClaimAll,
    onLetGo,
  }: {
    /** The bill the panel speaks for, or null where nothing (or more than one) is selected. */
    row: InvoiceRow | null;
    selectedCount: number;
    matterId: string;
    clientName: string;
    currency: string;
    /** The matter's own money figures, for the face the panel shows with nothing selected. */
    figures: readonly BillFigure[];
    actionContext: BillActionContext;
    /** The bill's delivery attempts, or null while unread. */
    deliveries: readonly InvoiceDelivery[] | null;
    /** The client credits this bill's own corrections opened. */
    clientCredits: readonly ClientCredit[];
    /** Time on this matter that no draft holds and no bill has taken up. */
    unbilledTime: readonly TimeEntrySummary[];
    unbilledCosts: readonly CostSummary[];
    /** The source id currently being claimed, so its control says so rather than sitting silent. */
    claiming: string | null;
    onAction: (identifier: string) => void;
    onEditLine: (line: InvoiceLine) => void;
    onClaim: (claim: { sourceKind: "time_entry" | "cost_entry"; sourceId: string }) => void;
    onClaimAll: (kind: "time_entry" | "cost_entry") => void;
    onLetGo: () => void;
  } = $props();

  const money = (amountMinor: number): string => formatMoney(amountMinor / 100, { currency });

  const standing = $derived(row === null ? null : invoiceStanding(row));
  const heading = $derived.by((): string => {
    if (row === null) return "";
    if (row.summary.invoiceNumber !== null) return `Invoice ${row.summary.invoiceNumber}`;
    return row.summary.status === "draft" ? "Draft Bill" : "Voided Draft";
  });

  /** The bill's own chain. Not the workflow chain: a bill is drafted, finalized, and then paid. */
  const chain = $derived.by((): readonly ProgressStep[] => {
    if (row === null) return [];
    const stage = billStage(row);
    const reached = stage === "draft" ? 0 : stage === "finalized" ? 1 : 2;
    return ["Draft", "Finalized", "Paid"].map((label, index) => ({
      label,
      status: index < reached ? "done" : index === reached ? "active" : "pending",
    }));
  });

  const actions = $derived(row === null ? [] : billActions(row, actionContext));

  const lines = $derived(row?.detail?.lines ?? []);
  const balances = $derived(row?.detail?.matterBalances ?? []);
  const creditNotes = $derived(row?.creditNotes ?? []);
  const openedCredits = $derived(
    clientCredits.filter((credit) => creditNotes.some((note) => note.id === credit.creditNoteId)),
  );

  /** The delivery attempts as the product's one history rail reads them, oldest first. */
  const deliveryEvents = $derived(
    (deliveries ?? [])
      .map((delivery) => ({
        id: delivery.id,
        action: `${delivery.channel} — ${delivery.outcome}`,
        at: delivery.recordedAt,
        source: delivery.recordedBy ?? "The firm",
        detail: `To ${delivery.recipientReference}, on ${formatDate(delivery.deliveryDate)}${
          delivery.externalReference === null ? "" : ` · ${delivery.externalReference}`
        }`,
      }))
      .toReversed(),
  );

  const unbilledTimeMinor = $derived(
    unbilledTime.reduce((total, entry) => total + (entry.amountMinor ?? 0), 0),
  );
  const unbilledCostMinor = $derived(
    unbilledCosts.reduce((total, cost) => total + cost.amountMinor, 0),
  );
</script>

{#snippet fact(label: string, value: string, title?: string)}
  <div class="flex items-baseline justify-between gap-16">
    <dt class="text-text-muted">{label}</dt>
    <dd class="text-right tabular-nums" {title}>{value}</dd>
  </div>
{/snippet}

<aside
  class="flex h-full w-full flex-col border-l border-border-default bg-surface-default"
  aria-label="Bill details"
>
  {#if row !== null && standing !== null}
    <header class="flex items-start gap-8 border-b border-border-default p-12">
      <div class="min-w-0 flex-1">
        <h2 class="text-base leading-tight font-semibold">{heading}</h2>
        <p class="text-xs text-text-muted">{clientName}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        title="Let go of this bill and show the matter's position"
        aria-label="Let go of this bill and show the matter's position"
        onclick={onLetGo}
      >
        <X class="size-16" aria-hidden="true" />
      </Button>
    </header>

    <div class="flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto p-16">
      <!-- The verbs. A refusal and a not-yet-built dependency both stay on screen, and read
           differently: one says this bill cannot take it, the other says nobody can yet. -->
      <div class="flex flex-wrap gap-8">
        {#each actions as action (action.identifier)}
          {#if action.identifier === "open" || action.identifier === "copyNumber"}
            <!-- The panel IS the open, and the copy lives on the row menu where a value is copied. -->
          {:else if action.soonDependency !== undefined}
            <SoonAffordance reason={action.soonDependency}>
              {#snippet control(soon)}
                {@const Icon = action.icon}
                <Button variant="secondary" size="sm" {...soon}>
                  <Icon class="size-16" aria-hidden="true" />
                  {action.label}
                </Button>
              {/snippet}
            </SoonAffordance>
          {:else}
            {@const Icon = action.icon}
            <Button
              variant="secondary"
              size="sm"
              disabled={action.disabledReason !== undefined}
              title={action.disabledReason ?? action.label}
              onclick={() => onAction(action.identifier)}
            >
              <Icon class="size-16" aria-hidden="true" />
              {action.label}
            </Button>
          {/if}
        {/each}
      </div>

      {#if row.summary.status !== "void"}
        <ProgressSteps steps={chain} />
      {/if}
      <RecordChain
        current={billStage(row) === "paid" ? "paid" : "billed"}
        lock={{ reason: billLockLine(row) }}
      />

      <dl class="flex flex-col gap-4 border-t border-border-default pt-12 text-sm">
        <div class="flex items-baseline justify-between gap-16">
          <dt class="text-text-muted">Status</dt>
          <dd>
            <Badge {...statusBadgeAttributes(standing)}>{statusEntry(standing).label}</Badge>
          </dd>
        </div>
        {@render fact("Client", clientName)}
        {@render fact(
          "Matters",
          balances.length > 0
            ? `${String(balances.length)} on this bill`
            : `${String(new Set(lines.map((line) => line.matterId)).size)} on this draft`,
          "An invoice belongs to one client and may bill several of that client's matters.",
        )}
        {@render fact("Issued", row.summary.issueDate === null ? "Not issued" : formatDate(row.summary.issueDate))}
        {@render fact("Due", row.summary.dueDate === null ? "Not due" : formatDate(row.summary.dueDate))}
        {@render fact(
          "Finalized By",
          "Not carried by this read",
          "Who drew the number is recorded on the firm's audit trail; the invoice read does not carry it.",
        )}
        {@render fact("Created", formatDate(row.summary.createdAt))}
        {@render fact(
          "Presentation",
          "Not carried by this read",
          "How a bill spanning several matters is presented is snapshot onto the invoice at finalization; the invoice read does not carry it back.",
        )}
      </dl>

      {#if row.summary.status === "draft"}
        <!-- The draft workbench: what this draft is holding, and what is still waiting outside it. -->
        <section class="flex flex-col gap-8 border-t border-border-default pt-12">
          <h3 class="flex items-baseline justify-between gap-8 text-xs text-text-subtle uppercase">
            On This Draft
            <span class="tabular-nums normal-case">
              {lines.length} · {money(draftTotalMinor(row.detail))}
            </span>
          </h3>
          {#if lines.length === 0}
            <p class="text-xs text-text-muted">
              Nothing has been claimed onto this draft yet. Claim work from the list below.
            </p>
          {:else}
            <ul class="flex flex-col">
              {#each lines as line (line.id)}
                <li
                  class="flex items-start gap-8 border-b border-border-default py-4 text-sm last:border-b-0"
                >
                  <span class="min-w-0 flex-1">
                    {line.description}
                    <span class="block text-xs text-text-subtle">
                      {line.kind}{line.matterId === matterId ? "" : " · another matter of this client"}
                    </span>
                  </span>
                  <span class="tabular-nums whitespace-nowrap">{money(line.amountMinor)}</span>
                  <span class="flex gap-4">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Edit this line: what the client is told. The underlying entry stays the timekeeper's own record."
                      aria-label="Edit this line"
                      onclick={() => onEditLine(line)}
                    >
                      <SquarePen class="size-12" aria-hidden="true" />
                    </Button>
                  </span>
                </li>
              {/each}
            </ul>
            <SoonAffordance reason={BILL_DEPENDENCIES.claims} reasonPlacement="line">
              {#snippet control(soon)}
                <Button variant="secondary" size="sm" {...soon}>
                  <X class="size-16" aria-hidden="true" />
                  Release a Claim
                </Button>
              {/snippet}
            </SoonAffordance>
          {/if}
          <p class="text-xs text-text-subtle">
            The draft total is computed from its lines; balances are created at finalization.
          </p>
        </section>

        <section class="flex flex-col gap-12 border-t border-border-default pt-12">
          <h3 class="text-xs text-text-subtle uppercase">Unbilled On This Matter</h3>

          <Card.Root class="gap-8 py-12">
            <Card.Header class="flex-row items-baseline gap-8 px-12">
              <Card.Title class="flex-1 text-xs text-text-muted uppercase">Unbilled Time</Card.Title>
              <span class="text-xs tabular-nums">
                {unbilledTime.length} · {money(unbilledTimeMinor)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={unbilledTime.length === 0 || claiming !== null}
                title="Claim every unbilled time entry onto this draft"
                onclick={() => onClaimAll("time_entry")}
              >
                Claim all
              </Button>
            </Card.Header>
            <Card.Content class="px-12">
              {#if unbilledTime.length === 0}
                <p class="text-xs text-text-muted">
                  Nothing unbilled remains: every billable entry is claimed or billed.
                </p>
              {:else}
                <ul class="flex flex-col">
                  {#each unbilledTime as entry (entry.id)}
                    <li
                      class="flex items-start gap-8 border-b border-border-default py-4 text-sm last:border-b-0"
                    >
                      <span class="min-w-0 flex-1">
                        {entry.narrative}
                        <span class="block text-xs text-text-subtle">
                          {formatDate(entry.workDate)} · {statusEntry(entry.status).label}
                        </span>
                      </span>
                      <span class="tabular-nums whitespace-nowrap">
                        {money(entry.amountMinor ?? 0)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={claiming !== null}
                        title="Claim this entry onto the draft. An entry another draft holds is refused by name."
                        aria-label="Claim this entry onto the draft"
                        onclick={() => onClaim({ sourceKind: "time_entry", sourceId: entry.id })}
                      >
                        <Plus class="size-12" aria-hidden="true" />
                      </Button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </Card.Content>
          </Card.Root>

          <Card.Root class="gap-8 py-12">
            <Card.Header class="flex-row items-baseline gap-8 px-12">
              <Card.Title class="flex-1 text-xs text-text-muted uppercase">
                Unbilled Costs
              </Card.Title>
              <span class="text-xs tabular-nums">
                {unbilledCosts.length} · {money(unbilledCostMinor)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={unbilledCosts.length === 0 || claiming !== null}
                title="Claim every unbilled cost onto this draft"
                onclick={() => onClaimAll("cost_entry")}
              >
                Claim all
              </Button>
            </Card.Header>
            <Card.Content class="px-12">
              {#if unbilledCosts.length === 0}
                <p class="text-xs text-text-muted">
                  Nothing unbilled remains: every recoverable cost is claimed or billed.
                </p>
              {:else}
                <ul class="flex flex-col">
                  {#each unbilledCosts as cost (cost.id)}
                    <li
                      class="flex items-start gap-8 border-b border-border-default py-4 text-sm last:border-b-0"
                    >
                      <span class="min-w-0 flex-1">
                        {cost.description}
                        <span class="block text-xs text-text-subtle">
                          {formatDate(cost.incurredDate)} · {cost.disbursementClass === "hard"
                            ? "advanced (hard)"
                            : "in-house (soft)"}
                        </span>
                      </span>
                      <span class="tabular-nums whitespace-nowrap">{money(cost.amountMinor)}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={claiming !== null}
                        title="Claim this cost onto the draft"
                        aria-label="Claim this cost onto the draft"
                        onclick={() => onClaim({ sourceKind: "cost_entry", sourceId: cost.id })}
                      >
                        <Plus class="size-12" aria-hidden="true" />
                      </Button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </Card.Content>
          </Card.Root>
        </section>
      {:else if row.summary.status === "final"}
        <section class="flex flex-col gap-8 border-t border-border-default pt-12">
          <h3 class="flex items-baseline justify-between gap-8 text-xs text-text-subtle uppercase">
            Lines
            <span class="tabular-nums normal-case">
              {lines.length} · {money(row.summary.totalMinor)}
            </span>
          </h3>
          <ul class="flex flex-col">
            {#each lines as line (line.id)}
              <li
                class="flex items-start gap-8 border-b border-border-default py-4 text-sm last:border-b-0"
              >
                <span class="min-w-0 flex-1">
                  {line.description}
                  {#if balances.length > 1}
                    <span class="block text-xs text-text-subtle">
                      {line.matterId === matterId ? "This matter" : "Another matter of this client"}
                    </span>
                  {/if}
                </span>
                <span class="tabular-nums whitespace-nowrap">{money(line.amountMinor)}</span>
              </li>
            {/each}
          </ul>
        </section>

        <section class="flex flex-col gap-8 border-t border-border-default pt-12">
          <h3 class="text-xs text-text-subtle uppercase">Balance</h3>
          <DataTable.Root>
            <DataTable.Caption class="sr-only">
              What each matter on this bill owes
            </DataTable.Caption>
            <DataTable.Header>
              <DataTable.Row>
                <DataTable.Head>Matter</DataTable.Head>
                <DataTable.Head data-align="end">Total</DataTable.Head>
                <DataTable.Head data-align="end">Applied</DataTable.Head>
                <DataTable.Head data-align="end">Unpaid</DataTable.Head>
              </DataTable.Row>
            </DataTable.Header>
            <DataTable.Body>
              {#each balances as balance (balance.matterId)}
                <DataTable.Row>
                  <DataTable.Cell>
                    {balance.matterId === matterId ? "This matter" : "Another matter"}
                  </DataTable.Cell>
                  <DataTable.Cell data-align="end">{money(balance.totalMinor)}</DataTable.Cell>
                  <DataTable.Cell data-align="end">{money(balance.appliedMinor)}</DataTable.Cell>
                  <DataTable.Cell data-align="end">{money(balance.unpaidMinor)}</DataTable.Cell>
                </DataTable.Row>
              {/each}
              {#if balances.length > 1}
                <DataTable.Row>
                  <DataTable.Cell>Whole bill</DataTable.Cell>
                  <DataTable.Cell data-align="end">{money(row.summary.totalMinor)}</DataTable.Cell>
                  <DataTable.Cell data-align="end">{money(row.summary.appliedMinor)}</DataTable.Cell>
                  <DataTable.Cell data-align="end">{money(billUnpaidMinor(row))}</DataTable.Cell>
                </DataTable.Row>
              {/if}
            </DataTable.Body>
          </DataTable.Root>
          <p class="text-xs text-text-muted">
            Unpaid is worked out from the per-matter balances, never stored, so it can never drift
            from what was applied.
          </p>
        </section>

        <section class="flex flex-col gap-8 border-t border-border-default pt-12">
          <h3 class="flex items-baseline justify-between gap-8 text-xs text-text-subtle uppercase">
            Applied To This Bill
            <span class="tabular-nums normal-case">{money(row.summary.appliedMinor)}</span>
          </h3>
          {#if row.summary.appliedMinor === 0}
            <p class="text-xs text-text-muted">Nothing has been applied to this bill.</p>
          {:else}
            <p class="text-xs text-text-muted">
              {money(row.summary.appliedMinor)} has been applied. Which applications made it up —
              trust transfers, credit notes, write-offs — and who made each of them is not read here
              yet.
            </p>
          {/if}
          <SoonAffordance reason={BILL_DEPENDENCIES.applications} reasonPlacement="line">
            {#snippet control(soon)}
              <Button variant="secondary" size="sm" {...soon}>Show Each Application</Button>
            {/snippet}
          </SoonAffordance>
        </section>

        <section class="flex flex-col gap-8 border-t border-border-default pt-12">
          <h3 class="text-xs text-text-subtle uppercase">Delivery</h3>
          {#if deliveries === null}
            <p class="text-xs text-text-muted">Reading this bill&rsquo;s delivery record.</p>
          {:else if deliveryEvents.length === 0}
            <p class="text-xs text-status-warning-subtle-foreground">
              No delivery of this bill has been recorded. The platform records deliveries the firm
              made; it sends nothing itself.
            </p>
          {:else}
            <EventRail events={deliveryEvents} label="This bill's delivery attempts" />
          {/if}
        </section>

        {#if creditNotes.length > 0}
          <section class="flex flex-col gap-8 border-t border-border-default pt-12">
            <h3 class="text-xs text-text-subtle uppercase">Corrections</h3>
            {#each creditNotes as note (note.id)}
              <Card.Root class="gap-8 py-12">
                <Card.Header class="flex-row items-baseline justify-between gap-8 px-12">
                  <Card.Title class="text-sm">
                    Credit note · {formatDate(note.effectiveDate)}
                  </Card.Title>
                  <span class="text-sm tabular-nums">{money(note.totalMinor)}</span>
                </Card.Header>
                <Card.Content class="flex flex-col gap-4 px-12">
                  <p class="text-xs text-text-muted">{note.reason}</p>
                  {#each note.lines as line (line.id)}
                    <p class="text-xs text-text-subtle">
                      {line.description}{line.creditsInvoiceLineId === null
                        ? " — a general credit against this bill"
                        : " — attributed to a charge on this bill"}
                    </p>
                  {/each}
                  <p class="text-xs text-text-subtle">
                    Credit notes carry no number yet: the numbering question is an open decision.
                  </p>
                </Card.Content>
              </Card.Root>
            {/each}
            <p class="text-xs text-text-muted">
              A credit note stands beside the bill forever. The bill keeps its number, its lines and
              its wording; only what is owed on it moved.
            </p>
          </section>
        {/if}

        {#if openedCredits.length > 0}
          <section class="flex flex-col gap-8 border-t border-border-default pt-12">
            <h3 class="text-xs text-text-subtle uppercase">
              Client Credit Opened By This Correction
            </h3>
            {#each openedCredits as credit (credit.id)}
              <Card.Root class="gap-8 py-12">
                <Card.Header class="flex-row items-baseline justify-between gap-8 px-12">
                  <Card.Title class="text-sm">Open credit — {clientName}</Card.Title>
                  <span class="text-sm tabular-nums">{money(credit.remainingMinor)}</span>
                </Card.Header>
                <Card.Content class="flex flex-col gap-4 px-12">
                  <p class="text-xs text-text-subtle">
                    Opened {formatDate(credit.openedAt)} by the credit note against this bill. The
                    firm holds money it has said is not its own; the matter will not close while this
                    is open.
                  </p>
                  <p class="text-xs text-text-subtle">
                    Three exits: set it against a later bill of this client, refund it from
                    operating, or return it to the client&rsquo;s trust ledger.
                  </p>
                </Card.Content>
              </Card.Root>
            {/each}
          </section>
        {/if}
      {/if}
    </div>
  {:else if selectedCount > 1}
    <header class="flex items-start gap-8 border-b border-border-default p-12">
      <div class="min-w-0 flex-1">
        <h2 class="text-base leading-tight font-semibold">{selectedCount} Bills Selected</h2>
        <p class="text-xs text-text-muted">Nothing here acts on more than one</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        title="Let go of all {selectedCount} selected bills"
        aria-label="Let go of all {selectedCount} selected bills"
        onclick={onLetGo}
      >
        <X class="size-16" aria-hidden="true" />
      </Button>
    </header>
    <div class="flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto p-16">
      <p class="text-sm text-text-muted">
        A bill is evidence: nothing here finalizes, credits or voids in bulk. Select one bill for its
        details and its verbs.
      </p>
    </div>
  {:else}
    <header class="border-b border-border-default p-12">
      <h2 class="text-base leading-tight font-semibold">This Matter&rsquo;s Billing</h2>
      <p class="text-xs text-text-muted">Select a bill for its details</p>
    </header>
    <div class="flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto p-16">
      <dl class="flex flex-col gap-4 text-sm">
        {#each figures as figure (figure.identifier)}
          {@render fact(
            figure.label.replace(/^./, (first) => first.toUpperCase()),
            money(figure.amountMinor),
            figure.caption,
          )}
        {/each}
      </dl>
      <p class="text-xs text-text-muted">
        An invoice belongs to one client and may bill several of that client&rsquo;s matters, so this
        register shows every bill of {clientName} and states this matter&rsquo;s own share of each.
      </p>
    </div>
  {/if}
</aside>
