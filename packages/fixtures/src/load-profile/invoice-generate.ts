import {
  composeAccountRoleConfiguration,
  type AccountRoleAssignment,
} from "@magna-carta/billing/account-roles";
import { addClaimsToDraft, createInvoiceDraft } from "@magna-carta/billing/draft";
import { finalizeInvoice } from "@magna-carta/billing/finalize";
import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type {
  InvoiceId,
  LedgerAccountId,
  MatterId,
  TimeEntryId,
  UserId,
} from "@magna-carta/identifiers/types";
import { createAccount } from "@magna-carta/ledger/create-account";
import type { FixtureContext } from "../context.ts";
import { assertSeedingAllowed, type SeedingOptions } from "../guard.ts";
import type { InvoiceVolume } from "./profile.ts";

// The invoice volume laid over the practice and timekeeping books: drafts, the claims that pull work
// onto them, and the finalize batch that turns them into evidence.
//
// Every invoice write rides a REAL billing write path — createInvoiceDraft, addClaimsToDraft,
// finalizeInvoice — so the claim's partial unique index, the freeze triggers, the account-role
// refusal, the number draw, and the invoice_matter_balance bounds CHECK all bind at every scale. A
// generator that inserted invoice rows directly would produce a corpus the real code could never
// have made, and the measurements taken over it would be measurements of a fiction.
//
// It runs AFTER practice and timekeeping generation: it binds to the matters and time entries those
// laid down, passed in as attach points.

export interface InvoiceProbes {
  // The matter carrying the most invoices — the per-matter receivable and unbilled reads' target.
  readonly busiestMatterId: MatterId;
  // The client the busiest matter belongs to — the client-scoped list read's target.
  readonly busiestClientEntityId: string;
  // A finalized invoice — the detail read's target.
  readonly probeInvoiceId: InvoiceId;
  // A draft with claims still on it — the target for a claim-release measurement and the shape the
  // list read has to page past.
  readonly openDraftInvoiceId: InvoiceId;
  // The as-of date the aging read is measured at: the far end of the span, so every bucket has rows.
  readonly agingAsOfDate: string;
}

export interface InvoiceGenerationResult {
  readonly invoiceCount: number;
  readonly finalizedInvoiceCount: number;
  readonly invoiceLineCount: number;
  readonly claimCount: number;
  readonly probes: InvoiceProbes;
}

export interface InvoiceAttachPoints {
  readonly actorUserId: UserId;
  // Matters paired with the client they belong to and the unbilled time entries available on them.
  // The pairing is the caller's because the client link lives in matter_party, which the practice
  // and directory generators own.
  readonly billableMatters: readonly {
    readonly matterId: MatterId;
    readonly clientEntityId: string;
    readonly timeEntryIds: readonly TimeEntryId[];
  }[];
}

const MILLISECONDS_PER_DAY = 86_400_000;
const PAYMENT_TERM_DAYS = 30;

