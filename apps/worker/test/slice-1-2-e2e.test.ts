import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { normalizeToDigits } from "@magna-carta/encryption/normalize";
import { incidentDescription } from "@magna-carta/data-access/protected-field-registry";
import {
  blindIndexValue,
  composeProtectedWrite,
  protectedField,
  readProtected,
  type ProtectedContext,
  type ProtectedReadContext,
} from "@magna-carta/data-access/protected-fields";
import { getSecret, putSecret } from "@magna-carta/data-access/secret-statements";
import { assertPermission, type Permission } from "@magna-carta/access-control/registry";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { firmKeyProviderForEnv } from "../src/firm-key-provider-wiring.ts";
import { shredFirmKey } from "../src/firm-key-shred.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  seedFirmKey,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// Two-firm end-to-end: the full protected journey across a tenant boundary. Two firms are
// provisioned (A in pool 1, B in pool 2), each with its OWN minted key, then the slice's protected
// surfaces are exercised together — the named-secret store (write + permission-gated audited read),
// the incident-intake route's encrypted-only write + audited read, a blind-index equality match
// without decrypt, and crypto-shred isolation (shredding firm A leaves firm B's corpus intact).
//
// firm.database_identifier is UNIQUE and there are two dev-pool bindings, so the two resolvable firms
// are seeded once here and shared; the harness isolates per-test writes within the file.
let firmAId: FirmId;
let firmBId: FirmId;

const NOW_CLOCK = { now: () => new Date().toISOString() };

function protectedContextFor(firmId: FirmId): ProtectedContext {
  return { firmId, firmKeyVersion: 1, firmKeyProvider: firmKeyProviderForEnv(env) };
}

function readContextFor(
  firmId: FirmId,
  firmDatabase: D1Database,
  permissions: Permission[],
  actorUserId: UserId,
): ProtectedReadContext {
  return {
    ...protectedContextFor(firmId),
    database: firmDatabase,
    effectivePermissions: new Set(permissions),
    actorUserId,
    clock: NOW_CLOCK,
  };
}

function secretWriteContextFor(firmId: FirmId, firmDatabase: D1Database) {
  return { ...protectedContextFor(firmId), database: firmDatabase, clock: NOW_CLOCK };
}

async function decryptAuditCount(database: D1Database, subjectId: string): Promise<number> {
  const row = await database
    .prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE event = 'protected.decrypt' AND subject_id = ?1",
    )
    .bind(subjectId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_2);
  firmAId = (await seedFirm({ name: "E2E Firm A", databaseIdentifier: "DB_FIRM_POOL_1" })).firmId;
  firmBId = (await seedFirm({ name: "E2E Firm B", databaseIdentifier: "DB_FIRM_POOL_2" })).firmId;
  await seedFirmKey(firmAId);
  await seedFirmKey(firmBId);
});

