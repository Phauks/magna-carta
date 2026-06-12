import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { FirmId } from "@magna-carta/identifiers/types";
import {
  provisionFirm,
  type FirmProvisionerDependencies,
  type ProvisionFirmInput,
} from "../src/firm-provisioner.ts";
import type { FirmResourceProvider } from "../src/firm-resource-provider.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";

// Provisioner state-machine tests: FAKE ports that count calls (the resume assertions), a REAL
// Miniflare control-plane database (the guards are SQL — stubbing the database would test nothing).

const HEAD = "0002_member-rbac";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

interface FakePorts {
  readonly dependencies: FirmProvisionerDependencies;
  readonly calls: { createDatabase: number; createBucket: number; migrate: number };
  failures: { createDatabase?: boolean; createBucket?: boolean; migrate?: boolean };
}

function fakePorts(): FakePorts {
  const calls = { createDatabase: 0, createBucket: 0, migrate: 0 };
  const failures: FakePorts["failures"] = {};
  const resourceProvider: FirmResourceProvider = {
    createDatabase(firmId: FirmId) {
      calls.createDatabase += 1;
      if (failures.createDatabase)
        return Promise.reject(new Error("injected createDatabase crash"));
      return Promise.resolve({ databaseIdentifier: `fake-database-${firmId}` });
    },
    createBucket(firmId: FirmId) {
      calls.createBucket += 1;
      if (failures.createBucket) return Promise.reject(new Error("injected createBucket crash"));
      return Promise.resolve({ bucketName: `fake-bucket-${firmId}` });
    },
  };
  return {
    calls,
    failures,
    dependencies: {
      controlPlaneDatabase: env.DB_CONTROL,
      resourceProvider,
      migrateFirmDatabaseToHead: (databaseIdentifier: string) => {
        calls.migrate += 1;
        if (failures.migrate) return Promise.reject(new Error("injected migrate crash"));
        expect(databaseIdentifier).toMatch(/^fake-database-/);
        return Promise.resolve({ latestTag: HEAD });
      },
      headSchemaVersion: HEAD,
    },
  };
}

async function firmRowByName(name: string) {
  return env.DB_CONTROL.prepare(
    "SELECT id, status, database_identifier, per_firm_schema_version, bucket_name FROM firm WHERE name = ?1",
  )
    .bind(name)
    .first<{
      id: string;
      status: string;
      database_identifier: string | null;
      per_firm_schema_version: string | null;
      bucket_name: string | null;
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
    expect(outcome.ownerUserId).toMatch(/^usr_/);
    expect(outcome.ownerEmail).toBe(ownerEmailFor(input.name)); // lowercased from the uppercase input

    const firmRow = await firmRowByName(input.name);
    expect(firmRow).toEqual({
      id: outcome.firmId,
      status: "active",
      database_identifier: `fake-database-${outcome.firmId}`,
      per_firm_schema_version: HEAD,
      bucket_name: `fake-bucket-${outcome.firmId}`,
    });

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

    // The member.provision outbox row carries the Owner/Admin role (canonical JSON, sorted keys).
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
      roleName: "Owner/Admin",
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

    expect(ports.calls).toEqual({ createDatabase: 1, migrate: 1, createBucket: 1 });
  });

  it("resumes after a crash in createDatabase: the firm row survives, no step re-runs early", async () => {
    const ports = fakePorts();
    const input = inputFor("Crash At Database Firm");

    ports.failures.createDatabase = true;
    await expect(provisionFirm(ports.dependencies, input)).rejects.toThrow(
      "injected createDatabase crash",
    );
    const partialRow = await firmRowByName(input.name);
    expect(partialRow?.status).toBe("provisioning");
    expect(partialRow?.database_identifier).toBeNull();

    ports.failures.createDatabase = false;
    const outcome = await provisionAndCommit(ports, input);
    expect(outcome.kind).toBe("ready-to-activate");
    expect((await firmRowByName(input.name))?.status).toBe("active");
    // createDatabase never succeeded, so the resume retries it; everything else ran once.
    expect(ports.calls).toEqual({ createDatabase: 2, migrate: 1, createBucket: 1 });
  });

  it("resumes after a crash in the migrate step without re-creating the database", async () => {
    const ports = fakePorts();
    const input = inputFor("Crash At Migrate Firm");

    ports.failures.migrate = true;
    await expect(provisionFirm(ports.dependencies, input)).rejects.toThrow(
      "injected migrate crash",
    );
    const partialRow = await firmRowByName(input.name);
    expect(partialRow?.database_identifier).toMatch(/^fake-database-/);
    expect(partialRow?.per_firm_schema_version).toBeNull();

    ports.failures.migrate = false;
    const outcome = await provisionAndCommit(ports, input);
    expect(outcome.kind).toBe("ready-to-activate");
    expect(ports.calls).toEqual({ createDatabase: 1, migrate: 2, createBucket: 1 });
  });

  it("resumes after a crash in createBucket without re-running database or migration", async () => {
    const ports = fakePorts();
    const input = inputFor("Crash At Bucket Firm");

    ports.failures.createBucket = true;
    await expect(provisionFirm(ports.dependencies, input)).rejects.toThrow(
      "injected createBucket crash",
    );
    const partialRow = await firmRowByName(input.name);
    expect(partialRow?.per_firm_schema_version).toBe(HEAD);
    expect(partialRow?.bucket_name).toBeNull();

    ports.failures.createBucket = false;
    const outcome = await provisionAndCommit(ports, input);
    expect(outcome.kind).toBe("ready-to-activate");
    expect(ports.calls).toEqual({ createDatabase: 1, migrate: 1, createBucket: 2 });
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
    // All resource steps were already durable — neither run re-invoked any port a second time.
    expect(ports.calls).toEqual({ createDatabase: 1, migrate: 1, createBucket: 1 });
  });

  it("answers already-active for a double full-invoke, touching no port", async () => {
    const ports = fakePorts();
    const input = inputFor("Double Invoke Firm");

    const first = await provisionAndCommit(ports, input);
    expect(first.kind).toBe("ready-to-activate");

    const second = await provisionAndCommit(ports, input);
    expect(second.kind).toBe("already-active");
    if (second.kind !== "already-active") return;
    expect(second.firmId).toBe(first.kind === "ready-to-activate" ? first.firmId : "");
    expect(second.owner.email).toBe(ownerEmailFor(input.name));
    expect(second.owner.name).toBe("Owning Owner");
    expect(ports.calls).toEqual({ createDatabase: 1, migrate: 1, createBucket: 1 });
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
});
