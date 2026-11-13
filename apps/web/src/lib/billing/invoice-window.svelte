<script lang="ts">
  /*
   * An invoice, opened. Every operation on a bill lives here.
   *
   * THE SAME TWO-PANE WINDOW EVERY RECORD OPENS IN. Left is the bill itself — identity, lines and
   * totals, or, on a draft, the claim workbench. Right is the context a reader goes looking for
   * beside it: Payments & Credits, History, Delivery. Beneath both sits one action bar whose
   * geometry never changes.
   *
   * ONE ACTION BAR, FIXED. Every state renders its acts in the same place at the same size, and an
   * act this bill refuses is disabled with the reason rather than absent — so the bar never jumps as
   * a reader moves from a settled bill to an unpaid one, and nobody learns that a control they used
   * yesterday "disappears sometimes".
   *
   * THE DANGEROUS MONEY LIVES IN A TAB, NOT ON A LIST. Applying a client's trust funds, writing a
   * balance off, recording a correction that stands forever: each of those is reached by opening the
   * bill and looking at it, never by right-clicking a row.
   *
   * A BILL STATES "DRAFT" ONCE. A bill with no number is NAMED by its standing, so the chip beside
   * that heading would say the same word twice. The chip is dropped exactly where it repeats the
   * heading and kept in every state where it adds a fact.
   *
   * AN INVOICE IS NOT EDITED IN PLACE. The header's Edit is refused and says why: a draft changes by
   * claiming and releasing work, and a finalized bill is adjusted from the action bar with a
   * recorded revision. The header's Print gives the RECORD's sheet; the client-facing artifact is
   * the action bar's Print / PDF, and it is marked until a renderer exists.
   */
  import * as Card from "@magna-carta/design-system/card";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EventRail from "@magna-carta/design-system/event-rail";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import RecordWindow, { type RecordWindowTab } from "@magna-carta/design-system/record-window";
  import {
    RecordSubjectLine,
    type RecordSubject,
  } from "@magna-carta/design-system/record-reference";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { formatInstant, formatInstantDate } from "@magna-carta/design-system/formatters";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import type { EventRailEvent } from "@magna-carta/design-system/event-rail";
  import Calendar from "@lucide/svelte/icons/calendar";
  import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import CreditCard from "@lucide/svelte/icons/credit-card";
  import FileMinus from "@lucide/svelte/icons/file-minus";
  import Info from "@lucide/svelte/icons/info";
  import Plus from "@lucide/svelte/icons/plus";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import X from "@lucide/svelte/icons/x";
  import { SoonAffordance } from "@magna-carta/design-system/maturity";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import { billHref } from "$lib/money/index.ts";
  import type { CostSummary } from "$lib/matters/cost-api.ts";
  import type { TimeEntrySummary } from "$lib/matters/time-api.ts";
  import type { ClientCredit, InvoiceDelivery, InvoiceLine } from "./billing-api.ts";
  import {
    BILL_DEPENDENCIES,
    invoiceBarActions,
    invoiceMoneyActions,
    type BillActionContext,
  } from "./bill-actions.ts";
  import { invoiceRecordSheet } from "./invoice-print-sheet.ts";
  import { printSheetDates } from "$lib/print-sheet";
  import {
    billUnpaidMinor,
    creditedMinor,
    draftTotalMinor,
    invoiceReference,
    invoiceStanding,
    matterShareMinor,
    matterUnpaidMinor,
    overdueDays,
    type InvoiceRow,
  } from "./invoice-standing.ts";

  let {
    open = $bindable(false),
    row,
    matterId,
    matterTitle,
    matterNumber,
    clientName,
    currency,
    today,
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
  }: {
    open?: boolean;
    /** The bill the window is showing, or null while nothing is open. */
    row: InvoiceRow | null;
    /**
     * The matter the reader is standing in, or null on the firm's own register.
     *
     * With one, the window states this matter's share of the bill and marks the lines that belong
     * to it. Without one it states the document's own figures and nothing else — a bill may charge
     * several matters, and naming one of them because a reader happened to arrive from the firm's
     * register would be inventing a fact.
     */
    matterId: string | null;
    matterTitle: string | null;
    matterNumber: string | null;
    clientName: string;
    currency: string;
    /** Today, as the civil date the overdue arithmetic compares against. */
    today: string;
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
  } = $props();

  const money = (amountMinor: number): string => formatMoney(amountMinor / 100, { currency });

  let printOpen = $state(false);
  let disclosedLines = $state<readonly string[]>([]);

  const standing = $derived(row === null ? null : invoiceStanding(row));
  const isDraft = $derived(row?.summary.status === "draft");
  const isFinal = $derived(row?.summary.status === "final");
  const isVoid = $derived(row?.summary.status === "void");

  const subjectLine = $derived<RecordSubject>({
    reference: { kind: "Matter", number: matterNumber },
    facts: [clientName],
  });

  /** What the bill is NAMED. A bill with no number has only its standing to be called by. */
  const heading = $derived.by((): string => {
    if (row === null) return "";
    if (row.summary.invoiceNumber !== null) return `Invoice ${row.summary.invoiceNumber}`;
    return row.summary.status === "draft" ? "Draft Bill" : "Voided Draft";
  });

  /**
   * Whether the standing chip beside the heading would only repeat it.
   *
   * The chip is the status register's home everywhere else and stays that; what goes is the
   * repetition. A finalized bill still shows Unpaid, Partially Paid or Paid, because those add a
   * fact the heading does not carry.
   */
  const chipAddsAFact = $derived.by((): boolean => {
    if (standing === null) return false;
    return !heading.toLowerCase().includes(statusEntry(standing).label.toLowerCase());
  });

  const lines = $derived(row?.detail?.lines ?? []);
  const creditNotes = $derived(row?.creditNotes ?? []);
  const openedCredits = $derived(
    clientCredits.filter((credit) => creditNotes.some((note) => note.id === credit.creditNoteId)),
  );
  const share = $derived(
    row === null || matterId === null ? null : matterShareMinor(row, matterId),
  );
  /**
   * Which matters the bill charges, named — the firm register's answer.
   *
   * The lines rather than the balances, because a DRAFT has lines and no balance row: balances are
   * created at finalization, so reading the balances would say a draft charges nobody. Both carry
   * the name, so either would do on a finalized bill and only one works on both.
   *
   * A matter the read could not name still appears, under a phrase that says so. Dropping it would
   * make a bill look like it charges fewer matters than it does, which is a worse answer than an
   * unnamed row — and the link still works, because the identifier is what the address needs.
   */
  const chargedMatters = $derived.by(() => {
    const seen = new Map<string, { identifier: string; name: string; named: boolean }>();
    for (const line of lines) {
      if (seen.has(line.matterId)) continue;
      const title = line.matterTitle;
      seen.set(line.matterId, {
        identifier: line.matterId,
        name:
          title === null
            ? "A matter this read could not name"
            : line.matterNumber === null
              ? title
              : `${line.matterNumber} — ${title}`,
        named: title !== null,
      });
    }
    return [...seen.values()];
  });
  const matterCount = $derived(chargedMatters.length);
  const credited = $derived(row === null ? 0 : creditedMinor(row));
  const late = $derived(row === null ? 0 : overdueDays(row, today));

  const barActions = $derived(row === null ? [] : invoiceBarActions(row, actionContext));
  const moneyActions = $derived(row === null ? [] : invoiceMoneyActions(row, actionContext));

  const unbilledTimeMinor = $derived(
    unbilledTime.reduce((total, entry) => total + (entry.amountMinor ?? 0), 0),
  );
  const unbilledCostMinor = $derived(
    unbilledCosts.reduce((total, cost) => total + cost.amountMinor, 0),
  );

  /**
   * The bill's history, out of the facts the reads actually carry.
   *
   * Created and finalized are real dates on the summary and are stated as events. The rest of an
   * invoice's life — who finalized it, every application, every revision — is recorded on the
   * firm's audit trail and served by nothing, so the rail says what it waits on rather than
   * presenting a two-event history as the whole story.
   */
  const historyEvents = $derived.by((): readonly EventRailEvent[] => {
    if (row === null) return [];
    const events: EventRailEvent[] = [
      {
        id: `${row.summary.id}-created`,
        action: "Created as a draft",
        at: row.summary.createdAt,
        source: "The firm",
      },
    ];
    if (row.summary.status === "final" && row.summary.issueDate !== null) {
      events.push({
        id: `${row.summary.id}-finalized`,
        action: `Finalized as ${row.summary.invoiceNumber ?? "an invoice"}`,
        at: `${row.summary.issueDate}T00:00:00Z`,
        source: "The firm",
      });
    }
    for (const note of creditNotes) {
      events.push({
        id: `${note.id}-issued`,
        action: `Credit note recorded beside the bill — ${money(note.totalMinor)}`,
        at: note.issuedAt,
        source: "The firm",
        detail: note.reason,
      });
    }
    return events.toSorted((left, right) => String(left.at).localeCompare(String(right.at)));
  });

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

  const sheet = $derived(
    row === null
      ? null
      : invoiceRecordSheet(row, {
          matterId,
          matterTitle,
          matterNumber,
          clientName,
          money: (amount) => formatMoney(amount, { currency }),
          ...printSheetDates(),
          printedAt: formatInstant(new Date()),
        }),
  );

  function toggleDisclosure(lineId: string): void {
    disclosedLines = disclosedLines.includes(lineId)
      ? disclosedLines.filter((identifier) => identifier !== lineId)
      : [...disclosedLines, lineId];
  }
