import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type {
  LedgerAccountId,
  LedgerEntryId,
  LocationId,
  MatterId,
  TrustAccountId,
  TrustBankStatementId,
  TrustBankStatementLineId,
  TrustLedgerNodeId,
  TrustReconciliationId,
  UserId,
} from "@magna-carta/identifiers/types";
import { money, USD } from "@magna-carta/money/money";
import { openTrustAccount } from "@magna-carta/trust/account-tree";
import {
  composeTrustBankStatement,
  readTrustBankStatementLines,
} from "@magna-carta/trust/bank-statements";
import { placeTrustHold } from "@magna-carta/trust/holds";
import { composeTrustReconciliationMatch } from "@magna-carta/trust/matching";
import { composeTrustDeposit, composeTrustDisbursement } from "@magna-carta/trust/movements";
import {
  closeTrustReconciliation,
  openTrustReconciliation,
} from "@magna-carta/trust/reconciliation";
import type { FixtureContext } from "../context.ts";
import { assertSeedingAllowed, type SeedingOptions } from "../guard.ts";
import type { TrustVolume } from "./profile.ts";

// The trust volume laid over the practice book: one real trust account under the sub-ledger tree, a
// client ledger per matter that holds client money, the movements that put it there and take it out,
// disputed-funds holds on a slice of them, and the bank statements and reconciliations that prove the
// three sides agree.
//
// Every write rides a REAL trust write path — openTrustAccount, composeTrustDeposit,
// composeTrustDisbursement, placeTrustHold, composeTrustBankStatement, openTrustReconciliation,
// composeTrustReconciliationMatch, closeTrustReconciliation — so the composition guard, the zero
// floor, the movement shape CHECK, and the reconciliation triggers all bind at every scale. All
// randomness comes from the one FixtureContext and no wall clock is read.
//
// The ledger generator's own "trust" archetypes are a different thing entirely: they post to bare
// ledger accounts with no trust_* rows behind them, which is what the ledger measurement set wants.
// This module builds the trust subsystem's own shape, on its own accounts.

export interface TrustProbes {
  readonly trustAccountId: TrustAccountId;
  readonly bankLedgerAccountId: LedgerAccountId;
  // The matter leaf carrying the most movements — the hot client-ledger read.
  readonly busiestNodeId: TrustLedgerNodeId;
  // The most recent statement, and one of its lines.
  readonly probeStatementId: TrustBankStatementId;
  readonly probeStatementLineId: TrustBankStatementLineId;
  // The one reconciliation left OPEN: the proof recomputes on every read of it, so it is what the
  // three-way computation is measured against. The rest are closed and frozen.
  readonly openReconciliationId: TrustReconciliationId;
  // A ledger entry that is still outstanding on the open reconciliation — the match write's target.
  readonly outstandingEntryId: LedgerEntryId;
}

export interface TrustGenerationResult {
  readonly trustLedgerNodeCount: number;
  readonly trustMovementCount: number;
  readonly trustHoldCount: number;
  readonly trustBankStatementCount: number;
  readonly trustBankStatementLineCount: number;
  readonly trustReconciliationCount: number;
  readonly trustReconciliationMatchCount: number;
  // The period end the open reconciliation's statement covers — the as-of date every leg of its
  // proof is computed at, carried out so the measurement layer binds to that date rather than
  // guessing one.
  readonly asOfDate: string;
  readonly probes: TrustProbes;
}

const MILLISECONDS_PER_DAY = 86_400_000;

