import { purgeExpiredIdempotencyRecordsStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  sweepOutbox,
  type OutboxRow,
  type OutboxSweepReport,
} from "@magna-carta/data-access/outbox-relay";
import { outboxDeadLettered, outboxSwept } from "@magna-carta/telemetry/events";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import type { Logger } from "@magna-carta/telemetry/logger";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "./app.ts";
import { resolveFirmDatabase } from "./firm-binding-resolver.ts";
import { consumeMemberProvision } from "./member-provision-consumer.ts";

// All background logging in this file goes through the slice 0·6 telemetry pipeline (golden rule 4 —
// the one logging path, the console ban makes it structural): a cron pass builds one Workers logger
// + correlation id and emits allowlist events, never console.*.

// Idempotency records are ephemeral dedup state with a ~24h TTL; the purge cutoff is
// everything older than this.
const IDEMPOTENCY_RECORD_TTL_MILLISECONDS = 24 * 60 * 60 * 1000;

// Control-plane outbox topics are consumed DIRECTLY in the sweep — no Queue hop:
// the consumers are local to this worker and idempotent, so a Queue round trip
// would only add latency and a second at-least-once layer. An unregistered topic throws, which
// the relay turns into attempts → dead-letter — a producer/consumer drift fails loud.
const CONTROL_PLANE_CONSUMERS: Readonly<
  Record<string, (env: Bindings, row: OutboxRow) => Promise<void>>
> = {
  "member.provision": consumeMemberProvision,
};

// A control-plane user whose firm database carries no member row — the reconciliation backstop's
// finding.
export interface UnprovisionedMember {
  readonly userId: string;
  readonly firmId: string;
}

export interface ScheduledSweepReport {
  readonly controlPlane: OutboxSweepReport;
  // Reachable active firms whose outbox sweep AND idempotency TTL purge BOTH succeeded this pass.
  readonly firmSweeps: number;
  readonly unprovisionedMembers: readonly UnprovisionedMember[];
}

// Dead-letter surfacing: ids + topic + attempts only — payloads are never logged (redaction; the
// allowlist event has no payload slot). The outboxId is opaque and the diagnostics agent
// investigates the parked row by it.
function logDeadLetter(
  logger: Logger,
  correlationId: string,
  scope: string,
): (row: OutboxRow) => Promise<void> {
  return (row) => {
    logger.log(
      outboxDeadLettered(
        { correlationId, now: new Date().toISOString() },
        { scope, outboxId: row.id, topic: row.topic, attempts: row.attempts + 1 },
      ),
    );
    return Promise.resolve();
  };
}

// An active firm this deployment can reach: the control-plane row joined to its resolved binding.
export interface ReachableActiveFirm {
  readonly firmId: string;
  readonly database: D1Database;
}

// The ONE active-firm enumeration per cron pass — the per-firm sweep and the reconciliation
// backstop both consume the same list. Firms with no recorded database, or whose database this
// deployment cannot reach, are skipped; the next pass retries them.
export async function listReachableActiveFirms(env: Bindings): Promise<ReachableActiveFirm[]> {
  const firms = await env.DB_CONTROL.prepare(
    "SELECT id, database_identifier FROM firm WHERE status = 'active'",
  ).all<{ id: string; database_identifier: string | null }>();

  const reachable: ReachableActiveFirm[] = [];
  for (const firm of firms.results) {
    const database =
      firm.database_identifier === null ? null : resolveFirmDatabase(env, firm.database_identifier);
    if (database === null) continue;
    reachable.push({ firmId: firm.id, database });
  }
  return reachable;
}

// The reconciliation backstop: control-plane users with no member row
// in their firm's per-firm database. Detection only — repair runs through the relay: a PENDING
// member.provision row is dispatched by the next sweep, and a DEAD-LETTERED one is revived by
// requeueDeadLetteredMessageStatement (the documented operator seam — see sweepOutbox); the
// backstop never writes a member row from here. Takes the pass's listReachableActiveFirms result,
// so unreachable firms are skipped the same way the sweep skips them.
//
// The control-plane users are read in ONE grouped query (not per firm — that was an N+1 across the
// fleet), bucketed by firm_id in JS; the per-firm member reads stay per firm (irreducible — the
// firm databases are separate physical D1 instances).
export async function findUnprovisionedMembers(
  env: Bindings,
  firms: readonly ReachableActiveFirm[],
): Promise<UnprovisionedMember[]> {
  const allUsers = await env.DB_CONTROL.prepare('SELECT id, firm_id FROM "user"').all<{
    id: string;
    firm_id: string;
  }>();
  const userIdsByFirm = new Map<string, string[]>();
  for (const user of allUsers.results) {
    const bucket = userIdsByFirm.get(user.firm_id);
    if (bucket === undefined) {
      userIdsByFirm.set(user.firm_id, [user.id]);
    } else {
      bucket.push(user.id);
    }
  }

  const unprovisioned: UnprovisionedMember[] = [];
  for (const firm of firms) {
    const firmUserIds = userIdsByFirm.get(firm.firmId);
    if (firmUserIds === undefined || firmUserIds.length === 0) continue;

    const members = await firm.database.prepare("SELECT user_id FROM member").all<{
      user_id: string;
    }>();
    const memberUserIds = new Set(members.results.map((row) => row.user_id));
    for (const userId of firmUserIds) {
      if (!memberUserIds.has(userId)) {
        unprovisioned.push({ userId, firmId: firm.firmId });
      }
    }
  }
  return unprovisioned;
}

