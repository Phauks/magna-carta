import { readMatterCaptions, type MatterCaption } from "@magna-carta/billing/queries";
import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { listTrustAccounts } from "@magna-carta/trust/account-tree";
import { selectTrustMatterLeafBalancesAsOfStatement } from "@magna-carta/trust/statements";
import { fromMinor, toMinor } from "@magna-carta/money/format";
import { add, USD } from "@magna-carta/money/money";
import { completeScope, type ReportCompleteness } from "../completeness.ts";
import { ReportingValidationError } from "../reporting-validation.ts";
import { assembleAccountsReceivableAging } from "./accounts-receivable-aging.ts";
import { assembleWorkInProgress } from "./work-in-progress.ts";

// MATTER BALANCES — where each matter stands with its client: work not yet billed, what its bills
// still owe, and what the firm holds for it in trust, per office, client and matter.
//
// NOTHING HERE IS A NEW FIGURE. Each column is a decomposition of an answer another module owns,
// read through that module and moved onto the matter's row:
//   - unbilled is the work-in-progress report's per-matter total (billing's breakdown rows);
//   - owed is the receivables aging's per-matter total, taken as of the day the report is produced;
//   - in trust is trust's own per-leaf balance (the read the compliance pack prints opening and
//     closing balances from), added across the trust accounts a matter has a ledger in.
// test/financial-matter-balances.test.ts proves each column's total equals the total its owner
// produces. No column is added to another: a matter's unbilled work, its debt and its trust money are
// three facts, and a "net" figure would be a fourth answer nobody owns.
//
// LIVE ONLY. Unbilled work is mutable until it is billed and carries no stamp of when it changed, so
// the whole report is a statement about now: it takes no date and no knowledge instant, and says when
// it was computed. The owed and trust columns are taken through the day the report is produced (the
// UTC day of `computedAt`) as known at `computedAt`, so all three describe the same moment.
//
// Trust money is reported in US dollars, the one currency the other two columns are in. A trust
// account in another currency that holds money for a matter refuses the report by name rather than
// leaving that money out of a column a reader will take as complete.

export interface MatterBalanceFigures {
  readonly unbilledMinor: number;
  readonly owedMinor: number;
  readonly trustMinor: number;
}

export interface MatterBalanceMatterRow {
  readonly matterId: string;
  readonly matterTitle: string;
  readonly matterNumber: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly figures: MatterBalanceFigures;
}

export interface MatterBalancesReport {
  readonly computedAt: string;
  readonly asOfDate: string;
  readonly reproducible: false;
  readonly statement: string;
  readonly locationId: string | null;
  readonly currency: "USD";
  readonly completeness: ReportCompleteness;
  readonly totals: MatterBalanceFigures;
  readonly offices: readonly {
    readonly locationId: string | null;
    readonly locationName: string | null;
    readonly figures: MatterBalanceFigures;
  }[];
  readonly clients: readonly {
    readonly clientEntityId: string | null;
    readonly clientName: string | null;
    readonly figures: MatterBalanceFigures;
    readonly matters: readonly MatterBalanceMatterRow[];
  }[];
}

// The most matters one report lists, matching the ceiling of the reads it is built from.
const MAXIMUM_MATTERS = 5000;

const usd = (minor: number) => fromMinor(minor, USD);
const plus = (left: number, right: number): number => toMinor(add(usd(left), usd(right)));

class Accumulator {
  unbilledMinor = 0;
  owedMinor = 0;
  trustMinor = 0;

  take(figures: MatterBalanceFigures): void {
    this.unbilledMinor = plus(this.unbilledMinor, figures.unbilledMinor);
    this.owedMinor = plus(this.owedMinor, figures.owedMinor);
    this.trustMinor = plus(this.trustMinor, figures.trustMinor);
  }

  figures(): MatterBalanceFigures {
    return {
      unbilledMinor: this.unbilledMinor,
      owedMinor: this.owedMinor,
      trustMinor: this.trustMinor,
    };
  }
}

export function matterBalancesStatement(computedAt: string): string {
  return (
    `This report shows each matter's unbilled work, what its bills still owe and what is held for it ` +
    `in trust, as they stood when it was produced, at ${computedAt}. Time and cost entries can still ` +
    `be edited until they are billed, so it is a live report: running it again later will reflect any ` +
    `change made in the meantime, and it is not claimed to reproduce.`
  );
}

interface LeafBalanceRow {
  readonly matter_id: string;
  readonly balance_minor: number;
}

