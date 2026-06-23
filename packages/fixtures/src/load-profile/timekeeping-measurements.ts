import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { NodeSqlStatement } from "@magna-carta/database/node-sqlite";
import { resolveRate } from "@magna-carta/timekeeping/rate-resolution";
import { computeAmountMinor, roundDuration } from "@magna-carta/timekeeping/rounding";
import {
  listUnbilledByMatter,
  listUnbilledByMatterStatement,
  listWeeklyGrid,
  listWeeklyGridStatement,
} from "@magna-carta/timekeeping/queries";
import { readMyDay } from "@magna-carta/timekeeping/my-day";
import { captureTimeEntry, type CaptureRate } from "@magna-carta/timekeeping/time-entry-service";
import { fixtureContext, type FixtureContext } from "../context.ts";
import { explainStatement, type LabeledPlan, type Measurement } from "./runner.ts";
import type { LoadedSnapshot } from "./snapshot.ts";

// The timekeeping volume-shaped measured set: the My Day daily totals read, the weekly-grid fan, the
// per-matter unbilled-WIP read (the billing query), and rate resolution — each riding the REAL read
// path, so the index walks are on the clock. The cost depends on the data SHAPE the timekeeping
// generator laid down — a timekeeper with a span of daily entries, a matter with an unbilled backlog,
// and a card with effective-dated rate history.

export interface TimekeepingMeasurementHandle {
  readonly snapshot: LoadedSnapshot;
  readonly context: FixtureContext;
}

// The measurement context derives a DIFFERENT seed (`${seed}:timekeeping-measure`): replaying the
// generation seed would mint the exact identifier sequence the snapshot already contains, producing
// UNIQUE collisions on the first measured write. Disjoint stream keeps determinism without collision.
export function timekeepingMeasurementHandle(
  snapshot: LoadedSnapshot,
  seed: string,
): TimekeepingMeasurementHandle {
  return { snapshot, context: fixtureContext(`${seed}:timekeeping-measure`) };
}

export const timekeepingMeasurements: readonly Measurement<
  TimekeepingMeasurementHandle,
  unknown
>[] = [
  {
    name: "my-day.daily-totals",
    operation: async (handle) => {
      const { timeProbes } = handle.snapshot.manifest;
      await readMyDay(handle.snapshot.database, {
        timekeeperUserId: timeProbes.busiestTimekeeperUserId,
        workDate: timeProbes.probeWorkDate,
        targets: { targetDailyMinutes: 480 },
      });
    },
  },
  {
    name: "weekly-grid.by-timekeeper",
    operation: async (handle) => {
      const { timeProbes } = handle.snapshot.manifest;
      await listWeeklyGrid(handle.snapshot.database, {
        timekeeperUserId: timeProbes.busiestTimekeeperUserId,
        fromDate: timeProbes.probeWorkDate,
        toDate: timeProbes.probeWorkDate,
      });
    },
  },
  {
    name: "unbilled-wip.by-matter",
    operation: async (handle) => {
      const { timeProbes } = handle.snapshot.manifest;
      await listUnbilledByMatter(handle.snapshot.database, {
        matterId: timeProbes.busiestMatterId,
      });
    },
  },
  {
    name: "rate-resolution.timekeeper-tier",
    operation: async (handle) => {
      const { timeProbes } = handle.snapshot.manifest;
      await resolveRate(handle.snapshot.database, {
        matterId: timeProbes.resolutionMatterId,
        clientId: null,
        timekeeperUserId: timeProbes.resolutionTimekeeperUserId,
        roleId: null,
        workDate: timeProbes.probeWorkDate,
        rateCardId: timeProbes.rateCardId,
      });
    },
  },
  {
    name: "capture.commit",
    operation: async (handle) => {
      const { timeProbes } = handle.snapshot.manifest;
      const resolution = await resolveRate(handle.snapshot.database, {
        matterId: timeProbes.resolutionMatterId,
        clientId: null,
        timekeeperUserId: timeProbes.resolutionTimekeeperUserId,
        roleId: null,
        workDate: timeProbes.probeWorkDate,
        rateCardId: timeProbes.rateCardId,
      });
      const durationMinutes = roundDuration(30, 6, "nearest");
      const captureRate: CaptureRate =
        "noRate" in resolution
          ? { noRate: true }
          : {
              rateE4: resolution.rateE4,
              rateCardId: resolution.rateCardId,
              rateSource: resolution.rateSource,
              currency: resolution.currency,
              amountMinor: computeAmountMinor(resolution.rateE4, durationMinutes, resolution.currency),
            };
      const currency = "noRate" in resolution ? "USD" : resolution.currency;
      const captured = await captureTimeEntry(
        handle.snapshot.database,
        {
          matterId: timeProbes.resolutionMatterId,
          timekeeperUserId: timeProbes.resolutionTimekeeperUserId,
          workDate: timeProbes.probeWorkDate,
          rawDurationMinutes: 30,
          durationMinutes,
          narrative: "Load-profile measurement capture",
          billable: true,
          source: "manual",
          currency,
          rate: captureRate,
        },
        {
          clock: handle.context.clock,
          actorUserId: timeProbes.resolutionTimekeeperUserId,
          randomSource: handle.context.randomSource,
        },
      );
      await commitEffectBatch(handle.snapshot.database, captured.effect, {
        now: () => handle.context.clock.now(),
      });
    },
  },
];

