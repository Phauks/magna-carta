import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { DataRegion } from "@magna-carta/database/data-region";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { isFirmActivationConflict } from "../src/control-plane-conflicts.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  provisionFirm,
  type FirmProvisionerDependencies,
  type ProvisionFirmInput,
} from "../src/firm-provisioner.ts";
import type { FirmResourceProvider } from "../src/firm-resource-provider.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";

// Provisioner state-machine tests: FAKE ports that count calls (the resume assertions), a REAL
// Miniflare control-plane database (the guards are SQL — stubbing the database would test nothing).
// The firm's per-firm database is the firmId-addressed FirmDatabase DO, which self-migrates on
// first access — provisioning has no database-create or migrate step, so the ports cover only R2.

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

interface FakePorts {
  readonly dependencies: FirmProvisionerDependencies;
  readonly calls: {
    createBucket: number;
    configureBucketNotifications: number;
    configureBucketLifecycle: number;
    configureBucketCors: number;
  };
  readonly regions: DataRegion[];
  failures: { createBucket?: boolean };
}

function fakePorts(): FakePorts {
  const calls = {
    createBucket: 0,
    configureBucketNotifications: 0,
    configureBucketLifecycle: 0,
    configureBucketCors: 0,
  };
  const regions: DataRegion[] = [];
  const failures: FakePorts["failures"] = {};
  const resourceProvider: FirmResourceProvider = {
    kind: "development",
    bucketExists(_firmId: FirmId, _region: DataRegion) {
      return Promise.resolve(true);
    },
    createBucket(firmId: FirmId, region: DataRegion) {
      calls.createBucket += 1;
      regions.push(region);
      if (failures.createBucket) return Promise.reject(new Error("injected createBucket crash"));
      return Promise.resolve({ bucketName: `fake-bucket-${firmId}` });
    },
    configureBucketNotifications(_firmId: FirmId, _region: DataRegion) {
      calls.configureBucketNotifications += 1;
      return Promise.resolve();
    },
    configureBucketLifecycle(_firmId: FirmId, _region: DataRegion) {
      calls.configureBucketLifecycle += 1;
      return Promise.resolve();
    },
    configureBucketCors(_firmId: FirmId, _region: DataRegion) {
      calls.configureBucketCors += 1;
      return Promise.resolve();
    },
  };
  return {
    calls,
    regions,
    failures,
    dependencies: {
      controlPlaneDatabase: env.DB_CONTROL,
      resourceProvider,
      // A fixed base64 32-byte placeholder — the wrap is real (importRootKek/wrapFirmKey), so the
      // minted wrapped_firm_key is a genuine AES-KW ciphertext, just under a test root KEK.
      rootKekBase64: "bWFnbmEtY2FydGEtbG9jYWwtZGV2LXJvb3Qta2VrISE=",
    },
  };
}

async function firmRowByName(name: string) {
  return env.DB_CONTROL.prepare(
    "SELECT id, status, bucket_name, owner_user_id FROM firm WHERE name = ?1",
  )
    .bind(name)
    .first<{
      id: string;
      status: string;
      bucket_name: string | null;
      owner_user_id: string | null;
    }>();
}

function ownerEmailFor(name: string): string {
  return `owner-of-${name.toLowerCase().replaceAll(" ", "-")}@example.com`;
}

function inputFor(name: string): ProvisionFirmInput {
  // Mixed-case input pins the provisioner's lowercasing of the stored owner email.
  return { name, owner: { email: ownerEmailFor(name).toUpperCase(), name: "Owning Owner" } };
}

// Runs provisionFirm and commits the activation batch — the test-side stand-in for the route's
// runIdempotentEffect commit.
async function provisionAndCommit(ports: FakePorts, input: ProvisionFirmInput) {
  const outcome = await provisionFirm(ports.dependencies, input);
  if (outcome.kind === "ready-to-activate") {
    await commitEffectBatch(env.DB_CONTROL, outcome.finalWrite, {
      now: () => new Date().toISOString(),
    });
  }
  return outcome;
}

