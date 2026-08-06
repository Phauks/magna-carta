import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterAssetId } from "@magna-carta/identifiers/types";
import {
  selectMatterAssetValuationAsOfStatement,
  type MatterAssetValuationRow,
} from "./valuation-statements.ts";
import type { MatterAssetValuationBasis } from "./types.ts";

// The as-of read: what was this asset worth, as of a date, and on what footing.
//
// THE ANSWER ALWAYS TRAVELS WITH ITS DATE. There is no path in this subsystem by which a value is
// returned without the as_of_date and basis it came from — an undated figure in a filed document is
// the failure mode with the worst consequences, so the shape of the return makes it unrepresentable
// rather than leaving it to each caller's discipline.
//
// Where the date COMES FROM is not this subsystem's fact. For an estate it is the date of death,
// which belongs to the estate record alone; the register reads a date and never stores a second copy
// of one.

export interface ResolvedMatterAssetValue {
  readonly valuationId: string;
  // The date the resolved figure SPEAKS TO, which is at or before the date asked for and is
  // frequently earlier than it. Reported so a reader can see how stale the answer is.
  readonly asOfDate: string;
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly basis: MatterAssetValuationBasis;
  readonly sourceNote: string | null;
  readonly supportingFileId: string | null;
  // When the assertion was MADE, as against the date it speaks to. An appraisal dated the day of
  // death is typed in four months later, and both facts matter.
  readonly recordedAt: string;
}

// Returns the resolved value, or undefined when the asset has no valuation at or before the date.
// UNDEFINED IS A CORRECT AND COMMON ANSWER — an unvalued asset reports as unvalued, visibly, which
// is a true statement and an actionable one. Nothing here falls back to the earliest figure, to a
// purchase price, or to an estimate.
export async function resolveMatterAssetValueAsOf(
  database: SqlDatabase,
  assetId: MatterAssetId,
  asOfDate: string,
): Promise<ResolvedMatterAssetValue | undefined> {
  const { results } = await selectMatterAssetValuationAsOfStatement(
    database,
    assetId,
    asOfDate,
  ).all<MatterAssetValuationRow>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    valuationId: row.id,
    asOfDate: row.as_of_date,
    amountMinor: row.amount_minor,
    currency: row.currency,
    basis: row.basis,
    sourceNote: row.source_note,
    supportingFileId: row.supporting_file_id,
    recordedAt: row.recorded_at,
  };
}
