import {
  readWorkInProgressBreakdown,
  type WorkInProgressBreakdownRow,
} from "@magna-carta/billing/queries";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { compare } from "@magna-carta/money/compare";
import { fromMinor, toMinor } from "@magna-carta/money/format";
import { add, USD } from "@magna-carta/money/money";
import { completeScope, type ReportCompleteness } from "../completeness.ts";
import { ReportingValidationError } from "../reporting-validation.ts";

// WORK IN PROGRESS — unbilled time and costs as they stand now, per office, client, matter and
// timekeeper.
//
// LIVE ONLY. The time and cost stores are mutable until an entry is billed or voided and carry no
// stamp of when that happened, so no knowledge instant would make this reproduce; the read takes no
// date and the response says when it was computed. The figures are billing's breakdown rows added
// together and nothing else, and test/financial-work-in-progress.test.ts proves the roll-ups sum to
// those rows. Billing's own test proves the rows agree with its per-matter read.
//
// Work on a draft bill is shown in its own column: it is unbilled until the draft is finalized.

export interface WorkInProgressFigures {
  // Minutes of unbilled time with a value on it, on no draft and on drafts together.
  readonly timeMinutes: number;
  // Unbilled time no draft holds.
  readonly timeMinor: number;
  // Unbilled costs no draft holds.
  readonly costMinor: number;
  // Time and costs a draft bill holds, not yet finalized.
  readonly onDraftMinor: number;
  // Everything unbilled: time, costs and what drafts hold.
  readonly totalMinor: number;
}

export interface WorkInProgressMatterRow {
  readonly matterId: string;
  readonly matterTitle: string;
  readonly matterNumber: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly figures: WorkInProgressFigures;
}

export interface WorkInProgressReport {
  readonly computedAt: string;
  readonly reproducible: false;
  readonly statement: string;
  readonly locationId: string | null;
  readonly currency: "USD";
  readonly completeness: ReportCompleteness;
  readonly totals: WorkInProgressFigures;
  readonly offices: readonly {
    readonly locationId: string | null;
    readonly locationName: string | null;
    readonly figures: WorkInProgressFigures;
  }[];
  readonly clients: readonly {
    readonly clientEntityId: string | null;
    readonly clientName: string | null;
    readonly figures: WorkInProgressFigures;
    readonly matters: readonly WorkInProgressMatterRow[];
  }[];
  readonly timekeepers: readonly {
    readonly timekeeperUserId: string;
    readonly timekeeperName: string | null;
    readonly figures: WorkInProgressFigures;
  }[];
}

const usd = (minor: number) => fromMinor(minor, USD);
const plus = (left: number, right: number): number => toMinor(add(usd(left), usd(right)));

class Accumulator {
  timeMinutes = 0;
  timeMinor = 0;
  costMinor = 0;
  onDraftMinor = 0;

  take(row: WorkInProgressBreakdownRow): void {
    // Minutes are a count, not money.
    this.timeMinutes += row.minutes;
    if (row.onDraft) this.onDraftMinor = plus(this.onDraftMinor, row.amountMinor);
    else if (row.kind === "time") this.timeMinor = plus(this.timeMinor, row.amountMinor);
    else this.costMinor = plus(this.costMinor, row.amountMinor);
  }

  figures(): WorkInProgressFigures {
    return {
      timeMinutes: this.timeMinutes,
      timeMinor: this.timeMinor,
      costMinor: this.costMinor,
      onDraftMinor: this.onDraftMinor,
      totalMinor: plus(plus(this.timeMinor, this.costMinor), this.onDraftMinor),
    };
  }
}

const byTotalDescending = (
  left: { readonly figures: WorkInProgressFigures },
  right: { readonly figures: WorkInProgressFigures },
): number => compare(usd(right.figures.totalMinor), usd(left.figures.totalMinor));

function accumulatorFor<Key, Caption>(
  map: Map<Key, { caption: Caption; accumulator: Accumulator }>,
  key: Key,
  caption: Caption,
): Accumulator {
  const existing = map.get(key);
  if (existing) return existing.accumulator;
  const created = { caption, accumulator: new Accumulator() };
  map.set(key, created);
  return created.accumulator;
}

export function workInProgressStatement(computedAt: string): string {
  return (
    `This report shows unbilled time and costs as they stood when it was produced, at ${computedAt}. ` +
    `Time and cost entries can still be edited until they are billed, so it is a live report: running ` +
    `it again later will reflect any change made in the meantime, and it is not claimed to reproduce.`
  );
}

export async function assembleWorkInProgress(
  database: SqlDatabase,
  input: { readonly locationId: string | null },
  options: { readonly computedAt: string },
): Promise<WorkInProgressReport> {
  const breakdown = await readWorkInProgressBreakdown(database);
  if (breakdown.truncated) {
    throw new ReportingValidationError(
      "reporting-breakdown-truncated",
      "more matters and timekeepers have unbilled work than one report can list; choose an office to narrow it",
    );
  }
  const rows = breakdown.rows.filter(
    (row) => input.locationId === null || row.locationId === input.locationId,
  );

  const totals = new Accumulator();
  const offices = new Map<
    string,
    { caption: { id: string | null; name: string | null }; accumulator: Accumulator }
  >();
  const clients = new Map<
    string,
    {
      caption: {
        id: string | null;
        name: string | null;
        matters: Map<string, { caption: WorkInProgressBreakdownRow; accumulator: Accumulator }>;
      };
      accumulator: Accumulator;
    }
  >();
  const timekeepers = new Map<string, { caption: string | null; accumulator: Accumulator }>();

  for (const row of rows) {
    totals.take(row);
    accumulatorFor(offices, row.locationId ?? "", {
      id: row.locationId,
      name: row.locationName,
    }).take(row);
    const clientKey = row.clientEntityId ?? "";
    accumulatorFor(clients, clientKey, {
      id: row.clientEntityId,
      name: row.clientName,
      matters: new Map(),
    }).take(row);
    const client = clients.get(clientKey);
    if (client) accumulatorFor(client.caption.matters, row.matterId, row).take(row);
    if (row.timekeeperUserId !== null) {
      accumulatorFor(timekeepers, row.timekeeperUserId, row.timekeeperName).take(row);
    }
  }

  return {
    computedAt: options.computedAt,
    reproducible: false,
    statement: workInProgressStatement(options.computedAt),
    locationId: input.locationId,
    currency: "USD",
    completeness: completeScope(),
    totals: totals.figures(),
    offices: [...offices.values()]
      .map(({ caption, accumulator }) => ({
        locationId: caption.id,
        locationName: caption.name,
        figures: accumulator.figures(),
      }))
      .sort(byTotalDescending),
    clients: [...clients.values()]
      .map(({ caption, accumulator }) => ({
        clientEntityId: caption.id,
        clientName: caption.name,
        figures: accumulator.figures(),
        matters: [...caption.matters.values()]
          .map(({ caption: matter, accumulator: matterAccumulator }) => ({
            matterId: matter.matterId,
            matterTitle: matter.matterTitle,
            matterNumber: matter.matterNumber,
            locationId: matter.locationId,
            locationName: matter.locationName,
            figures: matterAccumulator.figures(),
          }))
          .sort(byTotalDescending),
      }))
      .sort(byTotalDescending),
    timekeepers: [...timekeepers.entries()]
      .map(([timekeeperUserId, { caption, accumulator }]) => ({
        timekeeperUserId,
        timekeeperName: caption,
        figures: accumulator.figures(),
      }))
      .sort(byTotalDescending),
  };
}
