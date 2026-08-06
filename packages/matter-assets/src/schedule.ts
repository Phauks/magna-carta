import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterAssetId, MatterId } from "@magna-carta/identifiers/types";
import type { ResolvedMatterAssetValue } from "./as-of.ts";
import { MATTER_ASSET_CLASS_REGISTRY } from "./classes.ts";
import {
  readMatterAssetEncumbrancesForMatter,
  readEncumbranceBalancesAsOf,
  type MatterAssetEncumbranceRow,
} from "./encumbrance-statements.ts";
import { encumbrancesInForceAsOf, matterAssetEquity, type MatterAssetEquity } from "./equity.ts";
import { readMatterAssetPage } from "./queries.ts";
import { readMatterAssetTypeNames } from "./asset-type-statements.ts";
import {
  MATTER_ASSET_CLASSES,
  MAX_MATTER_ASSET_SCHEDULE,
  type MatterAssetClass,
  type MatterAssetEstateTreatment,
} from "./types.ts";
import { assertCivilDate, assertScheduleSize } from "./validation.ts";
import { readMatterAssetValuationsAsOf } from "./valuation-statements.ts";

// The estate schedule: the probate-inventory SHAPE, without the form.
//
// Three things it is not. It is NOT A COURT FORM — no jurisdiction's layout, no caption, no
// verification block; a firm assembles the filing it needs from these numbers through document
// automation. It is NOT A STORED DOCUMENT — it is a read, recomputed from the register every time, so
// a schedule and the register cannot drift. And IT DOES NOT DECIDE WHAT IS IN THE ESTATE: it groups by
// the `estate_treatment` a person asserted and reports `undetermined` as its own group rather than
// guessing, because whether a jointly held house passes outside probate turns on the form of
// co-ownership, which is jurisdiction-specific and the single fact this register most refuses to
// infer.
//
// THE AS-OF DATE IS REQUIRED AND HAS NO DEFAULT. A schedule with an implied date is the failure this
// subsystem most wants to avoid: the whole point is that the date of death and today give different
// answers over the same rows, and a caller who did not choose gets neither.
//
// THE UNVALUED ARE COUNTED, NOT HIDDEN. An asset with no figure at or before the date appears with no
// value and is counted, because "eleven of these forty have no number yet" is the actionable statement
// and a subtotal quietly computed over twenty-nine is not.

export interface MatterAssetScheduleRow {
  readonly assetId: MatterAssetId;
  readonly description: string;
  readonly assetTypeName: string | null;
  readonly estateTreatment: MatterAssetEstateTreatment;
  readonly disposition: string;
  readonly acquiredOn: string | null;
  // Whether the firm holds the physical original. The HANDLE only — no location, no status, no hold:
  // those are Custodian's facts and a schedule that copied them would be stating them stale.
  readonly custodyItemId: string | null;
  readonly value: ResolvedMatterAssetValue | undefined;
  readonly equity: MatterAssetEquity;
}

export interface MatterAssetScheduleGroupSubtotal {
  readonly currency: string;
  readonly valueAmountMinor: number;
  // Present only where every asset in the group that has a value also has a statable equity. One
  // unstated balance makes a group equity subtotal a number that looks complete and is not.
  readonly equityAmountMinor: number | undefined;
  // How many of the group's rows contributed to this currency's totals.
  readonly countedAssets: number;
}

export interface MatterAssetScheduleGroup {
  readonly assetClass: MatterAssetClass;
  readonly label: string;
  readonly rows: readonly MatterAssetScheduleRow[];
  // Per currency, and never across them. A group holding dollars and pounds reports two subtotals, not
  // one converted figure — the exchange rate on a date is a fact the firm's data does not carry.
  readonly subtotals: readonly MatterAssetScheduleGroupSubtotal[];
  readonly unvaluedCount: number;
}

export interface MatterAssetSchedule {
  readonly matterId: MatterId;
  // The date asked for. Every figure below resolved at or before it, and each carries the date it
  // actually speaks to.
  readonly asOfDate: string;
  // Every class that has a row, in the class registry's order. A class with no assets is omitted —
  // a heading with nothing under it is noise on an inventory, unlike the `undetermined` estate group,
  // which is present because it means something.
  readonly groups: readonly MatterAssetScheduleGroup[];
  readonly totalAssets: number;
  readonly unvaluedCount: number;
  // How many assets sit under each estate treatment, `undetermined` INCLUDED and never merged away.
  readonly estateTreatmentCounts: Readonly<Record<MatterAssetEstateTreatment, number>>;
}