// Every matter's trust balance across every US-dollar trust account, through `asOfDate` as known at
// `computedAt`. Accounts are read a page at a time; a firm has a handful.
async function trustByMatter(
  database: SqlDatabase,
  asOfDate: string,
  computedAt: string,
): Promise<Map<string, number>> {
  const byMatter = new Map<string, number>();
  let cursor: string | undefined;
  do {
    const page = await listTrustAccounts(database, cursor === undefined ? {} : { cursor });
    const balances = await Promise.all(
      page.data.map(async (account) => ({
        account,
        leaves: (
          await selectTrustMatterLeafBalancesAsOfStatement(
            database,
            account.id,
            asOfDate,
            computedAt,
          ).all<LeafBalanceRow>()
        ).results,
      })),
    );
    for (const { account, leaves } of balances) {
      for (const leaf of leaves) {
        if (leaf.balance_minor === 0) continue;
        if (account.currency !== USD.code) {
          throw new ReportingValidationError(
            "reporting-currency-not-reported",
            `the trust account "${account.name}" holds ${account.currency} for a matter, and this report states trust money in US dollars only`,
          );
        }
        byMatter.set(leaf.matter_id, plus(byMatter.get(leaf.matter_id) ?? 0, leaf.balance_minor));
      }
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return byMatter;
}

const byName = (
  left: { readonly name: string | null; readonly id: string | null },
  right: { readonly name: string | null; readonly id: string | null },
): number =>
  (left.name ?? "").localeCompare(right.name ?? "") ||
  (left.id ?? "").localeCompare(right.id ?? "");

const byMatterCaption = (left: MatterBalanceMatterRow, right: MatterBalanceMatterRow): number =>
  (left.matterNumber ?? "").localeCompare(right.matterNumber ?? "") ||
  left.matterTitle.localeCompare(right.matterTitle) ||
  left.matterId.localeCompare(right.matterId);

export async function assembleMatterBalances(
  database: SqlDatabase,
  input: { readonly locationId: string | null },
  options: { readonly computedAt: string },
): Promise<MatterBalancesReport> {
  const asOfDate = civilDateOf(options.computedAt);
  const [workInProgress, aging, trust] = await Promise.all([
    assembleWorkInProgress(database, { locationId: null }, options),
    assembleAccountsReceivableAging(
      database,
      { asOfDate, knownAsOf: options.computedAt, locationId: null },
      options,
    ),
    trustByMatter(database, asOfDate, options.computedAt),
  ]);

  const perMatter = new Map<string, Accumulator>();
  const take = (matterId: string, figures: MatterBalanceFigures): void => {
    const accumulator = perMatter.get(matterId) ?? new Accumulator();
    accumulator.take(figures);
    perMatter.set(matterId, accumulator);
  };
  for (const client of workInProgress.clients) {
    for (const matter of client.matters) {
      take(matter.matterId, {
        unbilledMinor: matter.figures.totalMinor,
        owedMinor: 0,
        trustMinor: 0,
      });
    }
  }
  for (const client of aging.clients) {
    for (const matter of client.matters) {
      take(matter.matterId, { unbilledMinor: 0, owedMinor: matter.totalMinor, trustMinor: 0 });
    }
  }
  for (const [matterId, trustMinor] of trust) {
    take(matterId, { unbilledMinor: 0, owedMinor: 0, trustMinor });
  }
  if (perMatter.size > MAXIMUM_MATTERS) {
    throw new ReportingValidationError(
      "reporting-breakdown-truncated",
      "more matters have a balance than one report can list; choose an office to narrow it",
    );
  }

  const captions = new Map<string, MatterCaption>(
    (await readMatterCaptions(database, [...perMatter.keys()])).map((caption) => [
      caption.matterId,
      caption,
    ]),
  );

  const totals = new Accumulator();
  const offices = new Map<
    string,
    { id: string | null; name: string | null; accumulator: Accumulator }
  >();
  const clients = new Map<
    string,
    {
      id: string | null;
      name: string | null;
      accumulator: Accumulator;
      matters: MatterBalanceMatterRow[];
    }
  >();
  for (const [matterId, accumulator] of perMatter) {
    const caption = captions.get(matterId);
    // A figure names a matter by a foreign key, so its caption cannot be missing; a report that
    // skipped the row would quietly leave money out of every total.
    if (caption === undefined) throw new Error(`matter balances: no caption for ${matterId}`);
    if (input.locationId !== null && caption.locationId !== input.locationId) continue;
    const figures = accumulator.figures();
    totals.take(figures);

    const officeKey = caption.locationId ?? "";
    const office = offices.get(officeKey) ?? {
      id: caption.locationId,
      name: caption.locationName,
      accumulator: new Accumulator(),
    };
    office.accumulator.take(figures);
    offices.set(officeKey, office);

    const clientKey = caption.clientEntityId ?? "";
    const client = clients.get(clientKey) ?? {
      id: caption.clientEntityId,
      name: caption.clientName,
      accumulator: new Accumulator(),
      matters: [],
    };
    client.accumulator.take(figures);
    client.matters.push({
      matterId,
      matterTitle: caption.matterTitle,
      matterNumber: caption.matterNumber,
      locationId: caption.locationId,
      locationName: caption.locationName,
      figures,
    });
    clients.set(clientKey, client);
  }

  return {
    computedAt: options.computedAt,
    asOfDate,
    reproducible: false,
    statement: matterBalancesStatement(options.computedAt),
    locationId: input.locationId,
    currency: "USD",
    completeness: completeScope(),
    totals: totals.figures(),
    offices: [...offices.values()].sort(byName).map((office) => ({
      locationId: office.id,
      locationName: office.name,
      figures: office.accumulator.figures(),
    })),
    clients: [...clients.values()].sort(byName).map((client) => ({
      clientEntityId: client.id,
      clientName: client.name,
      figures: client.accumulator.figures(),
      matters: client.matters.sort(byMatterCaption),
    })),
  };
}