function daysBefore(anchor: string, days: number): string {
  return new Date(Date.parse(`${anchor}T00:00:00Z`) - days * MILLISECONDS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

export async function generateTrustVolume(
  database: BatchDatabase,
  context: FixtureContext,
  volume: TrustVolume,
  options: SeedingOptions,
): Promise<TrustGenerationResult> {
  assertSeedingAllowed(options);
  const { faker, clock, randomSource } = context;
  const serviceOptions = { clock, randomSource };
  const commit = (effect: Parameters<typeof commitEffectBatch>[1]) =>
    commitEffectBatch(database, effect, { now: () => clock.now() });

  // A trust account is bound to an office, and its jurisdiction is DERIVED from that office's state:
  // a movement on an account whose office recorded none refuses outright, so the generator has to
  // supply one or produce no movements at all.
  const { results: locations } = await database
    .prepare("SELECT id FROM location ORDER BY id")
    .all<{ id: string }>();
  const locationId = locations[0]?.id;
  if (locationId === undefined) {
    throw new Error(
      "load-profile: trust volume needs at least one office to bind a trust account to",
    );
  }
  const { results: members } = await database
    .prepare("SELECT user_id FROM member ORDER BY user_id")
    .all<{ user_id: string }>();
  const actorUserId = members[0]?.user_id as UserId | undefined;
  if (actorUserId === undefined) {
    throw new Error("load-profile: trust volume needs a member to record and authorize movements");
  }
  const { results: matters } = await database
    .prepare("SELECT id FROM matter ORDER BY id")
    .all<{ id: string }>();
  const matterIds = matters.map((row) => row.id as MatterId);
  if (matterIds.length === 0) {
    throw new Error("load-profile: trust volume needs matters to hold client money for");
  }

  const anchorDate = clock.today();
  const opened = await openTrustAccount(
    database,
    {
      name: "IOLTA — client trust",
      locationId: locationId as LocationId,
      jurisdiction: "US-NV",
      currency: "USD",
      openedOn: daysBefore(anchorDate, volume.spanDays),
    },
    serviceOptions,
  );
  await commit(opened.effect);

  const ledgerMatterIds = matterIds.slice(0, Math.min(volume.matterLedgerCount, matterIds.length));

  // The statement periods are equal slices of the span, and every movement is dated INSIDE the
  // window they cover. An item dated outside every period would sit outstanding on every future
  // reconciliation forever, which is a real condition and a useless one to seed deliberately.
  const periodLength = Math.max(1, Math.floor(volume.spanDays / volume.statementCount));
  const coveredDays = periodLength * volume.statementCount;

  // What each matter leaf holds, tracked in memory so a disbursement never exceeds it — the zero
  // floor would abort the batch, which is the correct behaviour and a useless generator.
  interface LeafState {
    readonly nodeId: TrustLedgerNodeId;
    heldMinor: number;
    movements: number;
    openedDaysBefore: number;
  }
  const leaves = new Map<MatterId, LeafState>();
  // Bank-affecting entries by the day they were recorded, so a statement can carry the items that
  // actually landed in its period rather than an invented list.
  const bankItems: { entryId: LedgerEntryId; effectiveDate: string; deltaMinor: number }[] = [];

  let movementCount = 0;
  for (const [index, matterId] of ledgerMatterIds.entries()) {
    // Spread the openings evenly back through the covered window, oldest first, so every period
    // carries activity rather than the whole book landing in one month.
    const openedDaysBefore =
      coveredDays - 1 - Math.floor((index / ledgerMatterIds.length) * (coveredDays - 1));
    const effectiveDate = daysBefore(anchorDate, openedDaysBefore);
    const depositMinor = faker.number.int({
      min: volume.depositMinor.min,
      max: volume.depositMinor.max,
    });
    const clientEntityId = `entity_${matterId}`;
    const deposit = await composeTrustDeposit(
      database,
      {
        trustAccountId: opened.trustAccountId,
        to: {
          clientEntityId,
          matterId,
          clientNodeName: `Trust — ${faker.person.lastName()}`,
          matterLeafName: `Trust — ${matterId}`,
        },
        amount: money(depositMinor, USD),
        effectiveDate,
        description: "Retainer received",
        method: "check",
        reference: String(faker.number.int({ min: 1000, max: 9999 })),
        source: faker.person.fullName(),
        purpose: "Advance on fees and costs",
        recordedBy: actorUserId,
      },
      serviceOptions,
    );
    await commit(deposit.effect);
    movementCount += 1;
    leaves.set(matterId, {
      nodeId: deposit.nodeId,
      heldMinor: depositMinor,
      movements: 1,
      openedDaysBefore,
    });
    bankItems.push({ entryId: deposit.entryId, effectiveDate, deltaMinor: depositMinor });
  }

  // Further activity on a slice of the ledgers, so the client-ledger read has a leaf with a real
  // history behind it rather than one row everywhere.
  let busiest: LeafState | undefined;
  for (const leaf of leaves.values()) {
    for (let step = 0; step < volume.extraMovementsPerBusyLedger; step += 1) {
      if (leaf.movements > volume.extraMovementsPerBusyLedger) break;
      // Money leaves after it arrives, and still inside the covered window.
      const effectiveDate = daysBefore(anchorDate, Math.max(0, leaf.openedDaysBefore - step - 1));
      const outMinor = Math.min(
        leaf.heldMinor,
        faker.number.int({ min: volume.disbursementMinor.min, max: volume.disbursementMinor.max }),
      );
      if (outMinor <= 0) break;
      const disbursement = await composeTrustDisbursement(
        database,
        {
          fromNodeId: leaf.nodeId,
          amount: money(outMinor, USD),
          effectiveDate,
          description: "Filing fee paid on the client's behalf",
          method: "check",
          reference: String(faker.number.int({ min: 2000, max: 2999 })),
          payee: faker.company.name(),
          purpose: "Court filing fee",
          recordedBy: actorUserId,
          authorizedBy: actorUserId,
        },
        serviceOptions,
      );
      await commit(disbursement.effect);
      leaf.heldMinor -= outMinor;
      leaf.movements += 1;
      movementCount += 1;
      bankItems.push({ entryId: disbursement.entryId, effectiveDate, deltaMinor: -outMinor });
    }
    if (busiest === undefined || leaf.movements > busiest.movements) busiest = leaf;
  }
  if (busiest === undefined) {
    throw new Error("load-profile: trust volume produced no client ledgers");
  }

  // Disputed-funds holds on a slice of the ledgers: available balance is the disbursement ceiling,
  // and the fitness sweep re-proves that no hold outlived the money it restricted.
  let holdCount = 0;
  const heldTarget = Math.round(leaves.size * volume.heldLedgerFraction);
  for (const leaf of leaves.values()) {
    if (holdCount >= heldTarget) break;
    if (leaf.heldMinor <= 0) continue;
    const hold = await placeTrustHold(
      database,
      {
        nodeId: leaf.nodeId,
        amount: money(Math.max(1, Math.floor(leaf.heldMinor / 2)), USD),
        reason: "Disputed portion pending resolution",
        placedBy: actorUserId,
      },
      serviceOptions,
    );
    await commit(hold.effect);
    holdCount += 1;
  }

  // The bank's side. Each period carries the items that actually landed in it, plus a service charge
  // the firm never recorded — the unmatched line that is the single most valuable thing a
  // reconciliation finds, and the reason the proof has to be able to report an honest red.
  let statementLineCount = 0;
  let matchCount = 0;
  let reconciliationCount = 0;
  let probeStatementId: TrustBankStatementId | undefined;
  let probeStatementLineId: TrustBankStatementLineId | undefined;
  let openReconciliationId: TrustReconciliationId | undefined;
  let openPeriodEnd: string | undefined;
  let outstandingEntryId: LedgerEntryId | undefined;
  let runningBankMinor = 0;

  for (let period = volume.statementCount - 1; period >= 0; period -= 1) {
    const periodEnd = daysBefore(anchorDate, period * periodLength);
    const periodStart = daysBefore(anchorDate, (period + 1) * periodLength - 1);
    const inPeriod = bankItems.filter(
      (item) => item.effectiveDate >= periodStart && item.effectiveDate <= periodEnd,
    );
    // A period with no client activity still gets a statement: the bank sends one, it carries the
    // service charge, and the firm has to reconcile it. Skipping it would leave the most recent
    // period unrepresented whenever the last month happened to be quiet.
    const openingMinor = runningBankMinor;
    const movedMinor = inPeriod.reduce((total, item) => total + item.deltaMinor, 0);
    const serviceChargeMinor = volume.serviceChargeMinor;
    runningBankMinor = openingMinor + movedMinor - serviceChargeMinor;

    const statement = await composeTrustBankStatement(
      database,
      {
        trustAccountId: opened.trustAccountId,
        periodStart,
        periodEnd,
        openingBalance: money(openingMinor, USD),
        closingBalance: money(runningBankMinor, USD),
        statementReference: `STMT-${period}`,
        source: "entered",
        lines: [
          ...inPeriod.map((item) => ({
            postedOn: item.effectiveDate,
            direction: item.deltaMinor > 0 ? ("deposit" as const) : ("withdrawal" as const),
            amount: money(Math.abs(item.deltaMinor), USD),
            description: item.deltaMinor > 0 ? "DEPOSIT" : "CHECK PAID",
            reference: null,
            counterpartyName: null,
          })),
          {
            postedOn: periodEnd,
            direction: "withdrawal" as const,
            amount: money(serviceChargeMinor, USD),
            description: "MONTHLY SERVICE CHARGE",
            reference: null,
            counterpartyName: null,
          },
        ],
        recordedBy: actorUserId,
      },
      serviceOptions,
    );
    await commit(statement.effect);
    statementLineCount += statement.lineIds.length;
    probeStatementId = statement.statementId;
    probeStatementLineId = statement.lineIds[0];

    const reconciliation = await openTrustReconciliation(
      database,
      { statementId: statement.statementId, openedBy: actorUserId },
      serviceOptions,
    );
    await commit(reconciliation.effect);
    reconciliationCount += 1;

    // Match every line that corresponds to a recorded item, leaving the service charge unmatched —
    // the shape a real reconciliation is worked into, and the shape the proof must report honestly.
    const lines = await readTrustBankStatementLines(database, statement.statementId);
    const byAmount = new Map<string, LedgerEntryId[]>();
    for (const item of inPeriod) {
      const key = `${item.deltaMinor > 0 ? "deposit" : "withdrawal"}:${Math.abs(item.deltaMinor)}`;
      byAmount.set(key, [...(byAmount.get(key) ?? []), item.entryId]);
    }
    for (const line of lines) {
      const key = `${line.direction}:${line.amountMinor}`;
      const candidates = byAmount.get(key);
      const entryId = candidates?.shift();
      if (entryId === undefined) continue;
      const match = await composeTrustReconciliationMatch(
        database,
        {
          reconciliationId: reconciliation.reconciliationId,
          statementLineId: line.id,
          entryId,
          matchedBy: actorUserId,
        },
        serviceOptions,
      );
      await commit(match.effect);
      matchCount += 1;
    }

    // Every period but the last closes and freezes; the last stays open so the live three-way
    // computation has something to measure against.
    if (period > 0) {
      const closed = await closeTrustReconciliation(
        database,
        reconciliation.reconciliationId,
        actorUserId,
        serviceOptions,
      );
      await commit(closed.effect);
    } else {
      openReconciliationId = reconciliation.reconciliationId;
      openPeriodEnd = periodEnd;
      // An item recorded after the last statement's period end is not outstanding AS OF that period,
      // so the probe entry is drawn from the period's own items — one the matching loop left over.
      for (const item of inPeriod) {
        const key = `${item.deltaMinor > 0 ? "deposit" : "withdrawal"}:${Math.abs(item.deltaMinor)}`;
        if ((byAmount.get(key) ?? []).includes(item.entryId)) {
          outstandingEntryId = item.entryId;
          break;
        }
      }
    }
  }

  if (probeStatementId === undefined || probeStatementLineId === undefined) {
    throw new Error("load-profile: trust volume produced no bank statements");
  }
  if (openReconciliationId === undefined || openPeriodEnd === undefined) {
    throw new Error(
      "load-profile: trust volume left no open reconciliation to measure the proof on",
    );
  }
  // Every item in the last period may have matched, which is a fine outcome for a firm and a useless
  // one for a probe — so an extra deposit is recorded inside the period, guaranteeing one item the
  // statement does not carry.
  if (outstandingEntryId === undefined) {
    const leaf = busiest;
    const trailing = await composeTrustDisbursement(
      database,
      {
        fromNodeId: leaf.nodeId,
        amount: money(Math.max(1, Math.min(leaf.heldMinor, 100)), USD),
        effectiveDate: anchorDate,
        description: "Outstanding check, not yet presented",
        method: "check",
        reference: "9999",
        payee: "Clerk of the Court",
        purpose: "Court filing fee",
        recordedBy: actorUserId,
        authorizedBy: actorUserId,
      },
      serviceOptions,
    );
    await commit(trailing.effect);
    movementCount += 1;
    leaf.heldMinor -= Math.max(1, Math.min(leaf.heldMinor, 100));
    outstandingEntryId = trailing.entryId;
  }
  const probeOutstandingEntryId = outstandingEntryId;
  if (probeOutstandingEntryId === undefined) {
    throw new Error("load-profile: trust volume produced no outstanding item to probe against");
  }

  const nodeCountRow = await database
    .prepare("SELECT COUNT(*) AS nodes FROM trust_ledger_node")
    .all<{ nodes: number }>();

  return {
    trustLedgerNodeCount: nodeCountRow.results[0]?.nodes ?? 0,
    trustMovementCount: movementCount,
    trustHoldCount: holdCount,
    trustBankStatementCount: reconciliationCount,
    trustBankStatementLineCount: statementLineCount,
    trustReconciliationCount: reconciliationCount,
    trustReconciliationMatchCount: matchCount,
    asOfDate: openPeriodEnd,
    probes: {
      trustAccountId: opened.trustAccountId,
      bankLedgerAccountId: opened.bankLedgerAccountId,
      busiestNodeId: busiest.nodeId,
      probeStatementId,
      probeStatementLineId: probeStatementLineId,
      openReconciliationId,
      outstandingEntryId: probeOutstandingEntryId,
    },
  };
}
