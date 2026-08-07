import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  InvoiceId,
  InvoiceLineId,
  MatterId,
  MatterRecoveryId,
  UserId,
} from "@magna-carta/identifiers/types";
import { readMatterClientEntityIds } from "@magna-carta/matters/matter-party";
import { toMinor } from "@magna-carta/money/format";
import { currencyFromCode, money, multiplyByQuantity } from "@magna-carta/money/money";
import { roundInvoiceLine } from "@magna-carta/money/rounding";
import { requireArrangementOfKind, type ContingencyBasis } from "./arrangements.ts";
import { BillingValidationError } from "./billing-validation.ts";
import { BILLING_AGGREGATE_KEY } from "./draft.ts";
import { aggregateMinor, RATE_SCALE_DIVISOR } from "./line-amounts.ts";
import { insertInvoiceLineStatement, readInvoice, readInvoiceLines } from "./statements.ts";
import type { BillingServiceOptions } from "./types.ts";

// THE CONTINGENCY FEE. The agreement records the share, and the fee is COMPUTED at invoice time from
// the recoveries recorded on the matter — always a derivation, never a decided number stored
// anywhere. What is stored is the recovery itself (a settlement, a judgment, an award: an amount, a
// date, a description) and, once composed, the invoice line — which snapshots the derivation's
// result the way every line snapshots what the client was told, and records the agreement version it
// was computed under.
//
// WHAT THIS MODULE DOES NOT DO. It is not a settlement disbursement statement: splitting a recovery
// between the client's share, the fee, advanced costs, and third-party liens is a trust disbursement
// under lien-priority rules the platform has not researched, and it belongs with trust's
// disbursement path when a real matter demands it. Money that arrived into the client's trust ledger
// leaves it only through the existing earned-fee application against this invoice once finalized —
// no new trust write shape exists here.

export const MATTER_RECOVERY_RECORDED_TOPIC = "billing.matter.recovery_recorded";

export interface MatterRecoverySnapshot {
  readonly id: MatterRecoveryId;
  readonly matterId: MatterId;
  readonly amountMinor: number;
  readonly currency: string;
  readonly recoveredDate: string;
  readonly description: string;
  readonly voidedAt: string | null;
  readonly voidReason: string | null;
}

interface MatterRecoveryRow {
  id: string;
  matter_id: string;
  amount_minor: number;
  currency: string;
  recovered_date: string;
  description: string;
  voided_at: string | null;
  void_reason: string | null;
}

function toRecoverySnapshot(row: MatterRecoveryRow): MatterRecoverySnapshot {
  return {
    id: row.id as MatterRecoveryId,
    matterId: row.matter_id as MatterId,
    amountMinor: row.amount_minor,
    currency: row.currency,
    recoveredDate: row.recovered_date,
    description: row.description,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
  };
}

