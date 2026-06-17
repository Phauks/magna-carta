import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { incidentDescription } from "@magna-carta/data-access/protected-field-registry";
import {
  readProtected,
  type ProtectedReadContext,
} from "@magna-carta/data-access/protected-fields";
import { assertPermission, type Permission } from "@magna-carta/access-control/registry";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import {
  runIncidentDescriptionEncryptBackfill,
  runProtectedKeyMintBackfill,
  listReachableActiveFirms,
} from "../src/scheduled.ts";
import { shredFirmKey } from "../src/firm-key-shred.ts";
import { firmKeyProviderForEnv } from "../src/firm-key-provider-wiring.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  seedFirmKey,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// Slice 1·2 worker wiring, exercised end to end against Miniflare: the two backfill sweeps
// (idempotent), the incident-intake switch to ciphertext, an audited protected read, and
// crypto-shred (one firm's protected corpus becomes unreadable while a second firm is intact).
//
// firm.database_identifier is UNIQUE and there are two dev-pool bindings, so the resolvable firms
// (A in pool 1, B in pool 2) are seeded ONCE here and shared — the harness isolates per-test writes
// within the file. The key-mint test uses its own NON-resolvable placeholder firm (mint is
// control-plane only, no per-firm database needed).
let firmAId: FirmId;
let firmBId: FirmId;

function backfillTelemetry() {
  const counts: Array<{ name: string; value: number }> = [];
  const logger = {
    log: () => {},
    count: (name: string, _tags: Record<string, string>, value = 1) => counts.push({ name, value }),
  } as unknown as Parameters<typeof runProtectedKeyMintBackfill>[1];
  return { logger, correlationId: "test-correlation", counts };
}

function readContextFor(
  firmId: FirmId,
  firmDatabase: D1Database,
  permissions: Permission[],
  actorUserId: UserId,
): ProtectedReadContext {
  return {
    firmId,
    firmKeyVersion: 1,
    firmKeyProvider: firmKeyProviderForEnv(env),
    database: firmDatabase,
    effectivePermissions: new Set(permissions),
    actorUserId,
    clock: { now: () => new Date().toISOString() },
  };
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_2);
  firmAId = (await seedFirm({ name: "Protected Firm A", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  firmBId = (await seedFirm({ name: "Protected Firm B", databaseIdentifier: "DB_FIRM_POOL_2" }))
    .firmId;
  await seedFirmKey(firmAId);
  await seedFirmKey(firmBId);
});

describe("slice 1·2 — firm-key mint backfill", () => {
  it("mints exactly once for a keyless active firm; a re-run mints nothing", async () => {
    // A keyless active firm with a NON-resolvable database identifier (the mint is control-plane
    // only — it never touches the firm database, so no pool binding is consumed).
    const { firmId } = await seedFirm({ name: "Key Mint Sweep Firm" });
    const before = await env.DB_CONTROL.prepare("SELECT wrapped_firm_key FROM firm WHERE id = ?1")
      .bind(firmId)
      .first<{ wrapped_firm_key: string | null }>();
    expect(before?.wrapped_firm_key).toBeNull();

    const t1 = backfillTelemetry();
    const first = await runProtectedKeyMintBackfill(env, t1.logger, t1.correlationId);
    expect(first.rowsAffected).toBeGreaterThanOrEqual(1);
    const minted = await env.DB_CONTROL.prepare("SELECT wrapped_firm_key FROM firm WHERE id = ?1")
      .bind(firmId)
      .first<{ wrapped_firm_key: string | null }>();
    expect(minted?.wrapped_firm_key).toEqual(expect.any(String));

    // Re-run: the firm now has a key, so the WHERE excludes it — nothing is re-minted and the key
    // is byte-identical.
    const t2 = backfillTelemetry();
    await runProtectedKeyMintBackfill(env, t2.logger, t2.correlationId);
    const afterRerun = await env.DB_CONTROL.prepare(
      "SELECT wrapped_firm_key FROM firm WHERE id = ?1",
    )
      .bind(firmId)
      .first<{ wrapped_firm_key: string | null }>();
    expect(afterRerun?.wrapped_firm_key).toBe(minted?.wrapped_firm_key);
  });
});

describe("slice 1·2 — incident-description encrypt backfill", () => {
  it("seals a pre-slice plaintext incident exactly once; a re-run no-ops", async () => {
    // A pre-slice incident in firm A: plaintext description, no ciphertext — the shape the sweep
    // encrypts.
    const incidentId = newIdentifier("incident");
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO incident (id, error_ids, breadcrumbs, description, context, reported_by, created_at) " +
        "VALUES (?1, '[]', '[]', ?2, '{}', ?3, ?4)",
    )
      .bind(incidentId, "Legacy plaintext words.", newIdentifier("user"), new Date().toISOString())
      .run();

    const firms = (await listReachableActiveFirms(env)).filter((firm) => firm.firmId === firmAId);
    const t1 = backfillTelemetry();
    const first = await runIncidentDescriptionEncryptBackfill(
      env,
      firms,
      t1.logger,
      t1.correlationId,
    );
    expect(first.rowsAffected).toBe(1);

    const sealed = await env.DB_FIRM_POOL_1.prepare(
      "SELECT description, description_ciphertext FROM incident WHERE id = ?1",
    )
      .bind(incidentId)
      .first<{ description: string | null; description_ciphertext: string | null }>();
    // The backfill fills ciphertext and LEAVES the plaintext in place (the contract drop is a later
    // slice); the ciphertext never contains the plaintext words.
    expect(sealed?.description).toBe("Legacy plaintext words.");
    expect(sealed?.description_ciphertext).toEqual(expect.any(String));
    expect(sealed?.description_ciphertext).not.toContain("Legacy plaintext words.");

    // Re-run: the row now has a ciphertext, so the WHERE excludes it — no rows affected, the
    // ciphertext is byte-identical (no re-encryption).
    const t2 = backfillTelemetry();
    const second = await runIncidentDescriptionEncryptBackfill(
      env,
      firms,
      t2.logger,
      t2.correlationId,
    );
    expect(second.rowsAffected).toBe(0);
    const afterRerun = await env.DB_FIRM_POOL_1.prepare(
      "SELECT description_ciphertext FROM incident WHERE id = ?1",
    )
      .bind(incidentId)
      .first<{ description_ciphertext: string | null }>();
    expect(afterRerun?.description_ciphertext).toBe(sealed?.description_ciphertext);
  });
});

