import { purgeExpiredIdempotencyRecordsStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  sweepOutbox,
  type OutboxRow,
  type OutboxSweepReport,
} from "@magna-carta/data-access/outbox-relay";
import type { Bindings } from "./app.ts";
import { resolveFirmDatabase } from "./firm-binding-resolver.ts";
import { consumeMemberProvision } from "./member-provision-consumer.ts";

// Idempotency records are ephemeral dedup state with a ~24h TTL (ADR-0063); the purge cutoff is
// everything older than this.
const IDEMPOTENCY_RECORD_TTL_MILLISECONDS = 24 * 60 * 60 * 1000;

// Control-plane outbox topics are consumed DIRECTLY in the sweep — no Queue hop (slice 0·4
// decided #11): the consumers are local to this worker and idempotent, so a Queue round trip
// would only add latency and a second at-least-once layer. An unregistered topic throws, which
// the relay turns into attempts → dead-letter — a producer/consumer drift fails loud.
const CONTROL_PLANE_CONSUMERS: Readonly<
  Record<string, (env: Bindings, row: OutboxRow) => Promise<void>>
> = {
  "member.provision": consumeMemberProvision,
};

// A control-plane user whose firm database carries no member row — the reconciliation backstop's
// finding (slice 0·4 design spec §6).
export interface UnprovisionedMember {
  readonly userId: string;
  readonly firmId: string;
}

export interface ScheduledSweepReport {
  readonly controlPlane: OutboxSweepReport;
  readonly firmSweeps: number; // active firms whose outbox was swept (reachable from this deployment)
  readonly unprovisionedMembers: readonly UnprovisionedMember[];
}

// Dead-letter surfacing until the slice 0·6 telemetry pipeline lands: ids + topic + attempts +
// our own error message only — payloads are never logged (ADR-0038 redaction).
function logDeadLetter(scope: string): (row: OutboxRow, error: Error) => Promise<void> {
  return (row, error) => {
    console.error(
      `outbox dead-letter (${scope}): id=${row.id} topic=${row.topic} attempts=${row.attempts + 1} error=${error.message}`,
    );
    return Promise.resolve();
  };
}

// The reconciliation backstop (slice 0·4 design spec §6): control-plane users with no member row
// in their firm's per-firm database. Detection only — the outbox relay is the repair mechanism
// (a missing mirror means a pending/dead-lettered member.provision row to chase, never a write
// from here). Firms whose database this deployment cannot reach are skipped, same as the sweep.
export async function findUnprovisionedMembers(env: Bindings): Promise<UnprovisionedMember[]> {
  const firms = await env.DB_CONTROL.prepare(
    "SELECT id, database_identifier FROM firm WHERE status = 'active'",
  ).all<{ id: string; database_identifier: string | null }>();

  const unprovisioned: UnprovisionedMember[] = [];
  for (const firm of firms.results) {
    const firmDatabase =
      firm.database_identifier === null ? null : resolveFirmDatabase(env, firm.database_identifier);
    if (firmDatabase === null) continue;

    const users = await env.DB_CONTROL.prepare('SELECT id FROM "user" WHERE firm_id = ?1')
      .bind(firm.id)
      .all<{ id: string }>();
    if (users.results.length === 0) continue;

    const members = await firmDatabase.prepare("SELECT user_id FROM member").all<{
      user_id: string;
    }>();
    const memberUserIds = new Set(members.results.map((row) => row.user_id));
    for (const user of users.results) {
      if (!memberUserIds.has(user.id)) {
        unprovisioned.push({ userId: user.id, firmId: firm.id });
      }
    }
  }
  return unprovisioned;
}

// The Cron entry point (closes the slice 0·2 deferral): one pass =
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
  const controlPlane = await sweepOutbox({
    database: env.DB_CONTROL,
    publish: async (row) => {
      const consume = CONTROL_PLANE_CONSUMERS[row.topic];
      if (consume === undefined) {
        throw new Error(`no consumer registered for control-plane outbox topic "${row.topic}"`);
      }
      await consume(env, row);
    },
    deadLetter: logDeadLetter("control-plane"),
  });

  const firms = await env.DB_CONTROL.prepare(
    "SELECT id, database_identifier FROM firm WHERE status = 'active'",
  ).all<{ id: string; database_identifier: string | null }>();
  const idempotencyCutoff = new Date(
    Date.now() - IDEMPOTENCY_RECORD_TTL_MILLISECONDS,
  ).toISOString();

  let firmSweeps = 0;
  for (const firm of firms.results) {
    const firmDatabase =
      firm.database_identifier === null ? null : resolveFirmDatabase(env, firm.database_identifier);
    if (firmDatabase === null) continue; // not reachable from this deployment — next pass retries
    try {
      await sweepOutbox({
        database: firmDatabase,
        publish: async (row) => {
          // The Queue message mirrors the outbox row (consumers dedup on id, order by
          // (aggregateKey, seq) — ADR-0064); the payload is already redacted canonical JSON.
          await env.QUEUE.send({
            id: row.id,
            topic: row.topic,
            payload: row.payload,
            aggregateKey: row.aggregate_key,
            seq: row.seq,
          });
        },
        deadLetter: logDeadLetter(`firm ${firm.id}`),
      });
      await purgeExpiredIdempotencyRecordsStatement(firmDatabase, idempotencyCutoff).run();
      firmSweeps++;
    } catch (caught) {
      // One firm's broken database must not starve the rest of the fleet; the failure is logged
      // (ids only) and the next Cron fire retries.
      const message = caught instanceof Error ? caught.message : String(caught);
      console.error(`per-firm sweep failed: firm=${firm.id} error=${message}`);
    }
  }

  await purgeExpiredIdempotencyRecordsStatement(env.DB_CONTROL, idempotencyCutoff).run();

  const unprovisionedMembers = await findUnprovisionedMembers(env);
  if (unprovisionedMembers.length > 0) {
    console.error(
      `reconciliation backstop: ${unprovisionedMembers.length} user(s) without a member row — ` +
        unprovisionedMembers.map((entry) => `${entry.userId}@${entry.firmId}`).join(", "),
    );
  }

  return { controlPlane, firmSweeps, unprovisionedMembers };
}
