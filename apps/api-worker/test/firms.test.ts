import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { firmResourceName } from "../src/firm-resource-provider.ts";
import { perFirmHeadSchemaVersion } from "../src/per-firm-migrations.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";

// POST /api/v1/firms end-to-end (Miniflare): the platform-admin guard, the resumable provisioner
// behind the R2 resource provider, idempotent replay, and the conflict problems. Each firm's
// per-firm database is its firmId-addressed FirmDatabase DO, which self-migrates on first access —
// provisioning has no database-create or migrate step.
//
// Storage is SHARED across this file's tests, so the suite runs as one sequence over two firms:
// "Integration Firm One" carries the happy path, the replay, the double-invoke, and the name
// conflict; "Email Clash Firm" carries the owner-email conflict and the corrected resume.

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

interface ProvisionResponseBody {
  id: string;
  name: string;
  status: string;
  owner: { id: string; email: string; name: string };
}

async function postFirms(
  body: unknown,
  options: { adminKey?: string | null; idempotencyKey?: string } = {},
): Promise<Response> {
  const adminKey = options.adminKey === undefined ? env.PLATFORM_ADMIN_KEY : options.adminKey;
  return SELF.fetch("https://example.com/api/v1/firms", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(adminKey === null ? {} : { "X-Platform-Admin-Key": adminKey }),
      ...(options.idempotencyKey === undefined
        ? {}
        : { "Idempotency-Key": options.idempotencyKey }),
    },
    body: JSON.stringify(body),
  });
}

const FIRM_ONE_NAME = "Integration Firm One";
const FIRM_ONE_OWNER_EMAIL = "integration-firm-one-owner@example.com";
const FIRM_ONE_INPUT = {
  name: FIRM_ONE_NAME,
  owner: { email: FIRM_ONE_OWNER_EMAIL, name: "Firm Owner" },
};
// Set by the happy-path test; the replay/double-invoke/conflict tests run later in this file's
// guaranteed-sequential order and assert against it.
let firmOneKey: string;
let firmOneBody: ProvisionResponseBody;