describe("slice 1·2 e2e — the named-secret store", () => {
  it("seals a secret in firm A, reads it back through the audited gate, and forbids a member without firm:manageSecrets", async () => {
    const { userId } = await seedCredentialedUser("secret-reader@example.com", {
      userName: "Secret Reader",
      firmId: firmAId,
    });
    await mirrorMemberWithOwnerRole(userId, "Secret Reader");

    const secretName = "stripe-webhook-signing-key";
    const secretValue = "whsec_super_secret_value_12345";
    await putSecret(secretWriteContextFor(firmAId, env.DB_FIRM_POOL_1), secretName, secretValue);

    // The value never lands in the clear: the stored row holds only ciphertext.
    const stored = await env.DB_FIRM_POOL_1.prepare(
      "SELECT ciphertext FROM firm_secret WHERE name = ?1",
    )
      .bind(secretName)
      .first<{ ciphertext: string }>();
    expect(stored?.ciphertext).toEqual(expect.any(String));
    expect(stored?.ciphertext).not.toContain(secretValue);

    // A member WITHOUT firm:manageSecrets is forbidden — no decrypt, no audit row.
    const forbiddenContext = readContextFor(firmAId, env.DB_FIRM_POOL_1, [], userId);
    await expect(getSecret(forbiddenContext, secretName)).rejects.toThrow(/firm:manageSecrets/);

    // WITH the permission: the plaintext comes back and exactly one protected.decrypt audit row was
    // committed (keyed on the firm_secret row id, not the name).
    const secretRowId = await env.DB_FIRM_POOL_1.prepare(
      "SELECT id FROM firm_secret WHERE name = ?1",
    )
      .bind(secretName)
      .first<{ id: string }>();
    expect(await decryptAuditCount(env.DB_FIRM_POOL_1, secretRowId?.id ?? "")).toBe(0);

    const allowedContext = readContextFor(
      firmAId,
      env.DB_FIRM_POOL_1,
      [assertPermission("firm:manageSecrets")],
      userId,
    );
    expect(await getSecret(allowedContext, secretName)).toBe(secretValue);

    const auditRow = await env.DB_FIRM_POOL_1.prepare(
      "SELECT actor_user_id, metadata FROM audit_log WHERE event = 'protected.decrypt' AND subject_id = ?1",
    )
      .bind(secretRowId?.id ?? "")
      .first<{ actor_user_id: string; metadata: string }>();
    expect(auditRow?.actor_user_id).toBe(userId);
    expect(JSON.parse(auditRow?.metadata ?? "{}")).toEqual({
      table: "firm_secret",
      field: "ciphertext",
    });
    expect(auditRow?.metadata).not.toContain(secretValue);
  });
});

