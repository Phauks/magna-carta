import {
  createExecutionContext,
  createScheduledController,
  env,
  SELF,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import worker from "../src/index.ts";
import {
  findUnprovisionedMembers,
  listReachableActiveFirms,
  runScheduledSweep,
} from "../src/scheduled.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

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
  it("mirrors the invited user into the firm database after the Task 11 invite flow, idempotently", async () => {
    // The full invite path: owner with firm:manageMembers invites through POST /api/v1/members.
    const { userId: ownerUserId } = await seedCredentialedUser("sweep-invite-owner@example.com", {
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(ownerUserId, "Sweep Owner");
    const sessionCookie = await signInForSessionCookie("sweep-invite-owner@example.com");
    const inviteResponse = await SELF.fetch("https://example.com/api/v1/members", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        cookie: sessionCookie,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ email: "sweep-invitee@example.com", name: "Sweep Invitee" }),
    });
    expect(inviteResponse.status).toBe(201);
    const invitedUserId = ((await inviteResponse.json()) as { id: string }).id;

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

    // The reconciliation backstop is clean again (spec §6: control-plane users without a member
    // row in their firm database).
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

  it("publishes the queue message with the pinned field names { id, topic, payload, aggregateKey, seq }", async () => {
    // The field names are a wire contract: future consumers dedup on id and order by
    // (aggregateKey, seq) (ADR-0064). A capturing fake QUEUE pins the publish closure's shape.
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
