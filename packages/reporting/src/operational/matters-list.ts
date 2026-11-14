import { readMatterRegister, type MatterRegisterRow } from "@magna-carta/matters/matter-register";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { completeScope, type ReportCompleteness } from "../completeness.ts";
import { ReportingValidationError } from "../reporting-validation.ts";

// MATTERS LIST — every matter the firm has opened, with its number, client, type, office, responsible
// attorney and the days it opened and closed, and how many are open, on hold and closed per office.
//
// Counts, never money. The rows are the matters package's own read, listed as served; the counts are
// the rows counted, and test/operational-matters-list.test.ts proves every office's counts add up to
// the whole and every row is listed.
//
// LIVE ONLY. A matter is a mutable record, so the report takes no date and no knowledge instant and
// says when it was computed.

export interface MatterStatusCounts {
  readonly matterCount: number;
  readonly openCount: number;
  readonly heldCount: number;
  readonly closedCount: number;
}

export interface MattersListReport {
  readonly computedAt: string;
  readonly reproducible: false;
  readonly statement: string;
  readonly locationId: string | null;
  readonly completeness: ReportCompleteness;
  readonly totals: MatterStatusCounts;
  readonly offices: readonly {
    readonly locationId: string | null;
    readonly locationName: string | null;
    readonly counts: MatterStatusCounts;
  }[];
  readonly matters: readonly MatterRegisterRow[];
}

class Counter {
  matterCount = 0;
  openCount = 0;
  heldCount = 0;
  closedCount = 0;

  take(row: MatterRegisterRow): void {
    this.matterCount += 1;
    if (row.status === "open") this.openCount += 1;
    else if (row.status === "hold") this.heldCount += 1;
    else this.closedCount += 1;
  }

  counts(): MatterStatusCounts {
    return {
      matterCount: this.matterCount,
      openCount: this.openCount,
      heldCount: this.heldCount,
      closedCount: this.closedCount,
    };
  }
}

export function mattersListStatement(computedAt: string): string {
  return (
    `This report lists the firm's matters as they stood when it was produced, at ${computedAt}. ` +
    `A matter can be retyped, moved to another office, closed or reopened, so it is a live report: ` +
    `running it again later will reflect any change made in the meantime, and it is not claimed to reproduce.`
  );
}

export async function assembleMattersList(
  database: SqlDatabase,
  input: { readonly locationId: string | null },
  options: { readonly computedAt: string },
): Promise<MattersListReport> {
  const register = await readMatterRegister(database, input);
  if (register.truncated) {
    throw new ReportingValidationError(
      "reporting-breakdown-truncated",
      "the firm has more matters than one report can list; choose an office to narrow it",
    );
  }

  const totals = new Counter();
  const offices = new Map<
    string,
    { locationId: string | null; locationName: string | null; counter: Counter }
  >();
  for (const row of register.rows) {
    totals.take(row);
    const key = row.locationId ?? "";
    const office = offices.get(key) ?? {
      locationId: row.locationId,
      locationName: row.locationName,
      counter: new Counter(),
    };
    office.counter.take(row);
    offices.set(key, office);
  }

  return {
    computedAt: options.computedAt,
    reproducible: false,
    statement: mattersListStatement(options.computedAt),
    locationId: input.locationId,
    completeness: completeScope(),
    totals: totals.counts(),
    offices: [...offices.values()]
      .sort(
        (left, right) =>
          (left.locationName ?? "").localeCompare(right.locationName ?? "") ||
          (left.locationId ?? "").localeCompare(right.locationId ?? ""),
      )
      .map((office) => ({
        locationId: office.locationId,
        locationName: office.locationName,
        counts: office.counter.counts(),
      })),
    matters: register.rows,
  };
}