export async function readMatterRecoveries(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<MatterRecoverySnapshot[]> {
  const { results } = await database
    .prepare(
      `SELECT id, matter_id, amount_minor, currency, recovered_date, description, voided_at, void_reason
         FROM matter_recovery WHERE matter_id = ?1 ORDER BY recovered_date, id`,
    )
    .bind(matterId)
    .all<MatterRecoveryRow>();
  return results.map(toRecoverySnapshot);
}

export interface RecordMatterRecoveryInput {
  readonly matterId: MatterId;
  readonly amountMinor: number;
  readonly currency: string;
  readonly recoveredDate: string; // civil PlainDate
  readonly description: string;
  readonly recordedBy: UserId | null;
}

export interface ComposedMatterRecovery {
  readonly recoveryId: MatterRecoveryId;
  readonly effect: EffectWrite;
}

// Recording a recovery is recording a FACT, so it needs no arrangement — a matter can settle before
// the paperwork caught up — but the amount must be real money in whole minor units.
export function recordMatterRecovery(
  database: SqlDatabase,
  input: RecordMatterRecoveryInput,
  options: BillingServiceOptions,
): ComposedMatterRecovery {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new BillingValidationError(
      "matter-recovery-invalid",
      `a recovery of ${input.amountMinor} is not a positive whole number of minor units`,
    );
  }
  if (input.description.trim().length === 0) {
    throw new BillingValidationError(
      "matter-recovery-invalid",
      "a recovery needs a description: what was recovered, and under what — a settlement, a judgment, an award",
    );
  }
  const recoveryId = newIdentifier("matterRecovery", options.randomSource);
  const now = options.clock.now();
  return {
    recoveryId,
    effect: {
      statements: [
        database
          .prepare(
            `INSERT INTO matter_recovery (id, matter_id, amount_minor, currency, recovered_date, description, recorded_by, recorded_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
          )
          .bind(
            recoveryId,
            input.matterId,
            input.amountMinor,
            input.currency,
            input.recoveredDate,
            input.description,
            input.recordedBy,
            now,
          ),
      ],
      outboxMessages: [
        {
          topic: MATTER_RECOVERY_RECORDED_TOPIC,
          payload: {
            recoveryId,
            matterId: input.matterId,
            amountMinor: input.amountMinor,
            currency: input.currency,
          },
          aggregateKey: BILLING_AGGREGATE_KEY,
        },
      ],
    },
  };
}

// The one edit a recovery ever takes: voided with a reason, never edited or deleted, so the wrong
// record and its correction both stay readable. The trigger holds this shape; the guard here is the
// sentence in front of it.
export async function voidMatterRecovery(
  database: SqlDatabase,
  recoveryId: MatterRecoveryId,
  reason: string,
  voidedBy: UserId | null,
  options: BillingServiceOptions,
): Promise<EffectWrite> {
  if (reason.trim().length === 0) {
    throw new BillingValidationError(
      "matter-recovery-invalid",
      "voiding a recovery needs the reason it was wrong",
    );
  }
  const { results } = await database
    .prepare(`SELECT id, voided_at FROM matter_recovery WHERE id = ?1`)
    .bind(recoveryId)
    .all<{ id: string; voided_at: string | null }>();
  const row = results[0];
  if (!row || row.voided_at !== null) {
    throw new BillingValidationError(
      "matter-recovery-invalid",
      `no open recovery record: ${recoveryId}`,
    );
  }
  const now = options.clock.now();
  return {
    statements: [
      database
        .prepare(
          `UPDATE matter_recovery SET voided_at = ?2, voided_by = ?3, void_reason = ?4 WHERE id = ?1 AND voided_at IS NULL`,
        )
        .bind(recoveryId, now, voidedBy, reason),
    ],
    outboxMessages: [],
  };
}

// The derivation, pure: base times share, collapsed once at the invoice-line boundary. The share is
// a dimensionless decimal at the rate scale, so it takes the quantity position against the base —
// the same collapse `invoiceLineAmountMinor` performs for rate-times-hours, with the same
// half-away-from-zero rounding.
export function contingencyFeeMinor(
  baseMinor: number,
  shareE4: number,
  currencyCode: string,
): number {
  const currency = currencyFromCode(currencyCode);
  return toMinor(
    roundInvoiceLine(multiplyByQuantity(money(baseMinor, currency), shareE4 / RATE_SCALE_DIVISOR)),
  );
}

export interface ContingencyFeeDerivation {
  readonly recoveriesMinor: number;
  readonly advancedCostsMinor: number;
  readonly basis: ContingencyBasis;
  readonly baseMinor: number;
  readonly shareE4: number;
  readonly feeMinor: number;
}

// The matter's advanced (hard) costs — money the firm laid out on the client's behalf — for the
// net-after-costs election. Soft costs are the firm's own expenses and never reduce the client's
// recovery base.
async function readAdvancedCostsMinor(database: SqlDatabase, matterId: MatterId): Promise<number> {
  const { results } = await database
    .prepare(
      `SELECT SUM(amount_minor) AS amount_minor FROM cost_entry
        WHERE matter_id = ?1 AND disbursement_class = 'hard' AND status <> 'void'`,
    )
    .bind(matterId)
    .all<{ amount_minor: number | null }>();
  return results[0]?.amount_minor ?? 0;
}

// The whole derivation against the records as they stand NOW: the agreement's share and election,
// the non-voided recoveries, and (under net-after-costs) the advanced costs. Recomputed on every
// call — recording another recovery changes the next answer, which is the point of deriving.
export async function deriveContingencyFee(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<ContingencyFeeDerivation> {
  const arrangement = await requireArrangementOfKind(database, matterId, "contingency");
  const recoveries = await readMatterRecoveries(database, matterId);
  const open = recoveries.filter((recovery) => recovery.voidedAt === null);
  if (open.length === 0) {
    throw new BillingValidationError(
      "contingency-no-recovery",
      `matter ${matterId} has no recorded recovery: a contingency fee is a share of a recovery, so record the settlement, judgment, or award first`,
    );
  }
  for (const recovery of open) {
    if (recovery.currency !== arrangement.currency) {
      throw new BillingValidationError(
        "contingency-currency-mismatch",
        `recovery ${recovery.id} is recorded in ${recovery.currency}, but the agreement is in ${arrangement.currency}`,
      );
    }
  }
  const recoveriesMinor = aggregateMinor(
    open.map((recovery) => recovery.amountMinor),
    arrangement.currency,
  );
  const advancedCostsMinor =
    arrangement.contingencyBasis === "net_after_costs"
      ? await readAdvancedCostsMinor(database, matterId)
      : 0;
  const baseMinor = recoveriesMinor - advancedCostsMinor;
  if (baseMinor <= 0) {
    throw new BillingValidationError(
      "contingency-base-not-positive",
      `the fee base on matter ${matterId} is ${baseMinor}: the advanced costs meet or exceed the recovery under the net-after-costs election, so there is nothing to take a share of`,
    );
  }
  const shareE4 = arrangement.contingencyShareE4 as number;
  return {
    recoveriesMinor,
    advancedCostsMinor,
    basis: arrangement.contingencyBasis as ContingencyBasis,
    baseMinor,
    shareE4,
    feeMinor: contingencyFeeMinor(baseMinor, shareE4, arrangement.currency),
  };
}

export interface ComposedContingencyFee {
  readonly lineId: InvoiceLineId;
  readonly derivation: ContingencyFeeDerivation;
  readonly effect: EffectWrite;
}

// One fee line from the derivation. The line snapshots the result and the share (in the rate
// position, where an hourly line snapshots its rate) and names the agreement version — so the
// finalized bill re-renders from its own rows, and the arithmetic that produced it stays statable.
export async function addContingencyFeeToDraft(
  database: SqlDatabase,
  invoiceId: InvoiceId,
  matterId: MatterId,
  options: BillingServiceOptions,
): Promise<ComposedContingencyFee> {
  const invoice = await readInvoice(database, invoiceId);
  if (!invoice) {
    throw new BillingValidationError("unknown-invoice", `no such invoice: ${invoiceId}`);
  }
  if (invoice.status !== "draft") {
    throw new BillingValidationError(
      "invoice-not-draft",
      `invoice ${invoiceId} is ${invoice.status} and no longer accepts work: a finalized invoice is corrected by a credit note, never edited`,
    );
  }
  const arrangement = await requireArrangementOfKind(database, matterId, "contingency");
  if (arrangement.currency !== invoice.currency) {
    throw new BillingValidationError(
      "invoice-line-currency-mismatch",
      `the contingency agreement is recorded in ${arrangement.currency}, but this invoice bills in ${invoice.currency}: a bill states one currency, and converting one here would invent an exchange rate nobody approved`,
    );
  }
  const clientByMatter = await readMatterClientEntityIds(database, [matterId]);
  const clientEntityId = clientByMatter.get(matterId);
  if (!clientEntityId) {
    throw new BillingValidationError(
      "matter-has-no-client",
      `matter ${matterId} has no client party, so there is nobody to bill: record the client on the matter first`,
    );
  }
  if (clientEntityId !== invoice.clientEntityId) {
    throw new BillingValidationError(
      "invoice-client-mismatch",
      `matter ${matterId} belongs to client ${clientEntityId}, but this invoice bills ${invoice.clientEntityId}: one invoice bills one client`,
    );
  }

  const derivation = await deriveContingencyFee(database, matterId);
  const existingLines = await readInvoiceLines(database, invoiceId);
  const now = options.clock.now();
  const lineId = newIdentifier("invoiceLine", options.randomSource);
  const sharePercent = (derivation.shareE4 / 100).toFixed(2);
  const basisText =
    derivation.basis === "net_after_costs" ? "recovery net of advanced costs" : "gross recovery";
  return {
    lineId,
    derivation,
    effect: {
      statements: [
        insertInvoiceLineStatement(database, {
          id: lineId,
          invoiceId,
          lineIndex: existingLines.length,
          matterId,
          kind: "fee",
          description: `Contingency fee — ${sharePercent}% of ${basisText}`,
          quantityE4: null,
          // The share in the rate position, at the rate scale — the snapshot an hourly line keeps
          // of its hourly rate, kept here of the agreed share.
          rateE4: derivation.shareE4,
          amountMinor: derivation.feeMinor,
          currency: invoice.currency,
          utbmsTaskCode: null,
          utbmsActivityCode: null,
          utbmsExpenseCode: null,
          taxTreatment: "exempt",
          billingArrangementId: arrangement.id,
          now,
        }),
      ],
      outboxMessages: [],
    },
  };
}