// Five batched reads for a whole schedule, whatever the matter's size: the register, the type names,
// the as-of values, the charges, and the balances. Never one read per asset — that is the plan this
// subsystem's load profile watches, and the one an obvious implementation gets wrong.
export async function readMatterAssetSchedule(
  database: SqlDatabase,
  matterId: MatterId,
  asOfDate: string,
): Promise<MatterAssetSchedule> {
  assertCivilDate(asOfDate, "asOf");

  // One over the bound so an oversized register is REFUSED rather than silently truncated: a firm that
  // filed the first five hundred rows of an inventory could not tell that from an inventory of five
  // hundred.
  const assets = await readMatterAssetPage(database, matterId, {
    limit: MAX_MATTER_ASSET_SCHEDULE + 1,
  });
  assertScheduleSize(assets.length);

  const assetIds = assets.map((asset) => asset.id);
  const typeIds = [
    ...new Set(assets.map((asset) => asset.asset_type_id).filter((id) => id !== null)),
  ];
  const [typeNames, values, encumbrances] = await Promise.all([
    readMatterAssetTypeNames(database, typeIds),
    readMatterAssetValuationsAsOf(database, assetIds, asOfDate),
    readMatterAssetEncumbrancesForMatter(database, assetIds),
  ]);

  const inForce = new Map<MatterAssetId, MatterAssetEncumbranceRow[]>();
  for (const encumbrance of encumbrancesInForceAsOf(encumbrances, asOfDate)) {
    const existing = inForce.get(encumbrance.asset_id);
    if (existing === undefined) inForce.set(encumbrance.asset_id, [encumbrance]);
    else existing.push(encumbrance);
  }
  const balances = await readEncumbranceBalancesAsOf(
    database,
    [...inForce.values()].flat().map((encumbrance) => encumbrance.id),
    asOfDate,
  );

  const rowsByClass = new Map<MatterAssetClass, MatterAssetScheduleRow[]>();
  const estateTreatmentCounts: Record<MatterAssetEstateTreatment, number> = {
    probateEstate: 0,
    nonProbateTransfer: 0,
    undetermined: 0,
  };
  let unvaluedCount = 0;

  for (const asset of assets) {
    const valuation = values.get(asset.id);
    const value: ResolvedMatterAssetValue | undefined =
      valuation === undefined
        ? undefined
        : {
            valuationId: valuation.id,
            asOfDate: valuation.as_of_date,
            amountMinor: valuation.amount_minor,
            currency: valuation.currency,
            basis: valuation.basis,
            sourceNote: valuation.source_note,
            supportingFileId: valuation.supporting_file_id,
            recordedAt: valuation.recorded_at,
          };
    if (value === undefined) unvaluedCount += 1;
    estateTreatmentCounts[asset.estate_treatment] += 1;
    const row: MatterAssetScheduleRow = {
      assetId: asset.id,
      description: asset.description,
      assetTypeName:
        asset.asset_type_id === null ? null : (typeNames.get(asset.asset_type_id) ?? null),
      estateTreatment: asset.estate_treatment,
      disposition: asset.disposition,
      acquiredOn: asset.acquired_on,
      custodyItemId: asset.custody_item_id,
      value,
      equity: matterAssetEquity(value, inForce.get(asset.id) ?? [], balances),
    };
    const existing = rowsByClass.get(asset.class);
    if (existing === undefined) rowsByClass.set(asset.class, [row]);
    else existing.push(row);
  }

  const groups: MatterAssetScheduleGroup[] = [];
  for (const assetClass of MATTER_ASSET_CLASSES) {
    const rows = rowsByClass.get(assetClass);
    if (rows === undefined) continue;
    groups.push({
      assetClass,
      label:
        MATTER_ASSET_CLASS_REGISTRY.find((declaration) => declaration.key === assetClass)?.label ??
        assetClass,
      rows,
      subtotals: subtotalsFor(rows),
      unvaluedCount: rows.filter((row) => row.value === undefined).length,
    });
  }

  return {
    matterId,
    asOfDate,
    groups,
    totalAssets: assets.length,
    unvaluedCount,
    estateTreatmentCounts,
  };
}

// Per currency, and never across them. An equity subtotal exists only where EVERY valued row in the
// currency could state one — a group with one unstated mortgage balance reports its value subtotal and
// no equity subtotal, which is a true statement, rather than an equity subtotal computed over the rows
// that happened to work.
function subtotalsFor(
  rows: readonly MatterAssetScheduleRow[],
): readonly MatterAssetScheduleGroupSubtotal[] {
  const byCurrency = new Map<
    string,
    { value: number; equity: number; countedAssets: number; equityComplete: boolean }
  >();
  for (const row of rows) {
    const currency = row.value?.currency;
    const amount = row.value?.amountMinor;
    if (currency === undefined || currency === null || amount === undefined || amount === null) {
      continue;
    }
    const running = byCurrency.get(currency) ?? {
      value: 0,
      equity: 0,
      countedAssets: 0,
      equityComplete: true,
    };
    running.value += amount;
    running.countedAssets += 1;
    if (row.equity.equityAmountMinor === undefined || row.equity.equityCurrency !== currency) {
      running.equityComplete = false;
    } else {
      running.equity += row.equity.equityAmountMinor;
    }
    byCurrency.set(currency, running);
  }
  return [...byCurrency.entries()]
    .map(([currency, running]) => ({
      currency,
      valueAmountMinor: running.value,
      equityAmountMinor: running.equityComplete ? running.equity : undefined,
      countedAssets: running.countedAssets,
    }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
}