describe("slice 1·2 — incident intake writes ciphertext, readProtected gates + audits", () => {
  it("a new incident is encrypted-only; readProtected needs incidents:viewDescription and audits", async () => {
    const { userId } = await seedCredentialedUser("incident-read@example.com", {
      userName: "Reader",
      firmId: firmAId,
    });
    await mirrorMemberWithOwnerRole(userId, "Reader");
    const cookie = await signInForSessionCookie("incident-read@example.com");

    const response = await SELF.fetch("https://example.com/api/v1/incidents", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        errorIds: [],
        breadcrumbs: [],
        description: "Sensitive incident wording.",
        context: { route: "/x", appVersion: "0.0.0", clientAt: "2026-06-16T00:00:00.000Z" },
      }),
    });
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };

    const row = await env.DB_FIRM_POOL_1.prepare(
      "SELECT description, description_ciphertext FROM incident WHERE id = ?1",
    )
      .bind(id)
      .first<{ description: string | null; description_ciphertext: string | null }>();
    expect(row?.description).toBeNull();
    expect(row?.description_ciphertext).toEqual(expect.any(String));

    // Without the permission: ProtectedReadForbiddenError, no decrypt, no audit row.
    const forbidden = readContextFor(firmAId, env.DB_FIRM_POOL_1, [], userId);
    await expect(
      readProtected(
        forbidden,
        incidentDescription,
        { description_ciphertext: row?.description_ciphertext },
        id,
      ),
    ).rejects.toThrow(/incidents:viewDescription/);

    const auditAfterForbidden = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE event = 'protected.decrypt' AND subject_id = ?1",
    )
      .bind(id)
      .first<{ count: number }>();
    expect(auditAfterForbidden?.count).toBe(0);

    // With the permission: the plaintext comes back and a protected.decrypt audit row was committed
    // first (ids + field identity only — never the value).
    const allowed = readContextFor(
      firmAId,
      env.DB_FIRM_POOL_1,
      [assertPermission("incidents:viewDescription")],
      userId,
    );
    const plaintext = await readProtected(
      allowed,
      incidentDescription,
      { description_ciphertext: row?.description_ciphertext },
      id,
    );
    expect(plaintext).toBe("Sensitive incident wording.");

    const auditRow = await env.DB_FIRM_POOL_1.prepare(
      "SELECT actor_user_id, subject_id, metadata FROM audit_log WHERE event = 'protected.decrypt' AND subject_id = ?1",
    )
      .bind(id)
      .first<{ actor_user_id: string; subject_id: string; metadata: string }>();
    expect(auditRow?.actor_user_id).toBe(userId);
    expect(auditRow?.subject_id).toBe(id);
    expect(JSON.parse(auditRow?.metadata ?? "{}")).toEqual({
      table: "incident",
      field: "description_ciphertext",
    });
    expect(auditRow?.metadata).not.toContain("Sensitive incident wording.");
  });
});

