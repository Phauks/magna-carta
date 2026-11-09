import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { runScheduledSweep } from "../../src/background/scheduled.ts";
import { firmDatabaseFor } from "../../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "../support/apply-control-plane-migrations.ts";
import { seedFirm } from "../support/test-auth.ts";

// Regression verifier for per-firm failure isolation in the scheduled cron pass (scheduled.ts).
//
// Every active firm is addressable through its own FirmDatabase Durable Object, so a single sick DO
// (migration failure, transient overload, eviction mid-flight) that rejects every RPC must NEVER
// abort the whole pass. The reconciliation backstop's per-firm member read (findUnprovisionedMembers)
// is the last unguarded place this could happen: an unhandled throw there skips the control-plane
// idempotency purge AND both security backfills (key mint, incident-description encryption)
// fleet-wide. This test pins the quarantine: one firm's DO rejecting everything leaves the healthy
// firm swept, the pass completing, and the post-backstop backfills still running.

let healthyFirmId: FirmId;
let poisonFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  healthyFirmId = (await seedFirm({ name: "Relay Isolation Healthy Firm" })).firmId;
  poisonFirmId = (await seedFirm({ name: "Relay Isolation Poison Firm" })).firmId;
  // Give the poison firm a control-plane user so the reconciliation backstop reaches its per-firm
  // member read for that firm — the exact RPC that throws.
  await env.DB_CONTROL.prepare(
    'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, firm_id) VALUES (?1, ?2, ?3, 0, ?4, ?4, ?5)',
  )
    .bind(
      newIdentifier("user"),
      "Poison User",
      `poison-${poisonFirmId}@example.com`,
      Date.now(),
      poisonFirmId,
    )
    .run();
});

// Wrap env.FIRM_DATABASE so the poison firm's stub rejects on EVERY RPC, while every other firm
// resolves through the real namespace untouched.
function envWithPoisonFirm(): typeof env {
  const realNamespace = env.FIRM_DATABASE;
  const poisonId = realNamespace.idFromName(poisonFirmId);
  const poisonStub = {
    runRead: () => Promise.reject(new Error("poisoned DO")),
    runWrite: () => Promise.reject(new Error("poisoned DO")),
    commitBatch: () => Promise.reject(new Error("poisoned DO")),
  };
  const wrappedNamespace = {
    idFromName: (name: string) => realNamespace.idFromName(name),
    get: (id: { equals(other: unknown): boolean }) =>
      id.equals(poisonId) ? poisonStub : realNamespace.get(id as never),
  };
  return { ...env, FIRM_DATABASE: wrappedNamespace as unknown as typeof env.FIRM_DATABASE };
}

describe("scheduled cron per-firm isolation", () => {
  it("one firm's DO rejecting every RPC isolates to that firm — healthy firm swept, pass completes, backfills run", async () => {
    const outboxId = newIdentifier("outbox");
    await firmDatabaseFor(env.FIRM_DATABASE, healthyFirmId)
      .prepare(
        "INSERT INTO outbox (id, topic, payload, aggregate_key, seq, status, attempts, created_at) VALUES (?1, 'relay.isolation', '{}', NULL, NULL, 'pending', 0, ?2)",
      )
      .bind(outboxId, new Date().toISOString())
      .run();

    const poisonedEnv = envWithPoisonFirm();

    // The pass MUST resolve, not reject — the sick firm's failed member read is quarantined inside
    // findUnprovisionedMembers (it is not allowed to throw out of the pass).
    const report = await runScheduledSweep(poisonedEnv);

    // The pass ran to completion and produced its report.
    expect(report).toBeDefined();

    // PROOF 1 — the per-firm OUTBOX sweep isolated the poison firm: the healthy firm's row dispatched.
    const { results } = await firmDatabaseFor(env.FIRM_DATABASE, healthyFirmId)
      .prepare("SELECT status FROM outbox WHERE id = ?1")
      .bind(outboxId)
      .all<{ status: string }>();
    expect(results[0]?.status).toBe("dispatched");

    // PROOF 2 — the reconciliation backstop quarantined the poison firm rather than aborting the
    // pass: its throwing member read produced no finding, and never surfaced the poison firm's user.
    expect(report.unprovisionedMembers.some((member) => member.firmId === poisonFirmId)).toBe(
      false,
    );

    // PROOF 3 — the security backfills that run AFTER the reconciliation backstop still executed.
    // Before the quarantine, the backstop's unguarded throw skipped both of these fleet-wide. The
    // key-mint backfill processed at least the healthy firm (a control-plane scan untouched by the
    // poison firm); the incident-encrypt backfill ran its per-firm step and isolated the poison firm
    // through its own guard, so the healthy firm is still processed.
    expect(report.keyMint.firmsProcessed).toBeGreaterThanOrEqual(1);
    expect(report.incidentEncrypt.firmsProcessed).toBeGreaterThanOrEqual(1);
  });
});
