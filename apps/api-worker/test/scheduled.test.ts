import {
  createExecutionContext,
  createScheduledController,
  env,
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
import { controlPlaneHeadSchemaVersion } from "../src/control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedFirm } from "./support/test-auth.ts";

// The pool firm is seeded once here and its per-firm data lives in the firm's FirmDatabase Durable
// Object (addressed by firmId, self-migrating on first access). Per-test writes are isolated by the
// harness; no D1 pool binding is needed for per-firm data.
let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Scheduled Test Firm" })).firmId;
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

// A minimal common interface satisfied by both D1Database and ProxyBatchDatabase: supports the
// prepare → bind → all read path used by this helper. Both D1PreparedStatement and ProxySqlStatement
// expose .all<T>() returning a { results: T[] } shape, so the structural overlap is safe.
type AnyReadableDatabase = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    };
  };
};

async function outboxRowState(
  database: AnyReadableDatabase,
  outboxId: string,
): Promise<{ status: string; attempts: number } | null> {
  const { results } = await database
    .prepare("SELECT status, attempts FROM outbox WHERE id = ?1")
    .bind(outboxId)
    .all<{ status: string; attempts: number }>();
  return results[0] ?? null;
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
    const { results: memberResults } = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT display_name, status FROM member WHERE user_id = ?1")
      .bind(invitedUserId)
      .all<{ display_name: string; status: string }>();
    expect(memberResults[0]).toEqual({ display_name: "Sweep Invitee", status: "active" });

    // The reconciliation backstop is clean again (control-plane users without a member row in their
    // firm database).
    expect(await findUnprovisionedMembers(env, await listReachableActiveFirms(env))).toEqual([]);

    // Re-running the sweep is a no-op: the row is dispatched, nothing duplicates.
    const secondReport = await runScheduledSweep(env);
    expect(secondReport.controlPlane.dispatched).toBe(0);
    const { results: countResults } = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT COUNT(*) AS count FROM member WHERE user_id = ?1")
      .bind(invitedUserId)
      .all<{ count: number }>();
    expect(countResults[0]?.count).toBe(1);
  });

  it("assigns the named seeded role and dedups a redelivery (at-least-once contract)", async () => {
    // The firm-provisioner payload shape: the owner arrives with the Admin role by name.
    const userId = await directInsertUser("sweep-role-owner@example.com", "Role Owner");
    const outboxId = await insertMemberProvisionOutboxRow(env.DB_CONTROL, {
      userId,
      firmId: poolFirmId,
      displayName: "Role Owner",
      roleName: "Admin",
    });

    await runScheduledSweep(env);
    expect(await outboxRowState(env.DB_CONTROL, outboxId)).toEqual({
      status: "dispatched",
      attempts: 0,
    });

    const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
    const { results: roleResults } = await firmDatabase
      .prepare("SELECT id FROM role WHERE name = 'Admin'")
      .all<{ id: string }>();
    const seededRole = roleResults[0];
    const roleRows = await firmDatabase
      .prepare("SELECT role_id FROM member_role WHERE member_user_id = ?1")
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

    const { results: memberCountResults } = await firmDatabase
      .prepare("SELECT COUNT(*) AS count FROM member WHERE user_id = ?1")
      .bind(userId)
      .all<{ count: number }>();
    expect(memberCountResults[0]?.count).toBe(1);
    const { results: roleCountResults } = await firmDatabase
      .prepare("SELECT COUNT(*) AS count FROM member_role WHERE member_user_id = ?1")
      .bind(userId)
      .all<{ count: number }>();
    expect(roleCountResults[0]?.count).toBe(1);
  });

  it("dead-letters a poisoned message after max attempts without touching any firm database", async () => {
    // Poison: a malformed firmId format — parseMemberProvisionPayload throws assertIdentifier on
    // every delivery before the firm database is accessed. The relay increments attempts and
    // dead-letters at max attempts (5).
    const outboxId = await insertMemberProvisionOutboxRow(env.DB_CONTROL, {
      userId: newIdentifier("user"),
      firmId: "not-a-valid-firm-id",
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
    const { results: memberResults } = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT user_id FROM member WHERE user_id = ?1")
      .bind(userId)
      .all();
    expect(memberResults[0]).toBeUndefined();
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

/*
 * THE FOUNDING CASCADE — the one control-plane chain whose second link is written by the first.
 *
 * Activating a firm queues the member.provision row that mirrors its owner into the firm's own
 * database, and it is queued by a consumer running INSIDE the pass. A sweep that read its pending
 * set once had already read past it: the firm went active, the owner was attached to a firm whose
 * database had never heard of them, and every screen that checks a permission refused until the
 * next cron fire minutes later. This is the pin that the pass carries the chain to its end.
 */
describe("runScheduledSweep — the founding cascade", () => {
  it("activates a firm and mirrors its owner in ONE pass", async () => {
    // The account-first founding door's shape (POST /api/v1/me/firm): the founder already holds an
    // account, so provisioning adopts it rather than creating one and no activation mail is sent.
    const registrationId = newIdentifier("registration");
    const founderUserId = newIdentifier("user");
    const email = `cascade-founder-${registrationId}@example.com`;
    const nowInstant = new Date().toISOString();

    await env.DB_CONTROL.prepare(
      'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, firm_id) VALUES (?1, ?2, ?3, 1, ?4, ?4, NULL)',
    )
      .bind(founderUserId, "Cascade Founder", email, Date.now())
      .run();
    await env.DB_CONTROL.prepare(
      "INSERT INTO registration (id, role, email, display_name, firm_display_name, confirmation_hash, status, expires_at, confirmed_at, created_at) " +
        "VALUES (?1, 'foundFirm', ?2, ?3, ?4, ?5, 'confirmed', ?6, ?6, ?6)",
    )
      .bind(registrationId, email, "Cascade Founder", "Cascade and Company", "unused", nowInstant)
      .run();
    await env.DB_CONTROL.prepare(
      "INSERT INTO outbox (id, topic, payload, aggregate_key, seq, status, attempts, created_at) VALUES (?1, 'firm.provision', ?2, NULL, NULL, 'pending', 0, ?3)",
    )
      .bind(
        newIdentifier("outbox"),
        canonicalJsonStringify({
          registrationId,
          firmDisplayName: "Cascade and Company",
          owner: { email, name: "Cascade Founder", userId: founderUserId },
        }),
        nowInstant,
      )
      .run();

    const report = await runScheduledSweep(env);
    expect(report.controlPlane.failed).toBe(0);

    // The firm is active and the founder is attached to it — the half that always worked.
    const firm = await env.DB_CONTROL.prepare("SELECT id, status FROM firm WHERE name = ?1")
      .bind(registrationId)
      .first<{ id: string; status: string }>();
    expect(firm?.status).toBe("active");

    // And the half that did not: the member row every permission resolves through, in the firm's
    // OWN database, written by a row this same pass had to go back for.
    const memberResults = await firmDatabaseFor(env.FIRM_DATABASE, (firm?.id ?? "") as FirmId)
      .prepare(
        "SELECT member.status AS status, role.name AS role_name FROM member " +
          "LEFT JOIN member_role ON member_role.member_user_id = member.user_id " +
          "LEFT JOIN role ON role.id = member_role.role_id WHERE member.user_id = ?1",
      )
      .bind(founderUserId)
      .all<{ status: string; role_name: string | null }>();
    expect(memberResults.results).toEqual([{ status: "active", role_name: "Admin" }]);
  });
});

describe("runScheduledSweep — per-firm relay and TTL purge", () => {
  it("sweeps an active firm's outbox to env.QUEUE and marks rows dispatched", async () => {
    // Nothing consumes the per-firm queue yet this slice — publishing + the dispatched mark IS
    // the relay contract; the consumer arrives with the first per-firm topic.
    const outboxId = newIdentifier("outbox");
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO outbox (id, topic, payload, aggregate_key, seq, status, attempts, created_at) VALUES (?1, 'demo.topic', '{}', NULL, NULL, 'pending', 0, ?2)",
      )
      .bind(outboxId, new Date().toISOString())
      .run();

    const report = await runScheduledSweep(env);
    expect(report.firmSweeps).toBeGreaterThanOrEqual(1);
    expect(await outboxRowState(firmDatabaseFor(env.FIRM_DATABASE, poolFirmId), outboxId)).toEqual({
      status: "dispatched",
      attempts: 0,
    });
  });

  it("publishes the queue message with the pinned field names { id, firmId, topic, payload, aggregateKey, seq, causeOccurredAt }", async () => {
    // The field names are a wire contract: consumers dedup on id and order by
    // (aggregateKey, seq), and firmId resolves the originating tenant because per-firm
    // messages cross the single SHARED queue (a per-firm consumer has no other
    // handle on which physical database the row came from). causeOccurredAt carries the outbox row's
    // own creation instant — which is when the business write COMMITTED, the two landing in one
    // atomic batch — so a consumer that reports an interval reports the firm's rather than the
    // queue's. A capturing fake QUEUE pins the shape.
    const outboxId = newIdentifier("outbox");
    const createdAt = new Date().toISOString();
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        `INSERT INTO outbox (id, topic, payload, aggregate_key, seq, status, attempts, created_at) VALUES (?1, 'demo.shape', '{"demo":true}', 'agg_demo', 7, 'pending', 0, ?2)`,
      )
      .bind(outboxId, createdAt)
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
      causeOccurredAt: createdAt,
    });
  });

  it("purges expired idempotency records on the control plane and each reachable firm database", async () => {
    const hourMilliseconds = 60 * 60 * 1000;
    const expired = new Date(Date.now() - 25 * hourMilliseconds).toISOString();
    const fresh = new Date().toISOString();
    const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
    // A minimal common interface satisfied by both D1Database and firmDatabase (ProxyBatchDatabase).
    // Both support prepare().bind().run() and prepare().all() (the bound form is a fluent no-op
    // when no parameters are needed: ProxySqlStatement.bind returns itself unchanged).
    type AnyWriteReadDatabase = {
      prepare(sql: string): {
        bind(...values: unknown[]): {
          run(): Promise<unknown>;
          all<T>(): Promise<{ results: T[] }>;
        };
        all<T>(): Promise<{ results: T[] }>;
        run(): Promise<unknown>;
      };
    };
    for (const database of [env.DB_CONTROL as AnyWriteReadDatabase, firmDatabase]) {
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

    for (const database of [env.DB_CONTROL as AnyWriteReadDatabase, firmDatabase]) {
      const remaining = await database
        .prepare("SELECT key FROM idempotency_key WHERE key IN ('ttl-expired', 'ttl-fresh')")
        .all<{ key: string }>();
      expect(remaining.results).toEqual([{ key: "ttl-fresh" }]);
    }
  });
});

describe("runScheduledSweep — control-plane migrations", () => {
  it("runs the control-plane migration step without error and leaves DB_CONTROL at head", async () => {
    await runScheduledSweep(env);
    const probe = await env.DB_CONTROL.prepare("SELECT release_channel FROM firm LIMIT 1").all();
    expect(probe.success).toBe(true);
    const head = controlPlaneHeadSchemaVersion();
    const applied = await env.DB_CONTROL.prepare("SELECT tag FROM _migrations WHERE tag = ?")
      .bind(head)
      .first<{ tag: string }>();
    expect(applied?.tag).toBe(head);
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

    const { results: memberResults } = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT display_name FROM member WHERE user_id = ?1")
      .bind(userId)
      .all<{ display_name: string }>();
    expect(memberResults[0]).toEqual({ display_name: "Cron User" });
  });
});