describe("slice 1·2 — crypto-shred", () => {
  it("makes firm A's incident description unreadable, writes the shred audit, leaves firm B intact", async () => {
    // One encrypted incident in each firm (plaintext row → backfill seals it).
    const seedIncident = async (database: D1Database, words: string): Promise<string> => {
      const incidentId = newIdentifier("incident");
      await database
        .prepare(
          "INSERT INTO incident (id, error_ids, breadcrumbs, description, context, reported_by, created_at) " +
            "VALUES (?1, '[]', '[]', ?2, '{}', ?3, ?4)",
        )
        .bind(incidentId, words, newIdentifier("user"), new Date().toISOString())
        .run();
      return incidentId;
    };
    const incidentAId = await seedIncident(env.DB_FIRM_POOL_1, "Firm A secret wording.");
    const incidentBId = await seedIncident(env.DB_FIRM_POOL_2, "Firm B secret wording.");

    const allFirms = await listReachableActiveFirms(env);
    const t = backfillTelemetry();
    await runIncidentDescriptionEncryptBackfill(
      env,
      allFirms.filter((f) => f.firmId === firmAId || f.firmId === firmBId),
      t.logger,
      t.correlationId,
    );

    const ciphertextOf = async (database: D1Database, incidentId: string): Promise<string> => {
      const r = await database
        .prepare("SELECT description_ciphertext FROM incident WHERE id = ?1")
        .bind(incidentId)
        .first<{ description_ciphertext: string }>();
      return r?.description_ciphertext ?? "";
    };
    const cipherA = await ciphertextOf(env.DB_FIRM_POOL_1, incidentAId);
    const cipherB = await ciphertextOf(env.DB_FIRM_POOL_2, incidentBId);

    const actor = newIdentifier("user");
    // Pre-shred: firm A reads fine. (A fresh provider per read avoids reusing a cached pre-shred
    // handle from the per-env provider the shred path invalidates.)
    const preShred = await readProtected(
      readContextFor(
        firmAId,
        env.DB_FIRM_POOL_1,
        [assertPermission("incidents:viewDescription")],
        actor,
      ),
      incidentDescription,
      { description_ciphertext: cipherA },
      incidentAId,
    );
    expect(preShred).toBe("Firm A secret wording.");

    // Shred firm A's key (nulls the wrapped key, writes the audit, invalidates the per-env cache).
    await shredFirmKey(env, firmAId);

    const keyRow = await env.DB_CONTROL.prepare("SELECT wrapped_firm_key FROM firm WHERE id = ?1")
      .bind(firmAId)
      .first<{ wrapped_firm_key: string | null }>();
    expect(keyRow?.wrapped_firm_key).toBeNull();
    const shredAudit = await env.DB_CONTROL.prepare(
      "SELECT COUNT(*) AS count FROM auth_audit WHERE event = 'firm.key_shredded' AND metadata LIKE '%' || ?1 || '%'",
    )
      .bind(firmAId)
      .first<{ count: number }>();
    expect(shredAudit?.count).toBe(1);

    // Idempotent: a second shred (a retry or queue redelivery) writes no duplicate audit row — the
    // key is already null, so there is nothing to destroy and no new shred event to record.
    await shredFirmKey(env, firmAId);
    const reShredAudit = await env.DB_CONTROL.prepare(
      "SELECT COUNT(*) AS count FROM auth_audit WHERE event = 'firm.key_shredded' AND metadata LIKE '%' || ?1 || '%'",
    )
      .bind(firmAId)
      .first<{ count: number }>();
    expect(reShredAudit?.count).toBe(1);

    // Firm A's protected read now fails closed (the cache was invalidated, the wrapped key is gone).
    await expect(
      readProtected(
        readContextFor(
          firmAId,
          env.DB_FIRM_POOL_1,
          [assertPermission("incidents:viewDescription")],
          actor,
        ),
        incidentDescription,
        { description_ciphertext: cipherA },
        incidentAId,
      ),
    ).rejects.toThrow(/no firm data key available/);

    // Firm B is unaffected — its own key still decrypts its incident.
    const firmBPlaintext = await readProtected(
      readContextFor(
        firmBId,
        env.DB_FIRM_POOL_2,
        [assertPermission("incidents:viewDescription")],
        actor,
      ),
      incidentDescription,
      { description_ciphertext: cipherB },
      incidentBId,
    );
    expect(firmBPlaintext).toBe("Firm B secret wording.");
  });
});
