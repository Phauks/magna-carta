import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  BillingArrangementId,
  FileId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { BillingValidationError } from "./billing-validation.ts";
import type { BillingServiceOptions } from "./types.ts";

// THE FEE AGREEMENT. One in-force arrangement per matter, versioned append-only: a fee change is a
// NEW version whose insert closes the prior version's valid_to in the same batch, and the old
// version stays readable forever because invoice lines record which version composed them. Absence
// of any arrangement means hourly — matters that predate the table need no backfill, and a firm that
// never configures one bills exactly as it always has.
//
// The database holds the shape: versions are dense per matter (trigger), exactly one open row per
// matter (partial unique index), each kind carries exactly its own fields (CHECK), and the only
// UPDATE a row ever takes is the one-time close of its valid_to (trigger). The refusals below are
// the nicer error messages standing in front of those guarantees, not the guarantees.

export type BillingArrangementKind = "hourly" | "flat_fee" | "contingency" | "retainer";

// The costs-before-or-after election on a contingency agreement: `gross_recovery` computes the fee
// on the recovery before advanced costs come off; `net_after_costs` deducts the matter's advanced
// (hard) costs from the recovery first. Recorded verbatim from the firm's own agreement — the
// platform holds no opinion on which a firm should use.
export type ContingencyBasis = "gross_recovery" | "net_after_costs";

// Where an advance fee deposit sits until earned — the client trust ledger, or the firm's operating
// account. Jurisdictions genuinely differ, so the platform records the firm's choice and supplies NO
// default: null means the firm has not said, not that the platform picked one.
export type AdvanceDepositDestination = "trust" | "operating";

export interface BillingArrangementSnapshot {
  readonly id: BillingArrangementId;
  readonly matterId: MatterId;
  readonly version: number;
  readonly kind: BillingArrangementKind;
  readonly flatFeeAmountMinor: number | null;
  readonly contingencyShareE4: number | null;
  readonly contingencyBasis: ContingencyBasis | null;
  readonly retainerTargetMinor: number | null;
  readonly retainerThresholdMinor: number | null;
  readonly advanceDepositDestination: AdvanceDepositDestination | null;
  readonly currency: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  /**
   * The signed agreement this version rests on, as a matter file — the intake agreement signed at
   * opening, or the amendment signed later. Null where the version was recorded before the paper
   * was filed, or predates the column. The name rides with the id so a reader can be told what the
   * file is called without a second read; it is null where the file has since been deleted.
   */
  readonly agreementFileId: FileId | null;
  readonly agreementFileName: string | null;
}

interface ArrangementRow {
  id: string;
  matter_id: string;
  version: number;
  kind: BillingArrangementKind;
  flat_fee_amount_minor: number | null;
  contingency_share_e4: number | null;
  contingency_basis: ContingencyBasis | null;
  retainer_target_minor: number | null;
  retainer_threshold_minor: number | null;
  advance_deposit_destination: AdvanceDepositDestination | null;
  currency: string;
  valid_from: string;
  valid_to: string | null;
  agreement_file_id: string | null;
  agreement_file_name: string | null;
}

// The version's own columns, and the signed agreement's name joined beside its id. A LEFT JOIN, so a
// version whose agreement was deleted still reads; the name is then null and the id still says what
// was recorded.
const ARRANGEMENT_COLUMNS = `a.id, a.matter_id, a.version, a.kind, a.flat_fee_amount_minor, a.contingency_share_e4, a.contingency_basis, a.retainer_target_minor, a.retainer_threshold_minor, a.advance_deposit_destination, a.currency, a.valid_from, a.valid_to, a.agreement_file_id, f.name AS agreement_file_name`;
const ARRANGEMENT_FROM = `FROM matter_billing_arrangement a LEFT JOIN file f ON f.id = a.agreement_file_id AND f.deleted_at IS NULL`;

function toSnapshot(row: ArrangementRow): BillingArrangementSnapshot {
  return {
    id: row.id as BillingArrangementId,
    matterId: row.matter_id as MatterId,
    version: row.version,
    kind: row.kind,
    flatFeeAmountMinor: row.flat_fee_amount_minor,
    contingencyShareE4: row.contingency_share_e4,
    contingencyBasis: row.contingency_basis,
    retainerTargetMinor: row.retainer_target_minor,
    retainerThresholdMinor: row.retainer_threshold_minor,
    advanceDepositDestination: row.advance_deposit_destination,
    currency: row.currency,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    agreementFileId: row.agreement_file_id as FileId | null,
    agreementFileName: row.agreement_file_id === null ? null : row.agreement_file_name,
  };
}

