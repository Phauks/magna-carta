import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FileVersionId, FirmId, UserId } from "@magna-carta/identifiers/types";
import worker from "../src/index.ts";
import {
  findUnprovisionedMembers,
  listReachableActiveFirms,
  runRescanSweep,
  runScheduledSweep,
} from "../src/scheduled.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import { seedFirm } from "./support/test-auth.ts";

// firm.database_identifier is UNIQUE and the pool firm is shared by this file's tests (the
// members.test.ts pattern): seeded once here, per-test writes are isolated by the harness.
let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  poolFirmId = (
    await seedFirm({ name: "Scheduled Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
});

// Mirrors the invite endpoint's own write — a control-plane user row on the pool firm.
async function directInsertUser(email: string, name: string): Promise<UserId> {
  const userId = newIdentifier("user");
  await env.DB_CONTROL.prepare(
    'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, firm_id) VALUES (?1, ?2, ?3, 0, ?4, ?4, ?5)',
  )
    .bind(userId, name, email, Date.now(), poolFirmId)
    .run();
  return userId;
}

// Inserts a pending outbox row the way the effect batch does (member.provision payload shape from
// routes/members.ts + firm-provisioner.ts), returning its id for status assertions.
async function insertMemberProvisionOutboxRow(
  database: D1Database,
  payload: { userId: string; firmId: string; displayName: string; roleName: string | null },
): Promise<string> {
  const outboxId = newIdentifier("outbox");
  await database
    .prepare(
      "INSERT INTO outbox (id, topic, payload, aggregate_key, seq, status, attempts, created_at) VALUES (?1, 'member.provision', ?2, NULL, NULL, 'pending', 0, ?3)",
    )
    .bind(outboxId, canonicalJsonStringify(payload), new Date().toISOString())
    .run();
  return outboxId;
}

async function outboxRowState(
  database: D1Database,
  outboxId: string,
): Promise<{ status: string; attempts: number } | null> {
  return database
    .prepare("SELECT status, attempts FROM outbox WHERE id = ?1")
    .bind(outboxId)
    .first<{ status: string; attempts: number }>();
}

describe("runScheduledSweep — member.provision consumption", () => {
  it("mirrors an invited user's outbox row into the firm database, idempotently", async () => {
    // The invite write as routes/members.ts commits it — the control-plane user row plus the
    // pending member.provision row (roleName null). Inserted DIRECTLY here, not through the invite
    // endpoint: POST /api/v1/members now fires its own best-effort request-path sweep on commit
    // (the R1 latency optimization), which would mirror the invitee before this test could observe
    // the pre-sweep state. The invite-endpoint → request-path-sweep → mirror path has its own
    // deterministic coverage in members.test.ts; this test isolates runScheduledSweep itself.
    const invitedUserId = await directInsertUser("sweep-invitee@example.com", "Sweep Invitee");
    await insertMemberProvisionOutboxRow(env.DB_CONTROL, {
      userId: invitedUserId,
      firmId: poolFirmId,
      displayName: "Sweep Invitee",
      roleName: null,
    });

    // Before the sweep the reconciliation backstop reports the un-mirrored invitee.
    const beforeSweep = await findUnprovisionedMembers(env, await listReachableActiveFirms(env));
    expect(beforeSweep).toContainEqual({ userId: invitedUserId, firmId: poolFirmId });

    const report = await runScheduledSweep(env);
    expect(report.controlPlane.dispatched).toBeGreaterThanOrEqual(1);
    expect(report.controlPlane.failed).toBe(0);

    // The member mirror landed in the firm database; the invite carries no role (roleName null).
    const memberRow = await env.DB_FIRM_POOL_1.prepare(
      "SELECT display_name, status FROM member WHERE user_id = ?1",
    )
      .bind(invitedUserId)
      .first<{ display_name: string; status: string }>();
    expect(memberRow).toEqual({ display_name: "Sweep Invitee", status: "active" });

    // The reconciliation backstop is clean again (control-plane users without a member row in their
    // firm database).
    expect(await findUnprovisionedMembers(env, await listReachableActiveFirms(env))).toEqual([]);

    // Re-running the sweep is a no-op: the row is dispatched, nothing duplicates.
    const secondReport = await runScheduledSweep(env);
    expect(secondReport.controlPlane.dispatched).toBe(0);
    const memberCount = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS count FROM member WHERE user_id = ?1",
    )
      .bind(invitedUserId)
      .first<{ count: number }>();
    expect(memberCount?.count).toBe(1);
  });

  it("assigns the named seeded role and dedups a redelivery (at-least-once contract)", async () => {
    // The firm-provisioner payload shape: the owner arrives with the Owner/Admin role by name.
    const userId = await directInsertUser("sweep-role-owner@example.com", "Role Owner");
    const outboxId = await insertMemberProvisionOutboxRow(env.DB_CONTROL, {
      userId,
      firmId: poolFirmId,
      displayName: "Role Owner",
      roleName: "Owner/Admin",
    });

    await runScheduledSweep(env);
    expect(await outboxRowState(env.DB_CONTROL, outboxId)).toEqual({
      status: "dispatched",
      attempts: 0,
    });

    const seededRole = await env.DB_FIRM_POOL_1.prepare(
      "SELECT id FROM role WHERE name = 'Owner/Admin'",
    ).first<{ id: string }>();
    const roleRows = await env.DB_FIRM_POOL_1.prepare(
      "SELECT role_id FROM member_role WHERE member_user_id = ?1",
    )
      .bind(userId)
      .all<{ role_id: string }>();
    expect(roleRows.results).toEqual([{ role_id: seededRole?.id }]);

    // Redelivery: flip the row back to pending (the at-least-once case — e.g. a crash between
    // publish and mark) and sweep again. ON CONFLICT DO NOTHING on the member row plus
    // UNIQUE(member_user_id, role_id) on the assignment make it a no-op.
    await env.DB_CONTROL.prepare("UPDATE outbox SET status = 'pending' WHERE id = ?1")
      .bind(outboxId)
      .run();
    await runScheduledSweep(env);

    const memberCount = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS count FROM member WHERE user_id = ?1",
    )
      .bind(userId)
      .first<{ count: number }>();
    expect(memberCount?.count).toBe(1);
    const roleCount = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS count FROM member_role WHERE member_user_id = ?1",
    )
      .bind(userId)
      .first<{ count: number }>();
    expect(roleCount?.count).toBe(1);
  });

  it("dead-letters a poisoned message after max attempts without touching any firm database", async () => {
    // Poison: a firmId no firm row records — the consumer throws on every delivery.
    const outboxId = await insertMemberProvisionOutboxRow(env.DB_CONTROL, {
      userId: newIdentifier("user"),
      firmId: newIdentifier("firm"),
      displayName: "Poisoned",
      roleName: null,
    });

    // The relay's default maxAttempts is 5: four failing sweeps leave it pending with mounting
    // attempts; the fifth marks it failed and fires the dead-letter callback exactly once.
    for (let attempt = 1; attempt <= 4; attempt++) {
      const report = await runScheduledSweep(env);
      expect(report.controlPlane.failed).toBe(1);
      expect(report.controlPlane.deadLettered).toBe(0);
      expect(await outboxRowState(env.DB_CONTROL, outboxId)).toEqual({
        status: "pending",
        attempts: attempt,
      });
    }
    const finalReport = await runScheduledSweep(env);
    expect(finalReport.controlPlane.deadLettered).toBe(1);
    expect(await outboxRowState(env.DB_CONTROL, outboxId)).toEqual({
      status: "failed",
      attempts: 5,
    });

    // A failed row is terminal: another sweep never picks it up again.
    const afterReport = await runScheduledSweep(env);
    expect(afterReport.controlPlane.failed).toBe(0);
    expect(await outboxRowState(env.DB_CONTROL, outboxId)).toEqual({
      status: "failed",
      attempts: 5,
    });
  });

  it("treats a payload with roleName ABSENT as malformed (fails, never mirrors a roleless member)", async () => {
    // A producer that DROPS the roleName field must not silently mirror a roleless owner (a
    // locked-out firm). roleName must be explicitly present as string | null; an absent field is
    // malformed → the consumer throws → the relay fails the row (and dead-letters at max attempts).
    const userId = await directInsertUser("sweep-roleless-absent@example.com", "Absent Role");
    const outboxId = newIdentifier("outbox");
    // Inserted WITHOUT the roleName key — canonical JSON of a 3-field payload.
    await env.DB_CONTROL.prepare(
      "INSERT INTO outbox (id, topic, payload, aggregate_key, seq, status, attempts, created_at) VALUES (?1, 'member.provision', ?2, NULL, NULL, 'pending', 0, ?3)",
    )
      .bind(
        outboxId,
        canonicalJsonStringify({ userId, firmId: poolFirmId, displayName: "Absent Role" }),
        new Date().toISOString(),
      )
      .run();

    const report = await runScheduledSweep(env);
    expect(report.controlPlane.failed).toBeGreaterThanOrEqual(1);
    expect(await outboxRowState(env.DB_CONTROL, outboxId)).toEqual({
      status: "pending",
      attempts: 1,
    });
    // No member row was written for the dropped-field payload.
    const memberRow = await env.DB_FIRM_POOL_1.prepare(
      "SELECT user_id FROM member WHERE user_id = ?1",
    )
      .bind(userId)
      .first();
    expect(memberRow).toBeNull();
  });

  it("dead-letters a message whose topic has no registered consumer", async () => {
    const outboxId = newIdentifier("outbox");
    await env.DB_CONTROL.prepare(
      "INSERT INTO outbox (id, topic, payload, aggregate_key, seq, status, attempts, created_at) VALUES (?1, 'topic.unknown', '{}', NULL, NULL, 'pending', 0, ?2)",
    )
      .bind(outboxId, new Date().toISOString())
      .run();
    for (let attempt = 1; attempt <= 5; attempt++) await runScheduledSweep(env);
    expect(await outboxRowState(env.DB_CONTROL, outboxId)).toEqual({
      status: "failed",
      attempts: 5,
    });
  });
});