describe("slice 1·2 e2e — incident description through the route, audited read", () => {
  it("records an encrypted-only incident in firm A and gates the decrypt on incidents:viewDescription", async () => {
    const { userId } = await seedCredentialedUser("incident-e2e@example.com", {
      userName: "Incident Reporter",
      firmId: firmAId,
    });
    await mirrorMemberWithOwnerRole(userId, "Incident Reporter");
    const cookie = await signInForSessionCookie("incident-e2e@example.com");

    const response = await SELF.fetch("https://example.com/api/v1/incidents", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.com", cookie },
      body: JSON.stringify({
        errorIds: [],
        breadcrumbs: [],
        description: "Client disclosed a sensitive matter detail.",
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

    // The decrypt needs incidents:viewDescription; with it, the plaintext returns after the audit.
    const allowed = readContextFor(
      firmAId,
      env.DB_FIRM_POOL_1,
      [assertPermission("incidents:viewDescription")],
      userId,
    );
    expect(
      await readProtected(
        allowed,
        incidentDescription,
        { description_ciphertext: row?.description_ciphertext },
        id,
      ),
    ).toBe("Client disclosed a sensitive matter detail.");
    expect(await decryptAuditCount(env.DB_FIRM_POOL_1, id)).toBe(1);
  });
});

describe("slice 1·2 e2e — blind-index equality without decrypt", () => {
  // A synthetic SSN-like protected field with an equality blind index over the firm pii key. It
  // declares a ciphertext + sibling index column purely to exercise the chokepoint's blind-index
  // path under the real key hierarchy; the match below needs no row and no decrypt.
  const syntheticSsn = protectedField({
    table: "client",
    column: "social_security_number_ciphertext",
    purpose: "pii",
    permission: assertPermission("incidents:viewDescription"),
    blindIndex: {
      name: "equality-32",
      normalize: normalizeToDigits,
      lengthBits: 32,
      column: "social_security_number_blind_index",
    },
  });

  it("yields an identical blind index for a formatted and an unformatted value", async () => {
    const context = protectedContextFor(firmAId);
    const formatted = await blindIndexValue(context, syntheticSsn, "123-45-6789");
    const unformatted = await blindIndexValue(context, syntheticSsn, "123456789");

    expect(formatted.startsWith("1:")).toBe(true);
    expect(formatted).toBe(unformatted);

    // Tenant isolation reaches the index too: firm B's distinct key derives a different subkey, so
    // the same plaintext indexes to a different value across firms.
    const firmBValue = await blindIndexValue(
      protectedContextFor(firmBId),
      syntheticSsn,
      "123456789",
    );
    expect(firmBValue).not.toBe(unformatted);
  });
});

describe("slice 1·2 e2e — crypto-shred isolation across two firms", () => {
  it("shredding firm A makes its secret AND its incident unreadable while firm B stays intact", async () => {
    const actor = newIdentifier("user");

    // A secret and an incident in EACH firm, sealed under that firm's own key.
    await putSecret(
      secretWriteContextFor(firmAId, env.DB_FIRM_POOL_1),
      "shred-probe",
      "firm-A-only",
    );
    await putSecret(
      secretWriteContextFor(firmBId, env.DB_FIRM_POOL_2),
      "shred-probe",
      "firm-B-only",
    );

    const seedIncident = async (database: D1Database, words: string): Promise<string> => {
      const incidentId = newIdentifier("incident");
      const sealed = await composeProtectedWrite(
        protectedContextFor(database === env.DB_FIRM_POOL_1 ? firmAId : firmBId),
        incidentDescription,
        incidentId,
        words,
      );
      await database
        .prepare(
          "INSERT INTO incident (id, error_ids, breadcrumbs, description, description_ciphertext, context, reported_by, created_at) " +
            "VALUES (?1, '[]', '[]', NULL, ?2, '{}', ?3, ?4)",
        )
        .bind(incidentId, sealed.ciphertextValue, actor, new Date().toISOString())
        .run();
      return incidentId;
    };
    const incidentAId = await seedIncident(env.DB_FIRM_POOL_1, "Firm A confidential note.");
    const incidentBId = await seedIncident(env.DB_FIRM_POOL_2, "Firm B confidential note.");

    const cipherOf = async (database: D1Database, incidentId: string): Promise<string> =>
      (
        await database
          .prepare("SELECT description_ciphertext FROM incident WHERE id = ?1")
          .bind(incidentId)
          .first<{ description_ciphertext: string }>()
      )?.description_ciphertext ?? "";
    const cipherB = await cipherOf(env.DB_FIRM_POOL_2, incidentBId);

    // Pre-shred: firm A reads both surfaces.
    const firmASecrets = readContextFor(
      firmAId,
      env.DB_FIRM_POOL_1,
      [assertPermission("firm:manageSecrets")],
      actor,
    );
    expect(await getSecret(firmASecrets, "shred-probe")).toBe("firm-A-only");

    // Shred firm A's key.
    await shredFirmKey(env, firmAId);
    const keyRow = await env.DB_CONTROL.prepare("SELECT wrapped_firm_key FROM firm WHERE id = ?1")
      .bind(firmAId)
      .first<{ wrapped_firm_key: string | null }>();
    expect(keyRow?.wrapped_firm_key).toBeNull();

    // Firm A's secret AND incident description are now both unreadable — the data key is gone.
    await expect(getSecret(firmASecrets, "shred-probe")).rejects.toThrow(
      /no firm data key available/,
    );
    const cipherA = await cipherOf(env.DB_FIRM_POOL_1, incidentAId);
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

    // Firm B is wholly unaffected — its own key still opens both its secret and its incident.
    const firmBSecrets = readContextFor(
      firmBId,
      env.DB_FIRM_POOL_2,
      [assertPermission("firm:manageSecrets")],
      actor,
    );
    expect(await getSecret(firmBSecrets, "shred-probe")).toBe("firm-B-only");
    expect(
      await readProtected(
        readContextFor(
          firmBId,
          env.DB_FIRM_POOL_2,
          [assertPermission("incidents:viewDescription")],
          actor,
        ),
        incidentDescription,
        { description_ciphertext: cipherB },
        incidentBId,
      ),
    ).toBe("Firm B confidential note.");
  });
});