</script>

{#snippet figure(label: string, amountMinor: number)}
  <span class="inline-flex items-baseline gap-4">
    <span class="text-xs text-text-subtle">{label}</span>
    <span class="font-semibold tabular-nums">{money(amountMinor)}</span>
  </span>
{/snippet}

{#snippet fact(label: string, value: string, title?: string)}
  <div class="flex items-baseline justify-between gap-16">
    <dt class="text-text-muted">{label}</dt>
    <dd class="text-right tabular-nums" {title}>{value}</dd>
  </div>
{/snippet}

{#snippet subtitle()}
  <!-- The bill's own number is its HEADING — a bill is called "Invoice 2026-0147" — so this line
       names who it is for and which matter it is on, and never repeats the number above it. -->
  <RecordSubjectLine subject={subjectLine} />
  {#if row !== null && standing !== null && chipAddsAFact}
    <Badge {...statusBadgeAttributes(standing)}>{statusEntry(standing).label}</Badge>
  {/if}
{/snippet}

<!-- LEFT: the bill itself, or the workbench that is about to become one. -->
{#snippet record()}
  {#if row === null}
    <!-- structured-empty-allow: the window opens on a bill and closes with it; a null row is the
         closed window's type narrowing, not a bill whose facts are still arriving -->
    <p class="text-sm text-text-muted">No bill is open.</p>
  {:else}
    <div class="flex flex-col gap-16">
      {#if isVoid}
        <p class="flex items-start gap-8 text-sm text-text-muted">
          <Info class="mt-4 size-16 shrink-0" aria-hidden="true" />
          <span>
            This draft was voided. Its claims returned to unbilled work and nothing was ever
            charged.
          </span>
        </p>
      {/if}

      <div class="flex flex-wrap items-baseline gap-16">
        {#if isDraft}
          {@render figure("draft total", draftTotalMinor(row.detail))}
        {:else if isFinal}
          {@render figure("total", row.summary.totalMinor)}
          {@render figure("applied", row.summary.appliedMinor)}
          {@render figure("unpaid", billUnpaidMinor(row))}
          {#if credited > 0}
            {@render figure("credited", credited)}
          {/if}
        {/if}
      </div>

      <dl class="flex flex-col gap-4 text-sm">
        {@render fact("Client", clientName)}
        {#if matterTitle !== null}
          {@render fact(
            "Matter",
            matterNumber === null ? matterTitle : `${matterNumber} — ${matterTitle}`,
          )}
        {:else if matterCount > 0}
          <!-- Across the firm the bill answers for itself: how many matters it charges, from its
               own lines. One is stated as one so a reader is never left to wonder. -->
          {@render fact(
            "Matters",
            matterCount === 1 ? "One matter" : `${matterCount} matters`,
            "A bill belongs to a client and may charge several of that client's matters; each one is named below with the way into it.",
          )}
        {/if}
        {#if share !== null}
          {@render fact(
            "This Matter",
            money(share),
            isDraft
              ? "Computed from the draft's lines. A draft has no stored total: its figure moves as work is claimed and released."
              : undefined,
          )}
        {/if}
        {#if isFinal}
          {@render fact(
            "Issued",
            row.summary.issueDate === null ? "Not issued" : formatDate(row.summary.issueDate),
          )}
          {#if row.summary.dueDate !== null}
            <div class="flex items-baseline justify-between gap-16">
              <dt class="text-text-muted">Due</dt>
              <dd
                class="text-right tabular-nums {late > 0
                  ? 'font-semibold text-status-danger-subtle-foreground'
                  : ''}"
                title={late > 0
                  ? "Overdue is worked out from the date at the moment of asking; it is never a stored flag."
                  : undefined}
              >
                {formatDate(row.summary.dueDate)}{late > 0 ? ` · ${late} days past due` : ""}
              </dd>
            </div>
          {/if}
          {#if matterId !== null}
            {@render fact(
              "Unpaid, this matter",
              (() => {
                const owed = matterUnpaidMinor(row, matterId);
                return owed === null ? "—" : money(owed);
              })(),
            )}
          {/if}
        {/if}
        {@render fact("Created", formatInstantDate(row.summary.createdAt))}
        {@render fact(
          "Finalized By",
          "Not carried by this read",
          "Who drew the number is on the firm's audit trail; the invoice read does not carry it.",
        )}
      </dl>

      <!-- The way into the matter, from a bill met outside one. Standing in a matter there is
           nowhere to go; standing across the firm this is where the acts on this bill live, and
           where the work behind its lines is. -->
      {#if matterId === null && chargedMatters.length > 0}
        <section class="flex flex-col gap-8 border-t border-border-default pt-12">
          <FieldLabel as="h3">
            {chargedMatters.length === 1 ? "The Matter This Bills" : "The Matters This Bills"}
          </FieldLabel>
          <!-- One link per matter, each named. A bill that charges three of a client's matters has
               three places its acts could be taken from, and which one a reader wants is a choice
               only they can make — so the window offers all of them rather than picking. -->
          <ul class="flex flex-col items-start gap-4">
            {#each chargedMatters as charged (charged.identifier)}
              <li>
                <Button
                  variant="secondary"
                  size="sm"
                  href={billHref(charged.identifier, row.summary.id)}
                  title="Open this bill on this matter's own Billing section, where the acts against it live."
                >
                  <ArrowUpRight class="size-16" aria-hidden="true" />
                  <span class:text-text-muted={!charged.named}>{charged.name}</span>
                </Button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if isFinal}
        <!-- The lines, each disclosing the work behind it. -->
        <section class="flex flex-col gap-8 border-t border-border-default pt-12">
          <FieldLabel as="h3" class="flex items-baseline justify-between gap-8">
            Lines
            <span class="tabular-nums normal-case">
              {lines.length} · {money(row.summary.totalMinor)}
            </span>
          </FieldLabel>
          <ul class="flex flex-col">
            {#each lines as line (line.id)}
              <li class="flex flex-col gap-4 border-b border-border-default py-8 last:border-b-0">
                <div class="flex items-start gap-8 text-sm">
                  <span class="min-w-0 flex-1">{line.description}</span>
                  <span class="tabular-nums whitespace-nowrap">{money(line.amountMinor)}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  class="self-start"
                  aria-expanded={disclosedLines.includes(line.id)}
                  title="Show the work this line was composed from"
                  onclick={() => toggleDisclosure(line.id)}
                >
                  <ChevronRight class="size-12" aria-hidden="true" />
                  Source entries
                </Button>
                {#if disclosedLines.includes(line.id)}
                  <p class="text-xs text-text-muted">
                    Not built yet. Waiting on {BILL_DEPENDENCIES.claims} — the entries this line
                    consolidated are recorded as claims, and the invoice read carries the lines
                    without them.
                  </p>
                {/if}
              </li>
            {/each}
          </ul>
        </section>

        <section class="flex flex-col gap-8 border-t border-border-default pt-12">
          <FieldLabel as="h3">Revisions</FieldLabel>
          <p class="text-xs text-text-muted">
            An adjustment to a finalized bill lands here as a numbered, reasoned revision: what
            changed, who changed it, and when. The number never changes.
          </p>
          <SoonAffordance reason={BILL_DEPENDENCIES.adjustment} reasonPlacement="line">
            {#snippet control(soon)}
              <Button variant="secondary" size="sm" {...soon}>
                <SquarePen class="size-16" aria-hidden="true" />
                Adjust Invoice
              </Button>
            {/snippet}
          </SoonAffordance>
        </section>
      {:else if isDraft}
        <!-- The claim workbench: what this draft holds, and what is still waiting outside it. -->
        <section class="flex flex-col gap-8 border-t border-border-default pt-12">
          <FieldLabel as="h3" class="flex items-baseline justify-between gap-8">
            On This Draft
            <span class="tabular-nums normal-case">
              {lines.length} · {money(draftTotalMinor(row.detail))}
            </span>
          </FieldLabel>
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
                    <!-- The marker says which lines are NOT the reader's matter, which is only a
                         question when a reader is standing in one. Across the firm every line is
                         the bill's own and the note would be on all of them or none. -->
                    <span class="block text-xs text-text-subtle">
                      {line.kind}{matterId === null || line.matterId === matterId
                        ? ""
                        : " · another matter of this client"}
                    </span>
                  </span>
                  <span class="tabular-nums whitespace-nowrap">{money(line.amountMinor)}</span>
                  <span class="flex gap-4">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Edit this line. Only what the client sees changes; the original record stays the same."
                      aria-label="Edit this line"
                      onclick={() => onEditLine(line)}
                    >
                      <SquarePen class="size-12" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled
                      title="Not built yet. Waiting on {BILL_DEPENDENCIES.claims}. Releasing a claim returns the work to unbilled; the released claim stays on record."
                      aria-label="Release this claim"
                    >
                      <X class="size-12" aria-hidden="true" />
                    </Button>
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
          <p class="text-xs text-text-subtle">
            The draft total is computed from its claims; balances are created at finalization.
          </p>
        </section>

        <section class="flex flex-col gap-12 border-t border-border-default pt-12">
          <FieldLabel as="h3">Unbilled On This Matter</FieldLabel>

          <Card.Root class="gap-8 py-12">
            <Card.Header class="flex-row items-baseline gap-8 px-12">
              <FieldLabel as="div" class="flex-1">Unbilled Time</FieldLabel>
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

          <!--
            Unbilled fees stand where the design puts them and say what they wait on. A fee is a
            first-class work-in-progress record a draft claims exactly as it claims a cost; nothing
            serves that record yet, so the group renders empty rather than being left out of a
            workbench that would otherwise look complete.
          -->
          <Card.Root class="gap-8 py-12">
            <Card.Header class="flex-row items-baseline gap-8 px-12">
              <FieldLabel as="div" class="flex-1">Unbilled Fees</FieldLabel>
              <SoonAffordance reason="the fee work-in-progress store and its claim path">
                {#snippet control(soon)}
                  <Button variant="ghost" size="sm" {...soon}>Claim all</Button>
                {/snippet}
              </SoonAffordance>
            </Card.Header>
            <Card.Content class="px-12">
              <p class="text-xs text-text-muted">
                A fee is a flat charge recorded by hand on the Fees tab, and a draft bill claims it
                like any work in progress. The record it claims is not served yet.
              </p>
            </Card.Content>
          </Card.Root>

          <Card.Root class="gap-8 py-12">
            <Card.Header class="flex-row items-baseline gap-8 px-12">
              <FieldLabel as="div" class="flex-1">
                Unbilled Costs
              </FieldLabel>
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
                  Nothing unbilled remains: every billable cost is claimed or billed.
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
                          {formatDate(cost.incurredDate)}
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
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet moneyTab()}
  <div class="flex flex-col gap-16">
    {#if row === null}
      <p class="text-sm text-text-muted">No bill is open.</p>
    {:else if !isFinal}
      <p class="flex items-start gap-8 text-sm text-text-muted">
        <Info class="mt-4 size-16 shrink-0" aria-hidden="true" />
        <span>
          {isDraft
            ? "A draft takes no applications; balances are created at finalization."
            : "A voided draft never owed anything."}
        </span>
      </p>
    {:else}
      <div class="flex flex-col gap-8">
        {#each moneyActions as action (action.identifier)}
          {@const Icon = action.icon}
          {#if action.soonDependency !== undefined}
            <SoonAffordance reason={action.soonDependency}>
              {#snippet control(soon)}
                <Button variant="secondary" size="sm" class="justify-start" {...soon}>
                  <Icon class="size-16" aria-hidden="true" />
                  {action.label}
                </Button>
              {/snippet}
            </SoonAffordance>
          {:else}
            <Button
              variant="secondary"
              size="sm"
              class="justify-start"
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

      <section class="flex flex-col gap-8 border-t border-border-default pt-12">
        <FieldLabel as="h3" class="flex items-baseline justify-between gap-8">
          Applied To This Bill
          <span class="tabular-nums normal-case">{money(row.summary.appliedMinor)}</span>
        </FieldLabel>
        {#if row.summary.appliedMinor === 0}
          <p class="text-xs text-text-muted">Nothing has been applied to this bill.</p>
        {:else}
          <p class="text-xs text-text-muted">
            {money(row.summary.appliedMinor)} has been applied. Which applications made it up — trust
            transfers, credit notes, write-offs — and who made each of them is not read here yet.
          </p>
        {/if}
        <SoonAffordance reason={BILL_DEPENDENCIES.applications} reasonPlacement="line">
          {#snippet control(soon)}
            <Button variant="secondary" size="sm" {...soon}>Show Each Application</Button>
          {/snippet}
        </SoonAffordance>
      </section>

      {#if creditNotes.length > 0}
        <section class="flex flex-col gap-8 border-t border-border-default pt-12">
          <FieldLabel as="h3">Credit Notes Beside This Bill</FieldLabel>
          {#each creditNotes as note (note.id)}
            <Card.Root class="gap-8 py-12">
              <Card.Header class="flex-row items-baseline justify-between gap-8 px-12">
                <Card.Title class="flex items-center gap-4 text-sm">
                  <FileMinus class="size-12" aria-hidden="true" />
                  Credit note · {formatDate(note.effectiveDate)}
                </Card.Title>
                <span class="text-sm tabular-nums">{money(note.totalMinor)}</span>
              </Card.Header>
              <Card.Content class="flex flex-col gap-4 px-12">
                <p class="text-xs text-text-muted">{note.reason}</p>
                {#each note.lines as line (line.id)}
                  <p class="text-xs text-text-subtle">
                    {line.description}{line.creditsInvoiceLineId === null
                      ? ": general credit against this bill"
                      : ": applied to a charge on this bill"}
                  </p>
                {/each}
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
          <FieldLabel as="h3">
            Client Credit Opened By This Correction
          </FieldLabel>
          {#each openedCredits as credit (credit.id)}
            <Card.Root class="gap-8 py-12">
              <Card.Header class="flex-row items-baseline justify-between gap-8 px-12">
                <Card.Title class="text-sm">Open credit — {clientName}</Card.Title>
                <span class="text-sm tabular-nums">{money(credit.remainingMinor)}</span>
              </Card.Header>
              <Card.Content class="flex flex-col gap-4 px-12">
                <p class="text-xs text-text-subtle">
                  Opened {formatInstantDate(credit.openedAt)} by the credit note against this bill. The firm
                  holds money it has said is not its own; the matter will not close while this is
                  open.
                </p>
                <p class="text-xs text-text-subtle">
                  Three exits: set it against a later bill of this client, refund it from operating,
                  or return it to the client&rsquo;s trust ledger.
                </p>
              </Card.Content>
            </Card.Root>
          {/each}
        </section>
      {/if}
    {/if}
  </div>
{/snippet}

{#snippet historyTab()}
  <div class="flex flex-col gap-16">
    <!-- What the rail does not carry yet is the rail's own last line, inside its frame. -->
    <EventRail
      events={historyEvents}
      label="This bill's history"
      emptyMessage="Nothing has been recorded against this bill yet."
      note={`Created and finalized are read off the bill itself. Every other event (who drew the number, each application, each revision) is on the firm's audit trail, which is not built yet: waiting on ${BILL_DEPENDENCIES.history}.`}
    />
    {#if isFinal}
      <div class="flex flex-col gap-8 border-t border-border-default pt-12">
        <SoonAffordance reason={BILL_DEPENDENCIES.reminders}>
          {#snippet control(soon)}
            <Button variant="secondary" size="sm" class="justify-start" {...soon}>
              <Calendar class="size-16" aria-hidden="true" />
              Reminders
            </Button>
          {/snippet}
        </SoonAffordance>
        <SoonAffordance reason={BILL_DEPENDENCIES.reminders}>
          {#snippet control(soon)}
            <Button variant="secondary" size="sm" class="justify-start" {...soon}>
              <CreditCard class="size-16" aria-hidden="true" />
              Payment Plan
            </Button>
          {/snippet}
        </SoonAffordance>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet deliveryTab()}
  <div class="flex flex-col gap-16">
    <!-- The rail stands before a delivery is recorded, and while the record is read: a draft's
         rail says why it is empty, a final bill's says that nothing was recorded, both inside the
         frame the deliveries will fill. -->
    <EventRail
      events={deliveryEvents}
      label="This bill's delivery attempts"
      loading={isFinal && deliveries === null}
      loadingMessage="Reading this bill's delivery record"
      emptyMessage={isFinal
        ? "No delivery of this bill has been recorded. The platform records deliveries the firm made; it sends nothing itself."
        : "Only a finalized bill can be delivered."}
    />
  </div>
{/snippet}

<!-- The action bar. Its geometry is the shell's; its verbs are this file's, one set per state. -->
{#snippet actions()}
  {#if isVoid && row !== null}
    <span class="mr-auto text-xs text-text-muted">
      Voided. Its claims returned to unbilled work, and nothing was ever charged.
    </span>
  {/if}
  {#each barActions as action (action.identifier)}
    {@const Icon = action.icon}
    {#if action.soonDependency !== undefined}
      <SoonAffordance reason={action.soonDependency}>
        {#snippet control(soon)}
          <Button variant="secondary" {...soon}>
            <Icon class="size-16" aria-hidden="true" />
            {action.label}
          </Button>
        {/snippet}
      </SoonAffordance>
    {:else}
      <Button
        variant={action.identifier === "finalize" ? "primary" : "secondary"}
        disabled={action.disabledReason !== undefined}
        title={action.disabledReason ?? action.label}
        onclick={() => onAction(action.identifier)}
      >
        <Icon class="size-16" aria-hidden="true" />
        {action.label}
      </Button>
    {/if}
  {/each}
  <Button onclick={() => (open = false)}>Close</Button>
{/snippet}

<RecordWindow
  bind:open
  {heading}
  {subtitle}
  {record}
  {actions}
  tabs={[
    {
      key: "money",
      label: "Payments & Credits",
      count: creditNotes.length,
      content: moneyTab,
    },
    { key: "history", label: "History", count: historyEvents.length, content: historyTab },
    { key: "delivery", label: "Delivery", count: deliveryEvents.length, content: deliveryTab },
  ] satisfies RecordWindowTab[]}
  defaultTab="money"
  editDisabledReason={"An invoice is not edited in place. A draft changes by claiming and releasing work; a finalized bill is adjusted from the action bar, and the edit is recorded as a revision."}
  onPrint={() => (printOpen = true)}
/>

{#if sheet !== null}
  <PrintSheet bind:open={printOpen} {sheet} />
{/if}