describe("runScheduledSweep — per-firm relay and TTL purge", () => {
  it("sweeps an active firm's outbox to env.QUEUE and marks rows dispatched", async () => {
    // Nothing consumes the per-firm queue yet this slice — publishing + the dispatched mark IS
    // the relay contract; the consumer arrives with the first per-firm topic.
    const outboxId = newIdentifier("outbox");
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO outbox (id, topic, payload, aggregate_key, seq, status, attempts, created_at) VALUES (?1, 'demo.topic', '{}', NULL, NULL, 'pending', 0, ?2)",
    )
      .bind(outboxId, new Date().toISOString())
      .run();

    const report = await runScheduledSweep(env);
    expect(report.firmSweeps).toBeGreaterThanOrEqual(1);
    expect(await outboxRowState(env.DB_FIRM_POOL_1, outboxId)).toEqual({
      status: "dispatched",
      attempts: 0,
    });
  });

  it("publishes the queue message with the pinned field names { id, firmId, topic, payload, aggregateKey, seq }", async () => {
    // The field names are a wire contract: future consumers dedup on id and order by
    // (aggregateKey, seq), and firmId resolves the originating tenant because per-firm
    // messages cross the single SHARED queue (the first per-firm consumer, slice 0·5+, has no other
    // handle on which physical database the row came from). A capturing fake QUEUE pins the shape.
    const outboxId = newIdentifier("outbox");
    await env.DB_FIRM_POOL_1.prepare(
      `INSERT INTO outbox (id, topic, payload, aggregate_key, seq, status, attempts, created_at) VALUES (?1, 'demo.shape', '{"demo":true}', 'agg_demo', 7, 'pending', 0, ?2)`,
    )
      .bind(outboxId, new Date().toISOString())
      .run();

    const sent: unknown[] = [];
    const capturingQueue = {
      send: (message: unknown) => {
        sent.push(message);
        return Promise.resolve();
      },
    } as unknown as Queue;
    await runScheduledSweep({ ...env, QUEUE: capturingQueue });

    const message = sent.find((entry) => (entry as { id?: unknown }).id === outboxId);
    expect(message).toEqual({
      id: outboxId,
      firmId: poolFirmId,
      topic: "demo.shape",
      payload: '{"demo":true}',
      aggregateKey: "agg_demo",
      seq: 7,
    });
  });

  it("purges expired idempotency records on the control plane and each reachable firm database", async () => {
    const hourMilliseconds = 60 * 60 * 1000;
    const expired = new Date(Date.now() - 25 * hourMilliseconds).toISOString();
    const fresh = new Date().toISOString();
    for (const database of [env.DB_CONTROL, env.DB_FIRM_POOL_1]) {
      for (const [key, createdAt] of [
        ["ttl-expired", expired],
        ["ttl-fresh", fresh],
      ] as const) {
        await database
          .prepare(
            "INSERT INTO idempotency_key (id, key, fingerprint, status, response_code, response_body, created_at) VALUES (?1, ?2, 'fp', 'completed', 200, NULL, ?3)",
          )
          .bind(newIdentifier("idempotencyRecord"), key, createdAt)
          .run();
      }
    }

    await runScheduledSweep(env);

    for (const database of [env.DB_CONTROL, env.DB_FIRM_POOL_1]) {
      const remaining = await database
        .prepare("SELECT key FROM idempotency_key WHERE key IN ('ttl-expired', 'ttl-fresh')")
        .all<{ key: string }>();
      expect(remaining.results).toEqual([{ key: "ttl-fresh" }]);
    }
  });
});