// The arrangement IN FORCE: the one open row. Undefined means hourly by absence, which the callers
// that need an arrangement (flat fee, contingency, retainer) each refuse on by name.
export async function readBillingArrangementInForce(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<BillingArrangementSnapshot | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${ARRANGEMENT_COLUMNS} ${ARRANGEMENT_FROM} WHERE a.matter_id = ?1 AND a.valid_to IS NULL`,
    )
    .bind(matterId)
    .all<ArrangementRow>();
  const row = results[0];
  return row ? toSnapshot(row) : undefined;
}

// The whole amendment history, newest first — every version the matter has ever been billed under,
// because an invoice composed under version 2 stays explicable after version 5 lands.
export async function readBillingArrangementHistory(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<BillingArrangementSnapshot[]> {
  const { results } = await database
    .prepare(
      `SELECT ${ARRANGEMENT_COLUMNS} ${ARRANGEMENT_FROM} WHERE a.matter_id = ?1 ORDER BY a.version DESC`,
    )
    .bind(matterId)
    .all<ArrangementRow>();
  return results.map(toSnapshot);
}

export async function readBillingArrangement(
  database: SqlDatabase,
  id: BillingArrangementId,
): Promise<BillingArrangementSnapshot | undefined> {
  const { results } = await database
    .prepare(`SELECT ${ARRANGEMENT_COLUMNS} ${ARRANGEMENT_FROM} WHERE a.id = ?1`)
    .bind(id)
    .all<ArrangementRow>();
  const row = results[0];
  return row ? toSnapshot(row) : undefined;
}

export interface SetBillingArrangementInput {
  readonly matterId: MatterId;
  readonly kind: BillingArrangementKind;
  readonly flatFeeAmountMinor?: number | null;
  readonly contingencyShareE4?: number | null;
  readonly contingencyBasis?: ContingencyBasis | null;
  readonly retainerTargetMinor?: number | null;
  readonly retainerThresholdMinor?: number | null;
  readonly advanceDepositDestination?: AdvanceDepositDestination | null;
  readonly currency: string;
  readonly validFrom: string; // civil PlainDate
  /** The signed agreement this version rests on, as a matter file. Optional: the paper may follow. */
  readonly agreementFileId?: FileId | null;
  readonly createdBy: UserId | null;
}

export interface ComposedBillingArrangement {
  readonly arrangementId: BillingArrangementId;
  readonly version: number;
  readonly effect: EffectWrite;
}

// Each kind carries exactly its own fields, refused HERE by name so the caller learns which field is
// wrong rather than watching the kind-shape CHECK abort the batch on a constraint name. The CHECK
// remains the guarantee.
function assertKindShape(input: SetBillingArrangementInput): void {
  // The explicit never annotation on the CONST is what lets the control-flow analysis treat a call
  // as terminal, so the null-checks below actually narrow.
  const refuse: (message: string) => never = (message) => {
    throw new BillingValidationError("billing-arrangement-invalid", message);
  };
  const flatFee = input.flatFeeAmountMinor ?? null;
  const share = input.contingencyShareE4 ?? null;
  const basis = input.contingencyBasis ?? null;
  const target = input.retainerTargetMinor ?? null;
  const threshold = input.retainerThresholdMinor ?? null;
  for (const [name, value] of [
    ["flatFeeAmountMinor", flatFee],
    ["contingencyShareE4", share],
    ["retainerTargetMinor", target],
    ["retainerThresholdMinor", threshold],
  ] as const) {
    if (value !== null && !Number.isInteger(value)) {
      refuse(`${name} must be a whole number of minor units or rate-scale units, got ${value}`);
    }
  }
  switch (input.kind) {
    case "hourly":
      if (flatFee !== null || share !== null || basis !== null || target !== null) {
        refuse(
          "an hourly arrangement carries no flat-fee, contingency, or retainer fields: it exists to say ON THE RECORD that the matter is billed hourly",
        );
      }
      break;
    case "flat_fee":
      if (flatFee === null || flatFee <= 0) {
        refuse("a flat-fee arrangement needs its fee: a positive flatFeeAmountMinor");
      }
      if (share !== null || basis !== null || target !== null || threshold !== null) {
        refuse("a flat-fee arrangement carries only its fee amount");
      }
      break;
    case "contingency":
      if (share === null || share <= 0 || share > 10_000) {
        refuse(
          "a contingency arrangement needs its share as a fraction of the recovery at the rate scale: above 0 and at most 10000 (the whole recovery)",
        );
      }
      if (basis === null) {
        refuse(
          "a contingency arrangement needs its costs election: gross_recovery (fee before costs come off) or net_after_costs (advanced costs deducted first)",
        );
      }
      if (flatFee !== null || target !== null || threshold !== null) {
        refuse("a contingency arrangement carries only its share and its costs election");
      }
      break;
    case "retainer":
      if (target === null || target <= 0) {
        refuse("a retainer arrangement needs its target balance: a positive retainerTargetMinor");
      }
      if (threshold === null || threshold < 0 || threshold > target) {
        refuse(
          "a retainer arrangement needs its replenishment floor: a retainerThresholdMinor between zero and the target",
        );
      }
      if (flatFee !== null || share !== null || basis !== null) {
        refuse("a retainer arrangement carries only its target and its floor");
      }
      break;
  }
}

// Sets or amends how a matter is billed. An amendment is a NEW version: the insert rides with the
// one-time close of the prior version's valid_to, so the history is append-only and "the agreement
// in force" is always exactly one row. Two concurrent amendments converge — both compute the same
// next version, and the loser aborts on the dense-version trigger or the open-row unique index.
export async function setBillingArrangement(
  database: SqlDatabase,
  input: SetBillingArrangementInput,
  options: BillingServiceOptions,
): Promise<ComposedBillingArrangement> {
  assertKindShape(input);

  const agreementFileId = input.agreementFileId ?? null;
  if (agreementFileId !== null && !(await fileExists(database, agreementFileId))) {
    // Refused here rather than discovered on the day the agreement is asked for: a version pointing
    // at a file that was already gone when it was recorded would produce a reference and no paper.
    throw new BillingValidationError(
      "billing-arrangement-invalid",
      `the signed agreement ${agreementFileId} is not a live file on this firm's record: pick it from the matter's own files`,
    );
  }

  const inForce = await readBillingArrangementInForce(database, input.matterId);
  if (inForce && input.validFrom < inForce.validFrom) {
    // The amendment supersedes FORWARD only. Back-dating a version behind the one in force would
    // make the closed intervals overlap, and which agreement governed a date in the overlap would
    // have two answers.
    throw new BillingValidationError(
      "billing-arrangement-invalid",
      `the new arrangement starts ${input.validFrom}, before the agreement in force started (${inForce.validFrom}): an amendment supersedes forward, and what governed an earlier date is the version that was in force then`,
    );
  }

  const arrangementId = newIdentifier("billingArrangement", options.randomSource);
  const now = options.clock.now();
  const version = (inForce?.version ?? 0) + 1;
  const statements: SqlStatement[] = [];
  if (inForce) {
    statements.push(
      // The one edit the superseded version ever takes. Guarded on still being open so a concurrent
      // amendment cannot close it twice; the trigger and the unique index are the guarantee.
      database
        .prepare(
          `UPDATE matter_billing_arrangement SET valid_to = ?2 WHERE id = ?1 AND valid_to IS NULL`,
        )
        .bind(inForce.id, input.validFrom),
    );
  }
  statements.push(
    database
      .prepare(
        `INSERT INTO matter_billing_arrangement (id, matter_id, version, kind, flat_fee_amount_minor, contingency_share_e4, contingency_basis, retainer_target_minor, retainer_threshold_minor, advance_deposit_destination, currency, valid_from, valid_to, agreement_file_id, created_at, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL, ?13, ?14, ?15)`,
      )
      .bind(
        arrangementId,
        input.matterId,
        version,
        input.kind,
        input.flatFeeAmountMinor ?? null,
        input.contingencyShareE4 ?? null,
        input.contingencyBasis ?? null,
        input.retainerTargetMinor ?? null,
        input.retainerThresholdMinor ?? null,
        input.advanceDepositDestination ?? null,
        input.currency,
        input.validFrom,
        agreementFileId,
        now,
        input.createdBy,
      ),
  );
  return { arrangementId, version, effect: { statements, outboxMessages: [] } };
}

// Whether the signed agreement is a live file. The same check the conflicts waiver makes of its
// evidencing document, and for the same reason: a reference the firm cannot produce is not a record.
async function fileExists(database: SqlDatabase, fileId: string): Promise<boolean> {
  const { results } = await database
    .prepare(`SELECT id FROM file WHERE id = ?1 AND deleted_at IS NULL`)
    .bind(fileId)
    .all<{ id: string }>();
  return results.length > 0;
}

// The arrangement a non-hourly composition requires, or a refusal that names what the matter
// actually is. One home for the sentence, because three fee-model paths say it.
export async function requireArrangementOfKind(
  database: SqlDatabase,
  matterId: MatterId,
  kind: Exclude<BillingArrangementKind, "hourly">,
): Promise<BillingArrangementSnapshot> {
  const inForce = await readBillingArrangementInForce(database, matterId);
  if (!inForce || inForce.kind !== kind) {
    throw new BillingValidationError(
      "billing-arrangement-kind-mismatch",
      `matter ${matterId} is billed ${describeArrangement(inForce)}, not under a ${kind.replace("_", " ")} agreement: record the agreement on the matter first`,
    );
  }
  return inForce;
}

export function describeArrangement(arrangement: BillingArrangementSnapshot | undefined): string {
  if (!arrangement) return "hourly (no arrangement is recorded)";
  return `under its ${arrangement.kind.replace("_", " ")} agreement (version ${arrangement.version})`;
}