// The Cron entry point: one pass =
//   1. control-plane outbox sweep — the consumer map applies member mirrors directly;
//   2. per-firm outbox sweep over active firms — rows publish to env.QUEUE (nothing consumes the
//      per-firm queue yet this slice; publishing realizes the relay contract and the consumer
//      arrives with the first per-firm topic) — plus that firm's idempotency TTL purge;
//   3. control-plane idempotency TTL purge;
//   4. the reconciliation backstop — logged (ids only) when non-empty; the finding heals through
//      the relay (a fresh invite's row may appear for one pass mid-flight — the next pass clears it).
// Sweeps are at-least-once and every consumer dedups, so overlapping Cron fires are safe
// (sweepOutbox's status guards) — no run lock needed.
export async function runScheduledSweep(env: Bindings): Promise<ScheduledSweepReport> {
  // One logger + correlation id per cron pass: every event this pass emits shares the correlation id
  // (no request context here — the pass is the unit of work).
  const logger = createWorkersLogger(env.TELEMETRY);
  const correlationId = newCorrelationId();

  const controlPlane = await sweepOutbox({
    database: env.DB_CONTROL,
    publish: async (row) => {
      const consume = CONTROL_PLANE_CONSUMERS[row.topic];
      if (consume === undefined) {
        throw new Error(`no consumer registered for control-plane outbox topic "${row.topic}"`);
      }
      await consume(env, row);
    },
    deadLetter: logDeadLetter(logger, correlationId, "control-plane"),
  });
  // A successful sweep is observable, not just its failures (outbox.swept, one per sweep).
  logger.log(
    outboxSwept(
      { correlationId, now: new Date().toISOString() },
      {
        database: "control-plane",
        dispatched: controlPlane.dispatched,
        failed: controlPlane.failed,
        deadLettered: controlPlane.deadLettered,
      },
    ),
  );

  const firms = await listReachableActiveFirms(env);
  const idempotencyCutoff = new Date(
    Date.now() - IDEMPOTENCY_RECORD_TTL_MILLISECONDS,
  ).toISOString();

  let firmSweeps = 0;
  for (const firm of firms) {
    try {
      const firmReport = await sweepOutbox({
        database: firm.database,
        publish: async (row) => {
          // The Queue message mirrors the outbox row (consumers dedup on id, order by
          // (aggregateKey, seq)); the payload is already redacted canonical JSON.
          // firmId tags the originating tenant: per-firm messages cross the single SHARED env.QUEUE,
          // so the first per-firm consumer (slice 0·5+) resolves the firm from the message — it has
          // no other handle on which physical database the row came from. (Control-plane outbox
          // topics are consumed DIRECTLY in this worker, never over the queue, so they need no such
          // tag.)
          await env.QUEUE.send({
            id: row.id,
            firmId: firm.firmId,
            topic: row.topic,
            payload: row.payload,
            aggregateKey: row.aggregate_key,
            seq: row.seq,
          });
        },
        deadLetter: logDeadLetter(logger, correlationId, `firm ${firm.firmId}`),
      });
      await purgeExpiredIdempotencyRecordsStatement(firm.database, idempotencyCutoff).run();
      firmSweeps++;
      logger.log(
        outboxSwept(
          { correlationId, now: new Date().toISOString() },
          {
            database: firm.firmId,
            dispatched: firmReport.dispatched,
            failed: firmReport.failed,
            deadLettered: firmReport.deadLettered,
          },
        ),
      );
    } catch (caught) {
      // One firm's broken database must not starve the rest of the fleet; the failure is logged
      // through the one pipeline (firm handle in the operation label) and the next Cron fire retries.
      logOperationFailed(logger, `cron:per-firm-sweep:${firm.firmId}`, caught, correlationId);
    }
  }

  await purgeExpiredIdempotencyRecordsStatement(env.DB_CONTROL, idempotencyCutoff).run();

  const unprovisionedMembers = await findUnprovisionedMembers(env, firms);
  if (unprovisionedMembers.length > 0) {
    // The backstop finding is a self-healing operational signal (the relay clears it next pass), so
    // it rides a counter, not an event: the count is the alertable signal, and the per-user detail
    // (a usr_@firm_ list) stays out of the structured log. The report still carries the full list
    // for the caller.
    logger.count("reconciliation.unprovisioned", {}, unprovisionedMembers.length);
  }

  return { controlPlane, firmSweeps, unprovisionedMembers };
}