describe("POST /api/v1/firms", () => {
  it("answers a missing and a wrong X-Platform-Admin-Key with FIELD-IDENTICAL 401 problems", async () => {
    const control = await postFirms(FIRM_ONE_INPUT, {
      adminKey: null,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(control.status).toBe(401);
    expect(control.headers.get("content-type")).toContain("application/problem+json");
    const controlBody = (await control.json()) as Record<string, unknown>;
    expect(controlBody).toMatchObject({
      type: "https://api.magnacarta.esq/problems/unauthenticated",
      status: 401,
    });
    expect(controlBody["errorId"]).toMatch(/^error_/);
    expect(controlBody["correlationId"]).toMatch(/^correlation_/);

    // Wrong key (including a near-miss prefix) answers identically to no key — no probe surface.
    // errorId and correlationId are per-request by design, so drop both before the field-identity
    // comparison (each request mints its own; their PRESENCE and shape are pinned above).
    delete controlBody["errorId"];
    delete controlBody["correlationId"];
    for (const wrongKey of ["wrong-key", `${env.PLATFORM_ADMIN_KEY}x`]) {
      const probe = await postFirms(FIRM_ONE_INPUT, {
        adminKey: wrongKey,
        idempotencyKey: crypto.randomUUID(),
      });
      expect(probe.status).toBe(401);
      expect(probe.headers.get("content-type")).toBe(control.headers.get("content-type"));
      const probeBody = (await probe.json()) as Record<string, unknown>;
      expect(probeBody["errorId"]).toMatch(/^error_/);
      delete probeBody["errorId"];
      delete probeBody["correlationId"];
      expect(probeBody).toEqual(controlBody);
    }

    // Nothing was provisioned by any of it.
    const firmCount = await env.DB_CONTROL.prepare("SELECT COUNT(*) AS count FROM firm").first<{
      count: number;
    }>();
    expect(firmCount?.count).toBe(0);
  });

  it("emits a redacted, Error-ID-correlated auth.denied telemetry event — never the key (golden rule 4)", async () => {
    // The client contract (field-identical 401 across missing/wrong/unset) is pinned by the test
    // above. THIS test pins the operator-facing half: the guard emits an auth.denied telemetry event
    // distinguishing the cause, correlated to the SAME Error ID the client receives. The allowlist
    // IS the redaction — the event has no slot for a key, so neither the presented nor configured
    // key can be logged. The production Workers logger emits events as JSON lines via console.log;
    // the unconfigured branch is a deploy-time failure now (secrets.required), so the two reachable
    // causes are missing-header and mismatch.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const lastAuthDenied = () =>
      logSpy.mock.calls
        .map((call) => {
          try {
            return JSON.parse(String(call[0])) as {
              name?: string;
              fields?: Record<string, unknown>;
            };
          } catch {
            return null;
          }
        })
        .filter((event) => event?.name === "auth.denied")
        .at(-1);
    try {
      logSpy.mockClear();
      const missing = await postFirms(FIRM_ONE_INPUT, {
        adminKey: null,
        idempotencyKey: crypto.randomUUID(),
      });
      const missingErrorId = ((await missing.json()) as { errorId: string }).errorId;
      const missingEvent = lastAuthDenied();
      expect(missingEvent?.fields?.["cause"]).toBe("missing-header");
      expect(missingEvent?.fields?.["errorId"]).toBe(missingErrorId);

      logSpy.mockClear();
      const presentedWrongKey = `${env.PLATFORM_ADMIN_KEY}-tampered`;
      const wrong = await postFirms(FIRM_ONE_INPUT, {
        adminKey: presentedWrongKey,
        idempotencyKey: crypto.randomUUID(),
      });
      const wrongErrorId = ((await wrong.json()) as { errorId: string }).errorId;
      const wrongEvent = lastAuthDenied();
      expect(wrongEvent?.fields?.["cause"]).toBe("mismatch");
      expect(wrongEvent?.fields?.["errorId"]).toBe(wrongErrorId);
      // Redaction by allowlist: neither the presented key nor the configured secret appears anywhere
      // in the emitted logs (the event has no field for either).
      const allLogs = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(allLogs).not.toContain(presentedWrongKey);
      expect(allLogs).not.toContain(env.PLATFORM_ADMIN_KEY);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("demands the Idempotency-Key header with a 400 problem (x-mc-idempotency: required)", async () => {
    const response = await postFirms(FIRM_ONE_INPUT);
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "https://api.magnacarta.esq/problems/idempotency-key-missing",
      status: 400,
    });
    expect(body["errorId"]).toMatch(/^error_/);
  });

  it("provisions a firm end-to-end: active row, self-migrated firm database, owner effects", async () => {
    firmOneKey = crypto.randomUUID();
    const response = await postFirms(FIRM_ONE_INPUT, { idempotencyKey: firmOneKey });
    expect(response.status).toBe(201);
    firmOneBody = (await response.json()) as ProvisionResponseBody;
    expect(firmOneBody.id).toMatch(/^firm_/);
    expect(firmOneBody.name).toBe(FIRM_ONE_NAME);
    expect(firmOneBody.status).toBe("active");
    expect(firmOneBody.owner.id).toMatch(/^user_/);
    expect(firmOneBody.owner.email).toBe(FIRM_ONE_OWNER_EMAIL);
    expect(firmOneBody.owner.name).toBe("Firm Owner");

    // The firm row: active, dev bucket recorded.
    const firmRow = await env.DB_CONTROL.prepare(
      "SELECT status, bucket_name FROM firm WHERE id = ?1",
    )
      .bind(firmOneBody.id)
      .first<{
        status: string;
        bucket_name: string;
      }>();
    expect(firmRow).toEqual({
      status: "active",
      // The dev provider records a per-firm-unique deterministic bucket name (the event→firm
      // resolution key), not a shared literal.
      bucket_name: await firmResourceName(firmOneBody.id as FirmId),
    });

    // The firm's per-firm database is its firmId-addressed FirmDatabase DO, which self-migrated to
    // head on first access (no provisioning step) — its _migrations carries the lineage head and
    // the 0002 Admin role seed exists.
    const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmOneBody.id);
    const latestApplied = await firmDatabase
      .prepare("SELECT tag FROM _migrations ORDER BY tag DESC LIMIT 1")
      .all<{ tag: string }>();
    expect(latestApplied.results[0]?.tag).toBe(perFirmHeadSchemaVersion());
    const ownerRole = await firmDatabase
      .prepare("SELECT id FROM role WHERE name = 'Admin'")
      .all<{ id: string }>();
    expect(ownerRole.results[0]?.id).toMatch(/^role_/);

    // The owner user: unverified, account-less (activation through the reset link — Path A).
    const ownerRow = await env.DB_CONTROL.prepare(
      'SELECT email, email_verified, firm_id FROM "user" WHERE id = ?1',
    )
      .bind(firmOneBody.owner.id)
      .first<{ email: string; email_verified: number; firm_id: string }>();
    expect(ownerRow).toEqual({
      email: FIRM_ONE_OWNER_EMAIL,
      email_verified: 0,
      firm_id: firmOneBody.id,
    });

    // The owner's member.provision outbox row carries the Admin role.
    const outboxRow = await env.DB_CONTROL.prepare(
      "SELECT topic, payload, status FROM outbox WHERE payload LIKE '%' || ?1 || '%'",
    )
      .bind(firmOneBody.owner.id)
      .first<{ topic: string; payload: string; status: string }>();
    expect(outboxRow?.topic).toBe("member.provision");
    // pending OR dispatched: provisioning fires a best-effort request-path sweep on commit (the R1
    // latency optimization), which may consume this row before the assertion reads it. Its status
    // is incidental here — the row's enqueued topic + Admin payload is what this test pins.
    expect(["pending", "dispatched"]).toContain(outboxRow?.status);
    expect(JSON.parse(outboxRow?.payload ?? "{}")).toEqual({
      displayName: "Firm Owner",
      firmId: firmOneBody.id,
      roleName: "Admin",
      userId: firmOneBody.owner.id,
    });

    // The firm.provisioned audit row (actor-less — the platform-admin principal seam).
    const auditRow = await env.DB_CONTROL.prepare(
      "SELECT user_id, metadata FROM auth_audit WHERE event = 'firm.provisioned' AND metadata LIKE '%' || ?1 || '%'",
    )
      .bind(firmOneBody.id)
      .first<{ user_id: string | null; metadata: string }>();
    expect(auditRow?.user_id).toBeNull();
    expect(JSON.parse(auditRow?.metadata ?? "{}")).toEqual({
      firmId: firmOneBody.id,
      ownerUserId: firmOneBody.owner.id,
    });

    // The post-commit activation email went out: its reset-password verification row exists.
    const verificationRow = await env.DB_CONTROL.prepare(
      "SELECT identifier FROM verification WHERE value = ?1",
    )
      .bind(firmOneBody.owner.id)
      .first<{ identifier: string }>();
    expect(verificationRow?.identifier).toMatch(/^reset-password:/);
  });

  it("replays the stored response for a repeated Idempotency-Key without re-running the provisioner", async () => {
    const replayed = await postFirms(FIRM_ONE_INPUT, { idempotencyKey: firmOneKey });
    expect(replayed.status).toBe(201);
    expect(replayed.headers.get("Idempotency-Replayed")).toBe("true");
    expect((await replayed.json()) as ProvisionResponseBody).toEqual(firmOneBody);

    await expectFirmOneEffectsRanOnce();
  });

  it("answers the existing firm for a double full-invoke under a NEW Idempotency-Key", async () => {
    const second = await postFirms(FIRM_ONE_INPUT, { idempotencyKey: crypto.randomUUID() });
    expect(second.status).toBe(201);
    // A fresh key means a fresh execution, not a replay — the provisioner's already-active
    // no-op answers the existing firm.
    expect(second.headers.get("Idempotency-Replayed")).toBeNull();
    const secondBody = (await second.json()) as ProvisionResponseBody;
    expect(secondBody.id).toBe(firmOneBody.id);
    expect(secondBody.owner.id).toBe(firmOneBody.owner.id);

    await expectFirmOneEffectsRanOnce();
  });

  it("answers 409 when an active firm holds the name with a different owner", async () => {
    const conflicting = await postFirms(
      { name: FIRM_ONE_NAME, owner: { email: "different-owner@example.com", name: "Intruder" } },
      { idempotencyKey: crypto.randomUUID() },
    );
    expect(conflicting.status).toBe(409);
    expect(conflicting.headers.get("content-type")).toContain("application/problem+json");
    expect((await conflicting.json()) as Record<string, unknown>).toMatchObject({
      type: "https://api.magnacarta.esq/problems/conflict",
      title: "Firm name already in use",
      status: 409,
    });
    // The conflict claimed nothing: still exactly one firm row.
    const firmCount = await env.DB_CONTROL.prepare("SELECT COUNT(*) AS count FROM firm").first<{
      count: number;
    }>();
    expect(firmCount?.count).toBe(1);
  });

  it("answers 409 — not the owner's 201 — when the requested owner is a mere member of the firm", async () => {
    // Bob: an invited (non-owner) member of firm one — the user row members.invite commits. The
    // already-active no-op must match the firm's RECORDED owner, not any member's email.
    await env.DB_CONTROL.prepare(
      'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, firm_id) VALUES (?1, ?2, ?3, 0, ?4, ?4, ?5)',
    )
      .bind(
        "user_ccccccccccccccccccccc",
        "Invited Bob",
        "invited-bob@example.com",
        Date.now(),
        firmOneBody.id,
      )
      .run();

    const asMember = await postFirms(
      { name: FIRM_ONE_NAME, owner: { email: "invited-bob@example.com", name: "Invited Bob" } },
      { idempotencyKey: crypto.randomUUID() },
    );
    expect(asMember.status).toBe(409);
    expect((await asMember.json()) as Record<string, unknown>).toMatchObject({
      type: "https://api.magnacarta.esq/problems/conflict",
      title: "Firm name already in use",
      status: 409,
    });
  });

  it("answers 422 for a taken owner email and lets a corrected re-invoke resume the SAME firm", async () => {
    // Second firm, firm one's owner email: steps 1-2 succeed (the bucket is created), then the
    // activation batch trips UNIQUE(user.email) and rolls back whole.
    const clashing = await postFirms(
      { name: "Email Clash Firm", owner: { email: FIRM_ONE_OWNER_EMAIL, name: "Clashing Owner" } },
      { idempotencyKey: crypto.randomUUID() },
    );
    expect(clashing.status).toBe(422);
    expect((await clashing.json()) as Record<string, unknown>).toMatchObject({
      type: "https://api.magnacarta.esq/problems/email-in-use",
      title: "Owner email already in use",
      status: 422,
    });
    const partialRow = await env.DB_CONTROL.prepare(
      "SELECT status FROM firm WHERE name = 'Email Clash Firm'",
    ).first<{ status: string }>();
    expect(partialRow).toEqual({ status: "provisioning" });

    // Re-invoking with a FREE owner email (new key — a corrected request) resumes the partial
    // firm by name: no new row, activation completes.
    const corrected = await postFirms(
      {
        name: "Email Clash Firm",
        owner: { email: "corrected-owner@example.com", name: "Corrected Owner" },
      },
      { idempotencyKey: crypto.randomUUID() },
    );
    expect(corrected.status).toBe(201);
    const correctedBody = (await corrected.json()) as ProvisionResponseBody;
    const resumedRow = await env.DB_CONTROL.prepare(
      "SELECT id, status FROM firm WHERE name = 'Email Clash Firm'",
    ).first<{ id: string; status: string }>();
    expect(resumedRow).toEqual({
      id: correctedBody.id,
      status: "active",
    });
    // The resumed firm's per-firm database (its FirmDatabase DO) self-migrated on first access —
    // the Admin role seed is resolvable.
    const firmTwoDatabase = firmDatabaseFor(env.FIRM_DATABASE, correctedBody.id);
    const roleRows = await firmTwoDatabase
      .prepare("SELECT id FROM role WHERE name = 'Admin'")
      .all<{ id: string }>();
    expect(roleRows.results[0]?.id).toMatch(/^role_/);
  });

  it("emits the route into the OpenAPI document with the native operationId and x-mc metadata", async () => {
    const response = await SELF.fetch("https://example.com/api/openapi.json");
    expect(response.status).toBe(200);
    const document = (await response.json()) as {
      paths: Record<string, { post?: Record<string, unknown> }>;
    };
    const operation = document.paths["/api/v1/firms"]?.post;
    expect(operation).toBeDefined();
    expect(operation?.["operationId"]).toBe("firms.provision");
    expect(operation).toMatchObject({
      "x-mc-operationId": "firms.provision",
      "x-mc-surface": "public",
      "x-mc-authenticated": true,
      "x-mc-permission": "firm:provision",
      "x-mc-resource": "firm",
      "x-mc-audited": true,
      "x-mc-idempotency": "required",
    });
  });
});

// One firm row, one owner user, one outbox row, one activation email — re-asserted after the
// replay and after the new-key double-invoke.
async function expectFirmOneEffectsRanOnce(): Promise<void> {
  for (const [query, binding] of [
    ["SELECT COUNT(*) AS count FROM firm WHERE name = ?1", FIRM_ONE_NAME],
    ['SELECT COUNT(*) AS count FROM "user" WHERE email = ?1', FIRM_ONE_OWNER_EMAIL],
    [
      "SELECT COUNT(*) AS count FROM outbox WHERE payload LIKE '%' || ?1 || '%'",
      firmOneBody.owner.id,
    ],
    ["SELECT COUNT(*) AS count FROM verification WHERE value = ?1", firmOneBody.owner.id],
  ] as const) {
    const row = await env.DB_CONTROL.prepare(query).bind(binding).first<{ count: number }>();
    expect(row?.count, query).toBe(1);
  }
}
