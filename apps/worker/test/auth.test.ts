import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { createAuth } from "../src/auth.ts";
import { createLoggingEmailAdapter } from "../src/email-port.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

// A silent email adapter: these tests never assert on outbound mail, and the dev logging
// adapter would spray verification links into the test output.
function createTestAuth() {
  return createAuth(
    env,
    createLoggingEmailAdapter(() => {}),
  );
}

describe("better-auth mount", () => {
  it("serves the Better Auth routes under /api/auth/*", async () => {
    const response = await SELF.fetch("https://example.com/api/auth/ok");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it("rejects public signup — membership is invitation-only", async () => {
    const response = await SELF.fetch("https://example.com/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Mallory",
        email: "mallory@example.com",
        password: "correct-horse-battery-staple",
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" });
    const row = await env.DB_CONTROL.prepare('SELECT count(*) AS count FROM "user"').first<{
      count: number;
    }>();
    expect(row?.count).toBe(0);
  });

  it("resolves getSession to null when no session cookie is presented", async () => {
    const auth = createTestAuth();
    const session = await auth.api.getSession({ headers: new Headers() });
    expect(session).toBeNull();
  });
});

// The decided-#2 tripwire for better-auth version bumps: write + read every Better Auth-owned
// table through the REAL adapter against a Miniflare-migrated control-plane D1. A column Better
// Auth expects that the committed migrations do not provide (or vice versa) throws HERE, not in
// production. Created ids double as the ADR-0062 handle pin (generateId wiring).
describe("schema-sync fitness: better-auth against the committed control-plane migrations", () => {
  type CreatedRow = { id: string };

  it("round-trips all five Better Auth models through the drizzle adapter", async () => {
    const auth = createTestAuth();
    const context = await auth.$context;
    const adapter = context.adapter;

    // user.firm_id is a NOT NULL foreign key — the tenant firm row must exist first.
    const firmId = newIdentifier("firm");
    await env.DB_CONTROL.prepare(
      "INSERT INTO firm (id, name, database_identifier, created_at) VALUES (?1, ?2, ?3, ?4)",
    )
      .bind(firmId, "Fitness Test Firm", "d1-fitness-test", new Date().toISOString())
      .run();

    const now = new Date();
    const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);

    const user = await adapter.create<Record<string, unknown>, CreatedRow>({
      model: "user",
      data: {
        name: "Fitness User",
        email: "fitness@example.com",
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
        firmId,
      },
    });
    expect(user.id).toMatch(/^usr_/);

    const session = await adapter.create<Record<string, unknown>, CreatedRow>({
      model: "session",
      data: {
        token: "fitness-session-token",
        userId: user.id,
        expiresAt: inOneHour,
        createdAt: now,
        updatedAt: now,
      },
    });
    expect(session.id).toMatch(/^ses_/);

    const account = await adapter.create<Record<string, unknown>, CreatedRow>({
      model: "account",
      data: {
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: "scrypt-hash-placeholder",
        createdAt: now,
        updatedAt: now,
      },
    });
    expect(account.id).toMatch(/^acc_/);

    const verification = await adapter.create<Record<string, unknown>, CreatedRow>({
      model: "verification",
      data: {
        identifier: "email-verification:fitness@example.com",
        value: "fitness-verification-value",
        expiresAt: inOneHour,
        createdAt: now,
        updatedAt: now,
      },
    });
    expect(verification.id).toMatch(/^ver_/);

    const twoFactorRow = await adapter.create<Record<string, unknown>, CreatedRow>({
      model: "twoFactor",
      data: {
        secret: "encrypted-totp-secret-placeholder",
        backupCodes: "encrypted-backup-codes-placeholder",
        userId: user.id,
        verified: false,
      },
    });
    expect(twoFactorRow.id).toMatch(/^twf_/);

    // Read side: the adapter's field transforms must line up with the stored columns too —
    // read every one of the five models back, querying by a non-id field where one exists so
    // the where-clause transforms are exercised as well.
    const foundUser = await adapter.findOne<{ id: string; email: string; firmId: string }>({
      model: "user",
      where: [{ field: "id", value: user.id }],
    });
    expect(foundUser).toMatchObject({ email: "fitness@example.com", firmId });

    const foundSession = await adapter.findOne<{ id: string; token: string }>({
      model: "session",
      where: [{ field: "token", value: "fitness-session-token" }],
    });
    expect(foundSession?.id).toBe(session.id);

    const foundAccount = await adapter.findOne<{ id: string; providerId: string }>({
      model: "account",
      where: [{ field: "userId", value: user.id }],
    });
    expect(foundAccount).toMatchObject({ id: account.id, providerId: "credential" });

    const foundVerification = await adapter.findOne<{ id: string; value: string }>({
      model: "verification",
      where: [{ field: "identifier", value: "email-verification:fitness@example.com" }],
    });
    expect(foundVerification).toMatchObject({
      id: verification.id,
      value: "fitness-verification-value",
    });

    const foundTwoFactor = await adapter.findOne<{ id: string; secret: string }>({
      model: "twoFactor",
      where: [{ field: "userId", value: user.id }],
    });
    expect(foundTwoFactor).toMatchObject({
      id: twoFactorRow.id,
      secret: "encrypted-totp-secret-placeholder",
    });
  });
});