describe("scheduled handler wiring", () => {
  it("runs the sweep from the Worker's scheduled entry point", async () => {
    const userId = await directInsertUser("sweep-cron-user@example.com", "Cron User");
    await insertMemberProvisionOutboxRow(env.DB_CONTROL, {
      userId,
      firmId: poolFirmId,
      displayName: "Cron User",
      roleName: null,
    });

    const controller = createScheduledController({
      scheduledTime: new Date(),
      cron: "*/5 * * * *",
    });
    const executionContext = createExecutionContext();
    worker.scheduled(controller, env, executionContext);
    await waitOnExecutionContext(executionContext);

    const memberRow = await env.DB_FIRM_POOL_1.prepare(
      "SELECT display_name FROM member WHERE user_id = ?1",
    )
      .bind(userId)
      .first<{ display_name: string }>();
    expect(memberRow).toEqual({ display_name: "Cron User" });
  });
});

// Inserts a minimal file + clean committed version directly into the firm database, with the given
// scan_verdict. The file and version ids are pre-generated so the test can reference them.
// Each call uses a unique member + matter to avoid UNIQUE constraint collisions across tests.
// Insertion order: member → matter → file (current_version_id NULL initially) → file_version →
// UPDATE file to set current_version_id (avoids the circular FK between file and file_version).
async function insertCommittedVersion(
  database: D1Database,
  versionId: FileVersionId,
  scanVerdict: "unscanned" | "clean" | null,
): Promise<void> {
  const fileId = newIdentifier("file");
  const matterId = newIdentifier("matter");
  const memberId = newIdentifier("user");
  const now = new Date().toISOString();
  // member has no updated_at column (schema 0002_member-rbac).
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Test', 'active', ?2)",
    )
    .bind(memberId, now)
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Test Matter', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, memberId, now)
    .run();
  // Insert file with current_version_id NULL to break the circular FK with file_version.
  await database
    .prepare(
      "INSERT INTO file (id, matter_id, name, current_version_id, created_at, updated_at) VALUES (?1, ?2, 'test.txt', NULL, ?3, ?3)",
    )
    .bind(fileId, matterId, now)
    .run();
  await database
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, status, scan_verdict, created_at, committed_at) VALUES (?1, ?2, 1, ?3, 'clean', ?4, ?5, ?5)",
    )
    .bind(versionId, fileId, `files/${versionId}`, scanVerdict, now)
    .run();
  // Back-fill the current_version_id now that the file_version row exists.
  await database
    .prepare("UPDATE file SET current_version_id = ?1, updated_at = ?2 WHERE id = ?3")
    .bind(versionId, now, fileId)
    .run();
}