function addDays(plainDate: string, days: number): string {
  return new Date(Date.parse(`${plainDate}T00:00:00Z`) + days * MILLISECONDS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

// The firm's chart, mapped to the roles a billing posting resolves. Finalization REFUSES against an
// unmapped role, so a corpus generator has to configure the map exactly as a firm would — which is
// itself a small proof that the refusal is reachable only by not doing so.
async function configureChart(
  database: BatchDatabase,
  context: FixtureContext,
): Promise<Map<string, LedgerAccountId>> {
  const options = { clock: context.clock, randomSource: context.randomSource };
  const accounts = new Map<string, LedgerAccountId>();
  const specification: readonly { role: string; name: string; type: "asset" | "income" }[] = [
    { role: "accounts_receivable", name: "Accounts Receivable", type: "asset" },
    { role: "fee_income", name: "Fee Income", type: "income" },
    { role: "client_costs_advanced", name: "Client Costs Advanced", type: "asset" },
    { role: "cost_recovery_income", name: "Cost Recovery Income", type: "income" },
  ];
  const assignments: AccountRoleAssignment[] = [];
  for (const entry of specification) {
    const created = await createAccount(
      database,
      { name: entry.name, type: entry.type, currency: "USD" },
      options,
    );
    await commitEffectBatch(database, created.effect, { now: () => context.clock.now() });
    accounts.set(entry.role, created.accountId);
    assignments.push({
      role: entry.role as AccountRoleAssignment["role"],
      ledgerAccountId: created.accountId,
    });
  }
  await commitEffectBatch(
    database,
    composeAccountRoleConfiguration(database, assignments, options),
    { now: () => context.clock.now() },
  );
  return accounts;
}

export async function generateInvoiceVolume(
  database: BatchDatabase,
  context: FixtureContext,
  volume: InvoiceVolume,
  attach: InvoiceAttachPoints,
  seeding: SeedingOptions,
): Promise<InvoiceGenerationResult> {
  assertSeedingAllowed(seeding);
  const options = { clock: context.clock, randomSource: context.randomSource };
  await configureChart(database, context);

  const billedMatters = attach.billableMatters.slice(0, volume.billedMatterCount);
  const today = context.clock.today();

  let invoiceCount = 0;
  let finalizedInvoiceCount = 0;
  let invoiceLineCount = 0;
  let claimCount = 0;
  // How many finalized invoices each matter ended up with — the busiest one is the probe the
  // per-matter receivable read fans over.
  const matterInvoiceCounts = new Map<number, number>();
  let probeInvoiceId: InvoiceId | undefined;
  let openDraftInvoiceId: InvoiceId | undefined;

  for (const [matterIndex, matter] of billedMatters.entries()) {
    let consumed = 0;
    const available = matter.timeEntryIds;
    for (let invoiceIndex = 0; invoiceIndex < volume.invoicesPerBilledMatter; invoiceIndex += 1) {
      const claims = available.slice(consumed, consumed + volume.claimsPerInvoice);
      if (claims.length === 0) break;
      consumed += claims.length;

      const draft = createInvoiceDraft(
        database,
        {
          clientEntityId: matter.clientEntityId,
          currency: "USD",
          createdBy: attach.actorUserId,
        },
        options,
      );
      await commitEffectBatch(database, draft.effect, { now: () => context.clock.now() });
      invoiceCount += 1;

      const claimed = await addClaimsToDraft(
        database,
        draft.invoiceId,
        claims.map((timeEntryId) => ({ sourceKind: "time_entry" as const, sourceId: timeEntryId })),
        options,
      );
      await commitEffectBatch(database, claimed.effect, { now: () => context.clock.now() });
      claimCount += claimed.claimIds.length;
      invoiceLineCount += claimed.lineIds.length;

      // Every so often a draft is left OPEN — a firm always has bills in progress, and the list read
      // has to page past them to reach the finalized ones.
      const leaveAsDraft =
        invoiceIndex === volume.invoicesPerBilledMatter - 1 &&
        matterIndex % volume.openDraftEveryNthMatter === 0;
      if (leaveAsDraft) {
        openDraftInvoiceId ??= draft.invoiceId;
        continue;
      }

      // Issue dates walk BACKWARDS from the fixed clock's today across the span, so the receivables
      // book has bills at every age and the aging buckets all fill. A bill cannot be issued in the
      // future — the ledger refuses a future effective date, and rightly.
      const dayOffset = Math.round(
        (volume.spanDays * (invoiceIndex + 1)) / (volume.invoicesPerBilledMatter + 1),
      );
      const issueDate = addDays(today, -dayOffset);
      const finalized = await finalizeInvoice(
        database,
        {
          invoiceId: draft.invoiceId,
          issueDate,
          dueDate: addDays(issueDate, PAYMENT_TERM_DAYS),
          finalizedBy: attach.actorUserId,
        },
        options,
      );
      await commitEffectBatch(database, finalized.effect, { now: () => context.clock.now() });
      finalizedInvoiceCount += 1;
      probeInvoiceId ??= draft.invoiceId;
      matterInvoiceCounts.set(matterIndex, (matterInvoiceCounts.get(matterIndex) ?? 0) + 1);
    }
  }

  let busiestMatterIndex = 0;
  let busiestCount = -1;
  for (const [index, count] of matterInvoiceCounts) {
    if (count > busiestCount) {
      busiestCount = count;
      busiestMatterIndex = index;
    }
  }
  const busiest = billedMatters[busiestMatterIndex];
  if (!busiest || !probeInvoiceId) {
    throw new Error(
      "the invoice volume produced no finalized invoice: the attach points carried no billable time",
    );
  }

  return {
    invoiceCount,
    finalizedInvoiceCount,
    invoiceLineCount,
    claimCount,
    probes: {
      busiestMatterId: busiest.matterId,
      busiestClientEntityId: busiest.clientEntityId,
      probeInvoiceId,
      // Falls back to the probe invoice when the profile is small enough that no draft was left
      // open — the measurement then reads a finalized invoice, which is a weaker but valid target.
      openDraftInvoiceId: openDraftInvoiceId ?? probeInvoiceId,
      // The clock's today: every bill was issued at or before it, so every aging bucket is reachable.
      agingAsOfDate: today,
    },
  };
}
