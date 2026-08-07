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
import { currencyFromCode, money, percentOf, ratio } from "@magna-carta/money/money";
import { roundInvoiceLine } from "@magna-carta/money/rounding";
import { requireArrangementOfKind, type ContingencyBasis } from "./arrangements.ts";
import { BillingValidationError } from "./billing-validation.ts";
import { BILLING_AGGREGATE_KEY } from "./draft.ts";
import { aggregateMinor } from "./line-amounts.ts";
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
// sentence in front of it. The caller names the matter as well as the recovery, and a recovery that
// belongs to a different matter answers not-found — the record's existence under another matter is
// not this caller's to learn.
export async function voidMatterRecovery(
  database: SqlDatabase,
  matterId: MatterId,
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
    .prepare(`SELECT id, matter_id, voided_at FROM matter_recovery WHERE id = ?1`)
    .bind(recoveryId)
    .all<{ id: string; matter_id: string; voided_at: string | null }>();
  const row = results[0];
  if (!row || row.matter_id !== matterId) {
    throw new BillingValidationError(
      "unknown-matter-recovery",
      `no such recovery on matter ${matterId}: ${recoveryId}`,
    );
  }
  if (row.voided_at !== null) {
    throw new BillingValidationError(
      "matter-recovery-invalid",
      `recovery ${recoveryId} is already voided`,
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

// The derivation, pure: the agreed share of the base, taken through the money package's own
// share-of-a-value idiom (`percentOf` against a scale-4 ratio, so the multiplication stays in
// integer math end to end), collapsed once at the invoice-line boundary with the same
// half-away-from-zero rounding every line takes.
export function contingencyFeeMinor(
  baseMinor: number,
  shareE4: number,
  currencyCode: string,
): number {
  const currency = currencyFromCode(currencyCode);
  return toMinor(roundInvoiceLine(percentOf(money(baseMinor, currency), ratio(shareE4, 4))));
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
// recovery base. Only costs the firm has stood behind count: `approved` passed review and `billed`
// was actually invoiced, while a `draft` or `submitted` entry is a claim nobody has confirmed yet —
// deducting one would shrink the client's recovery base on an unreviewed keystroke.
async function readAdvancedCostsMinor(database: SqlDatabase, matterId: MatterId): Promise<number> {
  const { results } = await database
    .prepare(
      `SELECT SUM(amount_minor) AS amount_minor FROM cost_entry
        WHERE matter_id = ?1 AND disbursement_class = 'hard' AND status IN ('approved', 'billed')`,
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
  // The whole entitlement under the agreement as the basis stands now, what earlier finalized
  // bills already took of it, and the remainder this line actually charges.
  readonly entitlementMinor: number;
  readonly previouslyBilledMinor: number;
  readonly lineAmountMinor: number;
  readonly effect: EffectWrite;
}

// What earlier FINALIZED bills already charged under this agreement version. Draft lines are not
// counted — a draft asserts nothing and may be voided — but a second line on the SAME draft is
// refused outright below, so a draft can never accumulate two.
async function readFinalizedContingencyBilledMinor(
  database: SqlDatabase,
  arrangementId: string,
): Promise<number> {
  const { results } = await database
    .prepare(
      `SELECT SUM(l.amount_minor) AS amount_minor
         FROM invoice_line l
         JOIN invoice i ON i.id = l.invoice_id
        WHERE l.billing_arrangement_id = ?1 AND l.kind = 'fee' AND i.status = 'final'`,
    )
    .bind(arrangementId)
    .all<{ amount_minor: number | null }>();
  return results[0]?.amount_minor ?? 0;
}

// One fee line, OFFSET against what the agreement has already billed. The derivation computes the
// whole entitlement from the basis as it stands now; the line charges the entitlement MINUS every
// contingency fee already on a finalized bill under this agreement version — so a later recovery
// bills exactly its own increment, and re-composing after a finalize charges nothing twice. The
// line snapshots the share in the rate position and names the agreement version, so the finalized
// bill re-renders from its own rows and the arithmetic that produced it stays statable;
// `contingencyBilledBeyondEntitlementStatement` re-proves the ceiling over stored rows.
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

  // ONE contingency fee line per draft. Composing is idempotent in intent — "put the fee on this
  // bill" — so a second call must not quietly append a second identical line for a reviewer to miss.
  const alreadyOnDraft = await database
    .prepare(
      `SELECT COUNT(*) AS line_count FROM invoice_line WHERE invoice_id = ?1 AND billing_arrangement_id = ?2`,
    )
    .bind(invoiceId, arrangement.id)
    .all<{ line_count: number }>();
  if ((alreadyOnDraft.results[0]?.line_count ?? 0) > 0) {
    throw new BillingValidationError(
      "contingency-fee-already-on-draft",
      `invoice ${invoiceId} already carries the contingency fee under agreement version ${arrangement.version}: review the existing line, or remove it and compose again`,
    );
  }

  const derivation = await deriveContingencyFee(database, matterId);
  // THE OFFSET, and the rule that stops a recovery being billed twice: the entitlement is the whole
  // share of the basis as it stands NOW, and this line charges only what earlier finalized bills
  // have not already taken of it. A new recovery therefore bills exactly its own increment.
  const previouslyBilledMinor = await readFinalizedContingencyBilledMinor(database, arrangement.id);
  const lineAmountMinor = derivation.feeMinor - previouslyBilledMinor;
  if (lineAmountMinor <= 0) {
    throw new BillingValidationError(
      "contingency-nothing-unbilled",
      `the contingency entitlement on matter ${matterId} is ${derivation.feeMinor} and finalized bills under this agreement already charge ${previouslyBilledMinor}: there is nothing left to bill until a further recovery is recorded${previouslyBilledMinor > derivation.feeMinor ? " — and the amount already billed EXCEEDS the current entitlement, which the over-billing fitness report surfaces" : ""}`,
    );
  }

  const existingLines = await readInvoiceLines(database, invoiceId);
  const now = options.clock.now();
  const lineId = newIdentifier("invoiceLine", options.randomSource);
  const sharePercent = (derivation.shareE4 / 100).toFixed(2);
  const basisText =
    derivation.basis === "net_after_costs" ? "recovery net of advanced costs" : "gross recovery";
  const description =
    previouslyBilledMinor > 0
      ? `Contingency fee — ${sharePercent}% of ${basisText}, net of amounts previously billed`
      : `Contingency fee — ${sharePercent}% of ${basisText}`;
  return {
    lineId,
    derivation,
    entitlementMinor: derivation.feeMinor,
    previouslyBilledMinor,
    lineAmountMinor,
    effect: {
      statements: [
        insertInvoiceLineStatement(database, {
          id: lineId,
          invoiceId,
          lineIndex: existingLines.length,
          matterId,
          kind: "fee",
          description,
          quantityE4: null,
          // The share in the rate position, at the rate scale — the snapshot an hourly line keeps
          // of its hourly rate, kept here of the agreed share.
          rateE4: derivation.shareE4,
          amountMinor: lineAmountMinor,
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