describe("provisionFirm", () => {
  it("provisions end-to-end: firm active, resources recorded, owner + outbox + audit in the final batch", async () => {
    const ports = fakePorts();
    const input = inputFor("Happy Path Firm");

    const outcome = await provisionAndCommit(ports, input);
    expect(outcome.kind).toBe("ready-to-activate");
    if (outcome.kind !== "ready-to-activate") return;
    expect(outcome.firmId).toMatch(/^firm_/);
    expect(outcome.ownerUserId).toMatch(/^user_/);
    expect(outcome.ownerEmail).toBe(ownerEmailFor(input.name)); // lowercased from the uppercase input

    const firmRow = await firmRowByName(input.name);
    expect(firmRow).toEqual({
      id: outcome.firmId,
      status: "active",
      bucket_name: `fake-bucket-${outcome.firmId}`,
      owner_user_id: outcome.ownerUserId, // recorded by the activation batch — the owner of record
    });

    // The firm's per-firm database needed no provisioning step: its FirmDatabase DO self-migrates
    // to head on first access. A read through firmDatabaseFor proves it — the 0002 Admin role
    // seed is present without provisioning ever having migrated anything.
    const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, outcome.firmId);
    const ownerRole = await firmDatabase
      .prepare("SELECT id FROM role WHERE name = 'Admin'")
      .all<{ id: string }>();
    expect(ownerRole.results[0]?.id).toMatch(/^role_/);

    // The firm-key mint step (4c) sealed a wrapped data key — a non-null AES-KW ciphertext, never
    // the raw bytes; version columns default 1.
    const keyRow = await env.DB_CONTROL.prepare(
      "SELECT wrapped_firm_key, firm_key_version, root_key_version FROM firm WHERE id = ?1",
    )
      .bind(outcome.firmId)
      .first<{
        wrapped_firm_key: string | null;
        firm_key_version: number;
        root_key_version: number;
      }>();
    expect(keyRow?.wrapped_firm_key).toEqual(expect.any(String));
    expect(keyRow?.firm_key_version).toBe(1);
    expect(keyRow?.root_key_version).toBe(1);

    // Owner user: unverified, account-less, attached to the firm (activation via reset — Path A).
    const ownerRow = await env.DB_CONTROL.prepare(
      'SELECT name, email, email_verified, firm_id FROM "user" WHERE id = ?1',
    )
      .bind(outcome.ownerUserId)
      .first<{ name: string; email: string; email_verified: number; firm_id: string }>();
    expect(ownerRow).toEqual({
      name: "Owning Owner",
      email: outcome.ownerEmail,
      email_verified: 0,
      firm_id: outcome.firmId,
    });

    // The member.provision outbox row carries the Admin role (canonical JSON, sorted keys).
    const outboxRow = await env.DB_CONTROL.prepare(
      "SELECT topic, payload, status FROM outbox WHERE payload LIKE '%' || ?1 || '%'",
    )
      .bind(outcome.ownerUserId)
      .first<{ topic: string; payload: string; status: string }>();
    expect(outboxRow?.topic).toBe("member.provision");
    expect(outboxRow?.status).toBe("pending");
    expect(JSON.parse(outboxRow?.payload ?? "{}")).toEqual({
      displayName: "Owning Owner",
      firmId: outcome.firmId,
      roleName: "Admin",
      userId: outcome.ownerUserId,
    });

    // The firm.provisioned audit row: actor-less (platform-admin seam), ids in metadata.
    const auditRow = await env.DB_CONTROL.prepare(
      "SELECT user_id, metadata FROM auth_audit WHERE event = 'firm.provisioned' AND metadata LIKE '%' || ?1 || '%'",
    )
      .bind(outcome.firmId)
      .first<{ user_id: string | null; metadata: string }>();
    expect(auditRow?.user_id).toBeNull();
    expect(JSON.parse(auditRow?.metadata ?? "{}")).toEqual({
      firmId: outcome.firmId,
      ownerUserId: outcome.ownerUserId,
    });

    expect(ports.calls).toEqual({
      createBucket: 1,
      configureBucketNotifications: 1,
      configureBucketLifecycle: 1,
      configureBucketCors: 1,
    });
  });

  it("resumes after a crash in createBucket: the firm row survives, the bucket step re-runs", async () => {
    const ports = fakePorts();
    const input = inputFor("Crash At Bucket Firm");

    ports.failures.createBucket = true;
    await expect(provisionFirm(ports.dependencies, input)).rejects.toThrow(
      "injected createBucket crash",
    );
    const partialRow = await firmRowByName(input.name);
    expect(partialRow?.status).toBe("provisioning");
    expect(partialRow?.bucket_name).toBeNull();

    ports.failures.createBucket = false;
    const outcome = await provisionAndCommit(ports, input);
    expect(outcome.kind).toBe("ready-to-activate");
    expect((await firmRowByName(input.name))?.status).toBe("active");
    // createBucket never succeeded, so the resume retries it; everything else ran once.
    expect(ports.calls).toEqual({
      createBucket: 2,
      configureBucketNotifications: 1,
      configureBucketLifecycle: 1,
      configureBucketCors: 1,
    });
  });

  it("resumes after a crash BEFORE the final commit: no port re-runs, a fresh activation batch lands", async () => {
    const ports = fakePorts();
    const input = inputFor("Crash Before Activation Firm");

    // The run completed steps 1-4 but its activation batch never committed (e.g. the worker died
    // before runIdempotentEffect's batch) — exactly the case where no idempotency record exists
    // and the handler re-executes.
    const uncommitted = await provisionFirm(ports.dependencies, input);
    expect(uncommitted.kind).toBe("ready-to-activate");
    expect((await firmRowByName(input.name))?.status).toBe("provisioning");

    const outcome = await provisionAndCommit(ports, input);
    expect(outcome.kind).toBe("ready-to-activate");
    expect((await firmRowByName(input.name))?.status).toBe("active");
    // The guarded createBucket step was already durable, so neither run re-invoked it.
    // configureBucketNotifications is UNCONDITIONAL and idempotent — it runs once per run reaching
    // the bucket step (twice across the two runs here), the price of its resume-safety (a run that
    // created the bucket but died before configuring must still configure on retry).
    expect(ports.calls).toEqual({
      createBucket: 1,
      configureBucketNotifications: 2,
      configureBucketLifecycle: 2,
      configureBucketCors: 2,
    });
  });

  it("answers already-active for a double full-invoke, touching no port", async () => {
    const ports = fakePorts();
    const input = inputFor("Double Invoke Firm");

    const first = await provisionAndCommit(ports, input);
    expect(first.kind).toBe("ready-to-activate");
    if (first.kind !== "ready-to-activate") return;

    const second = await provisionAndCommit(ports, input);
    expect(second.kind).toBe("already-active");
    if (second.kind !== "already-active") return;
    expect(second.firmId).toBe(first.firmId);
    expect(second.owner.email).toBe(ownerEmailFor(input.name));
    expect(second.owner.name).toBe("Owning Owner");
    expect(ports.calls).toEqual({
      createBucket: 1,
      configureBucketNotifications: 1,
      configureBucketLifecycle: 1,
      configureBucketCors: 1,
    });
  });

  it("mints the firm key exactly once — a resumed provisioning run leaves the existing wrapped key untouched", async () => {
    const ports = fakePorts();
    const input = inputFor("Key Mint Idempotent Firm");

    const first = await provisionAndCommit(ports, input);
    expect(first.kind).toBe("ready-to-activate");
    if (first.kind !== "ready-to-activate") return;
    const minted = await env.DB_CONTROL.prepare("SELECT wrapped_firm_key FROM firm WHERE id = ?1")
      .bind(first.firmId)
      .first<{ wrapped_firm_key: string | null }>();
    expect(minted?.wrapped_firm_key).toEqual(expect.any(String));

    // A second full invoke is an already-active no-op (the firm is active), and the wrapped key is
    // byte-identical — re-provisioning never re-mints.
    const second = await provisionAndCommit(ports, input);
    expect(second.kind).toBe("already-active");
    const afterReinvoke = await env.DB_CONTROL.prepare(
      "SELECT wrapped_firm_key FROM firm WHERE id = ?1",
    )
      .bind(first.firmId)
      .first<{ wrapped_firm_key: string | null }>();
    expect(afterReinvoke?.wrapped_firm_key).toBe(minted?.wrapped_firm_key);
  });

  it("never re-mints a key for a shredded firm — a firm.key_shredded audit row makes the null key permanent", async () => {
    const ports = fakePorts();
    const input = inputFor("Shredded No Remint Firm");
    const outcome = await provisionAndCommit(ports, input);
    expect(outcome.kind).toBe("ready-to-activate");
    if (outcome.kind !== "ready-to-activate") return;

    // Simulate a completed crypto-shred: null the wrapped key and record the shred audit.
    await env.DB_CONTROL.prepare("UPDATE firm SET wrapped_firm_key = NULL WHERE id = ?1")
      .bind(outcome.firmId)
      .run();
    await env.DB_CONTROL.prepare(
      "INSERT INTO auth_audit (id, event, user_id, metadata, created_at) VALUES (?1, 'firm.key_shredded', NULL, ?2, ?3)",
    )
      .bind(
        "authAudit_shredNoRemintFirmTest01",
        JSON.stringify({ firmId: outcome.firmId }),
        new Date().toISOString(),
      )
      .run();

    // A resumed provisioning attempt must NOT re-mint past a shred — the null key stays null.
    await provisionFirm(ports.dependencies, input);
    const afterResume = await env.DB_CONTROL.prepare(
      "SELECT wrapped_firm_key FROM firm WHERE id = ?1",
    )
      .bind(outcome.firmId)
      .first<{ wrapped_firm_key: string | null }>();
    expect(afterResume?.wrapped_firm_key).toBeNull();
  });

  it("answers name-conflict when an ACTIVE firm holds the name with a different owner", async () => {
    const ports = fakePorts();
    const input = inputFor("Name Conflict Firm");
    const first = await provisionAndCommit(ports, input);
    expect(first.kind).toBe("ready-to-activate");

    const conflicting = await provisionFirm(ports.dependencies, {
      name: input.name,
      owner: { email: "someone-else@example.com", name: "Someone Else" },
    });
    expect(conflicting.kind).toBe("name-conflict");
  });

  it("answers name-conflict — NOT already-active — when the requested owner is a mere member of the firm", async () => {
    const ports = fakePorts();
    const input = inputFor("Member Impersonation Firm");
    const first = await provisionAndCommit(ports, input);
    expect(first.kind).toBe("ready-to-activate");
    if (first.kind !== "ready-to-activate") return;

    // Bob: an invited (non-owner) member of the firm — a user row with the same firm_id, exactly
    // what members.invite commits. His email must not pass the already-active owner match.
    await env.DB_CONTROL.prepare(
      'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, firm_id) VALUES (?1, ?2, ?3, 0, ?4, ?4, ?5)',
    )
      .bind(
        "user_bbbbbbbbbbbbbbbbbbbbb",
        "Invited Bob",
        "invited-bob@example.com",
        Date.now(),
        first.firmId,
      )
      .run();

    const asMember = await provisionFirm(ports.dependencies, {
      name: input.name,
      owner: { email: "invited-bob@example.com", name: "Invited Bob" },
    });
    expect(asMember.kind).toBe("name-conflict");
  });

  it("aborts the LOSER's activation batch when a concurrent different-owner run activated first", async () => {
    // The most serious interleaving: run A (alice) pauses before its final batch; run B (bob, the
    // SAME name under a different Idempotency-Key) reads status='provisioning', adopts A's durable
    // step 2-4 claims, and commits its activation. A's batch must then ABORT whole — without the
    // activation fence it would commit cleanly (different email, 0-row status flip) and leave TWO
    // Admins.
    const portsA = fakePorts();
    const name = "Interleaved Activation Firm";
    const runA = await provisionFirm(portsA.dependencies, {
      name,
      owner: { email: "interleaved-alice@example.com", name: "Alice" },
    });
    expect(runA.kind).toBe("ready-to-activate");
    if (runA.kind !== "ready-to-activate") return;

    const portsB = fakePorts();
    const runB = await provisionAndCommit(portsB, {
      name,
      owner: { email: "interleaved-bob@example.com", name: "Bob" },
    });
    expect(runB.kind).toBe("ready-to-activate");
    if (runB.kind !== "ready-to-activate") return;
    // B adopted A's recorded bucket — the guarded createBucket port never re-ran; only the
    // unconditional, idempotent configureBucketNotifications fired (once, for B's run).
    expect(portsB.calls).toEqual({
      createBucket: 0,
      configureBucketNotifications: 1,
      configureBucketLifecycle: 1,
      configureBucketCors: 1,
    });

    // Resume A: its activation batch must abort (the fence's PRIMARY KEY collision), and the
    // error must be the one the route maps to its concurrent-provisioning 409 problem.
    const caught = await commitEffectBatch(env.DB_CONTROL, runA.finalWrite, {
      now: () => new Date().toISOString(),
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("UNIQUE constraint failed: firm.id");
    expect(isFirmActivationConflict(caught)).toBe(true);

    // Exactly ONE owner of record: B's user, B's outbox row, B recorded as owner_user_id.
    const firmRow = await firmRowByName(name);
    expect(firmRow?.status).toBe("active");
    expect(firmRow?.owner_user_id).toBe(runB.ownerUserId);
    const userCount = await env.DB_CONTROL.prepare(
      'SELECT COUNT(*) AS count FROM "user" WHERE firm_id = ?1',
    )
      .bind(firmRow?.id)
      .first<{ count: number }>();
    expect(userCount?.count).toBe(1);
    const outboxCount = await env.DB_CONTROL.prepare(
      "SELECT COUNT(*) AS count FROM outbox WHERE topic = 'member.provision' AND payload LIKE '%' || ?1 || '%'",
    )
      .bind(firmRow?.id)
      .first<{ count: number }>();
    expect(outboxCount?.count).toBe(1);
  });

  it("passes the firm's data_region to createBucket", async () => {
    const ports = fakePorts();
    const input = inputFor("EU Residency LLP");

    // Pre-insert the firm row with data_region='eu' so provisionFirm's find-or-insert finds it
    // rather than inserting a fresh row under the 'us' column default.
    const firmId = newIdentifier("firm");
    await env.DB_CONTROL.prepare(
      "INSERT INTO firm (id, name, status, data_region, created_at) VALUES (?1, ?2, 'provisioning', 'eu', ?3)",
    )
      .bind(firmId, input.name, new Date().toISOString())
      .run();

    await provisionAndCommit(ports, input);
    expect(ports.regions).toContain("eu");
  });
});