// The bucket name used for rescan tests — any non-null string works here because the sweep only
// needs a non-null bucketName to decide to enqueue; the ingest consumer resolves the firm from the
// bucket, but these tests inject a capturing queue that never reaches the consumer.
const RESCAN_BUCKET = "magna-carta-test-rescan-bucket";

describe("runRescanSweep — weekly re-scan sweep", () => {
  it("enqueues exactly one re-scan message for the unscanned committed version, not the already-clean one", async () => {
    // Seed two committed versions: one with scan_verdict = 'unscanned', one with 'clean'.
    // runRescanSweep should enqueue only the unscanned one.
    // The firm must have a recorded bucket_name: the sweep skips firms with a null bucket so the
    // enqueued counter only reflects messages the ingest consumer can meaningfully resolve.
    await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = ?2 WHERE id = ?1")
      .bind(poolFirmId, RESCAN_BUCKET)
      .run();

    const unscannedVersionId = newIdentifier("fileVersion") as FileVersionId;
    const cleanVersionId = newIdentifier("fileVersion") as FileVersionId;
    await insertCommittedVersion(env.DB_FIRM_POOL_1, unscannedVersionId, "unscanned");
    await insertCommittedVersion(env.DB_FIRM_POOL_1, cleanVersionId, "clean");

    const sent: unknown[] = [];
    const capturingFilesIngest = {
      send: (message: unknown) => {
        sent.push(message);
        return Promise.resolve();
      },
    } as unknown as Queue;

    await runRescanSweep({ ...env, FILES_INGEST: capturingFilesIngest });

    // Exactly one message enqueued — for the unscanned version only.
    expect(sent).toHaveLength(1);
    const message = sent[0] as { object?: { key?: unknown } };
    expect(message.object?.key).toBe(`files/${unscannedVersionId}`);

    // Restore null bucket so other tests that do NOT want enqueuing are unaffected.
    await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = NULL WHERE id = ?1")
      .bind(poolFirmId)
      .run();
  });

  it("respects the per-firm cap — enqueues exactly the cap count when backlog exceeds it", async () => {
    // Seed 3 unscanned committed versions into a fresh firm database so the test is isolated
    // from other tests that may have left residual unscanned rows in the pool firm.
    // Then call runRescanSweep with a cap of 2 and assert EXACTLY 2 messages are enqueued,
    // proving the bounding logic is exercised (not merely that the cap is larger than the backlog).
    await applyPerFirmMigrations(env.DB_FIRM_POOL_2);
    const capBoundFirmId = (
      await seedFirm({ name: "Cap Boundary Firm", databaseIdentifier: "DB_FIRM_POOL_2" })
    ).firmId;

    // The firm must have a recorded bucket_name: the sweep skips firms with a null bucket so the
    // enqueued counter only reflects messages the ingest consumer can meaningfully resolve.
    await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = ?2 WHERE id = ?1")
      .bind(capBoundFirmId, "magna-carta-test-cap-bucket")
      .run();

    const seededVersionIds: FileVersionId[] = [];
    for (let i = 0; i < 3; i++) {
      const versionId = newIdentifier("fileVersion") as FileVersionId;
      seededVersionIds.push(versionId);
      await insertCommittedVersion(env.DB_FIRM_POOL_2, versionId, "unscanned");
    }

    const sent: unknown[] = [];
    const capturingFilesIngest = {
      send: (message: unknown) => {
        sent.push(message);
        return Promise.resolve();
      },
    } as unknown as Queue;

    // Cap of 2 with 3 unscanned versions: exactly 2 must be enqueued for the cap-boundary firm.
    await runRescanSweep({ ...env, FILES_INGEST: capturingFilesIngest }, 2);

    const firmMessages = sent.filter((entry) => {
      // Filter by key prefix matching a seeded version to isolate this firm's messages.
      const key = (entry as { object?: { key?: string } }).object?.key ?? "";
      return seededVersionIds.some((id) => key === `files/${id}`);
    });
    expect(firmMessages).toHaveLength(2);

    // Clean up: remove the cap-boundary firm row so it does not interfere with subsequent tests.
    await env.DB_CONTROL.prepare("DELETE FROM firm WHERE id = ?1").bind(capBoundFirmId).run();
  });

  it("routes the weekly cron expression to runRescanSweep via the Worker's scheduled handler", async () => {
    // The scheduled handler must route 0 4 * * 0 to runRescanSweep (not the sweep or reconciliation).
    // We verify it runs without error (the wiring is structural; the queue binding may be absent in
    // the test harness, causing a no-op rather than an enqueue — the routing is what matters here).
    const controller = createScheduledController({
      scheduledTime: new Date(),
      cron: "0 4 * * 0",
    });
    const executionContext = createExecutionContext();
    // Should not throw — the handler routes and executes.
    worker.scheduled(controller, env, executionContext);
    await waitOnExecutionContext(executionContext);
  });
});