// No timekeeping read is a table-wide aggregate — each must walk an index or the primary key. The
// allowlist is empty (kept as the explicit seam a future table-wide rollup would register through).
export const TIMEKEEPING_PLAN_SCAN_ALLOWLIST: readonly string[] = [];

// Recover the runtime node-sqlite shape so the EXPLAIN probes run the REAL query SQL (the query builders
// type their return as the narrower D1-shaped SqlStatement, which omits sql/bindings).
function capturedStatement(statement: SqlStatement): NodeSqlStatement {
  return statement as NodeSqlStatement;
}

// The My Day query is an inlined prepare in my-day.ts; to EXPLAIN it we reproduce the SQL here, bound to
// the same parameters. The SQL must match my-day.ts exactly — a single integration test (the plan-scan
// guard itself) will catch any drift via a failing EXPLAIN on a populated snapshot.
function myDayStatement(snapshot: LoadedSnapshot, timekeeperUserId: string, workDate: string): NodeSqlStatement {
  return snapshot.database
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN billable = 1 THEN duration_minutes ELSE 0 END), 0) AS billable_minutes,
         COALESCE(SUM(CASE WHEN billable = 0 THEN duration_minutes ELSE 0 END), 0) AS non_billable_minutes,
         COUNT(*) AS entry_count
       FROM time_entry
       WHERE timekeeper_user_id = ?1 AND work_date = ?2 AND status != 'void'`,
    )
    .bind(timekeeperUserId, workDate) as unknown as NodeSqlStatement;
}

export function timekeepingHotPathPlans(snapshot: LoadedSnapshot): LabeledPlan[] {
  const { timeProbes } = snapshot.manifest;
  const statements: readonly { label: string; statement: NodeSqlStatement }[] = [
    {
      label: "my-day.daily-totals",
      statement: myDayStatement(
        snapshot,
        timeProbes.busiestTimekeeperUserId,
        timeProbes.probeWorkDate,
      ),
    },
    {
      label: "weekly-grid.by-timekeeper",
      statement: capturedStatement(
        listWeeklyGridStatement(snapshot.database, {
          timekeeperUserId: timeProbes.busiestTimekeeperUserId,
          fromDate: timeProbes.probeWorkDate,
          toDate: timeProbes.probeWorkDate,
        }),
      ),
    },
    {
      label: "unbilled-wip.by-matter",
      statement: capturedStatement(
        listUnbilledByMatterStatement(snapshot.database, timeProbes.busiestMatterId),
      ),
    },
  ];
  return statements.map(({ label, statement }) => ({
    label,
    details: explainStatement(snapshot.raw, statement.sql, statement.bindings),
  }));
}
