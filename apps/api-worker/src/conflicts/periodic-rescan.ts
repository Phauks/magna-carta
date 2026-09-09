import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { recordRecheckRequests } from "@magna-carta/conflicts/recheck-request";
import {
  periodicRescanIsDue,
  readConflictsRecheckSettings,
  readConflictsRescanState,
  writeConflictsRescanStateStatement,
} from "@magna-carta/conflicts/recheck-settings";
import type { Logger } from "@magna-carta/telemetry/logger";
import type { ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";

// THE PERIODIC RE-SCAN — the backstop for every trigger, including the ones nobody thought of.
//
// It exists because the event triggers are a list, and a list is a thing that can be incomplete: a
// producer that was never wired, a matter that predates a trigger, a bug in a resolver. Each of those
// is invisible from inside the event path, and all of them are visible from a clock that re-screens
// open matters whether or not anything announced itself.
//
// It enqueues ledger rows in BATCHES rather than walking a whole caseload in one pass. A backstop that
// puts a firm's entire open list on the queue at once is a backstop that gets switched off.

// The cause topic a scheduled re-scan records. It is not an outbox topic — nothing produces it and
// nothing subscribes to it — it is the ledger's own name for "the clock asked".
export const CONFLICTS_PERIODIC_RESCAN_CAUSE = "conflicts.periodic_rescan";

// The matters this pass takes, oldest-checked first, so a caseload is walked rather than a favoured
// slice of it re-screened forever. A matter that has never been checked sorts first: it is the one
// with the least behind it.
async function selectRescanMatters(database: ProxyBatchDatabase, limit: number): Promise<string[]> {
  const { results } = await database
    .prepare(
      `SELECT matter.id AS id
         FROM matter
         LEFT JOIN conflicts_check ON conflicts_check.subject_matter_id = matter.id
        WHERE matter.status IN ('intake', 'consultation', 'open', 'hold') AND matter.system_key IS NULL
        GROUP BY matter.id
        ORDER BY COALESCE(MAX(conflicts_check.created_at), '') ASC, matter.id ASC
        LIMIT ?1`,
    )
    .bind(limit)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

// The cadence bucket the request is keyed on: the calendar day the pass ran. Combined with the
// ledger's partial unique index this makes a pass that fires twice in one day a no-op for a matter it
// already enqueued, while next period's pass is a genuinely new request.
function rescanCauseReference(now: string): string {
  return civilDateOf(now);
}

export interface PeriodicRescanOutcome {
  readonly ran: boolean;
  readonly mattersEnqueued: number;
}

export async function runPeriodicRescan(
  firmDatabase: ProxyBatchDatabase,
  logger: Logger,
): Promise<PeriodicRescanOutcome> {
  const settings = await readConflictsRecheckSettings(firmDatabase);
  const state = await readConflictsRescanState(firmDatabase);
  const now = new Date().toISOString();
  if (!periodicRescanIsDue(settings, state, now)) return { ran: false, mattersEnqueued: 0 };

  const matterIds = await selectRescanMatters(firmDatabase, settings.periodicRescanBatchSize);
  if (matterIds.length > 0) {
    await recordRecheckRequests(
      firmDatabase,
      {
        causeTopic: CONFLICTS_PERIODIC_RESCAN_CAUSE,
        causeReference: rescanCauseReference(now),
        causeOccurredAt: now,
        matterIds,
        maxMattersPerEvent: settings.maxMattersPerEvent,
      },
      { now: () => now },
    );
  }

  // The marker moves even when the pass found nothing to enqueue: the cadence is about how often the
  // firm's caseload is swept, not about how often a sweep happened to find work.
  await commitEffectBatch(
    firmDatabase,
    {
      statements: [writeConflictsRescanStateStatement(firmDatabase, { lastRunAt: now }, now)],
      outboxMessages: [],
    },
    { now: () => now },
  );

  if (matterIds.length > 0) logger.count("conflicts.recheck.rescan_enqueued", {}, matterIds.length);
  return { ran: true, mattersEnqueued: matterIds.length };
}
