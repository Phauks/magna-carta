import { env, SELF } from "cloudflare:test";
import { expect } from "vitest";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { createAuth } from "../../src/auth.ts";
import { createLoggingEmailAdapter } from "../../src/email-port.ts";

// Shared helpers for the worker's auth-dependent integration suites (auth, TOTP, /v1/me) — one
// home so the auth construction, firm/user seeding, and cookie plumbing cannot drift apart.

// A silent email adapter: these tests never assert on outbound mail, and the dev logging
// adapter would spray verification links into the test output.
export function createTestAuth() {
  return createAuth(
    env,
    createLoggingEmailAdapter(() => {}),
  );
}

export const PASSWORD = "correct-horse-battery-staple";

export interface SeededFirm {
  readonly firmId: FirmId;
  readonly databaseIdentifier: string;
}

// user.firm_id is a NOT NULL foreign key — every seeded user needs its tenant firm row first.
// The database identifier defaults to a unique NON-resolvable placeholder; a test that needs the
// firm's per-firm database to resolve passes a dev-pool binding name (e.g. "DB_FIRM_POOL_1").
export async function seedFirm(options?: {
  readonly name?: string;
  readonly databaseIdentifier?: string;
}): Promise<SeededFirm> {
  const firmId = newIdentifier("firm");
  const databaseIdentifier = options?.databaseIdentifier ?? `d1-test-${firmId}`;
  await env.DB_CONTROL.prepare(
    "INSERT INTO firm (id, name, database_identifier, created_at) VALUES (?1, ?2, ?3, ?4)",
  )
    // firm.name is UNIQUE (the provisioner's resume identity), so the default is per-seed unique.
    .bind(
      firmId,
      options?.name ?? `Test Firm ${firmId}`,
      databaseIdentifier,
      new Date().toISOString(),
    )
    .run();
  return { firmId, databaseIdentifier };
}

export interface SeededCredentialedUser {
  readonly userId: UserId;
  readonly firmId: FirmId;
}

// Public signup is disabled (invitation-only) and the invitation flow is a later task, so the
// credentialed user is seeded straight through the Better Auth adapter: a verified user plus a
// credential account whose password hash comes from the SAME hasher sign-in verifies against
// (context.password.hash — scrypt). requireEmailVerification is ON, hence emailVerified: true.
export async function seedCredentialedUser(
  email: string,
  options?: {
    readonly userName?: string;
    readonly firmName?: string;
    readonly firmDatabaseIdentifier?: string;
    // Attach to an already-seeded firm instead of creating one — needed when several tests in a
    // file share one pool firm (firm.database_identifier is UNIQUE, so re-seeding would throw).
    readonly firmId?: FirmId;
  },
): Promise<SeededCredentialedUser> {
  const auth = createTestAuth();
  const context = await auth.$context;

  const firmId =
    options?.firmId ??
    (
      await seedFirm({
        name: options?.firmName,
        databaseIdentifier: options?.firmDatabaseIdentifier,
      })
    ).firmId;

  const now = new Date();
  const user = await context.adapter.create<Record<string, unknown>, { id: string }>({
    model: "user",
    data: {
      name: options?.userName ?? "Test User",
      email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
      firmId,
    },
  });
  await context.adapter.create({
    model: "account",
    data: {
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await context.password.hash(PASSWORD),
      createdAt: now,
      updatedAt: now,
    },
  });
  return { userId: assertIdentifier(user.id, "user"), firmId };
}

export type ResponseCookie = { name: string; value: string; pair: string };

// One entry per Set-Cookie header: `pair` is the resendable `name=value` segment. Cookie names are
// matched by suffix because Better Auth prefixes them (`better-auth.` plus `__Secure-` over https).
// headers.getAll is the Workers-native multi-value accessor (set-cookie only); the standard
// getSetCookie() exists at runtime but @cloudflare/workers-types does not declare it.
export function setCookies(response: Response): ResponseCookie[] {
  return response.headers.getAll("set-cookie").map((header) => {
    const pair = header.split(";", 1)[0] ?? "";
    const separator = pair.indexOf("=");
    return { name: pair.slice(0, separator), value: pair.slice(separator + 1), pair };
  });
}

export function liveCookie(
  cookies: ResponseCookie[],
  nameSuffix: string,
): ResponseCookie | undefined {
  return cookies.find((cookie) => cookie.name.endsWith(nameSuffix) && cookie.value !== "");
}

export async function postJson(path: string, body: unknown, cookie?: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Better Auth's CSRF middleware 403s any cookie-bearing POST without an Origin (or
      // Referer) header matching a trusted origin — a browser always sends one, so the test does.
      origin: "https://example.com",
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  });
}

export async function signIn(email: string): Promise<Response> {
  return postJson("/api/auth/sign-in/email", { email, password: PASSWORD });
}

// Signs the seeded user in and returns the resendable session cookie pair.
export async function signInForSessionCookie(email: string): Promise<string> {
  const signInResponse = await signIn(email);
  expect(signInResponse.status).toBe(200);
  const sessionCookie = liveCookie(setCookies(signInResponse), "session_token");
  expect(sessionCookie).toBeDefined();
  return sessionCookie?.pair ?? "";
}

// Mirrors the user into a firm database's member table and assigns the seeded Owner/Admin role
// (the rol_ handle is a committed literal in 0002_member-rbac.sql — read back by name). Defaults
// to DB_FIRM_POOL_1; cross-firm tests pass another migrated pool binding.
export async function mirrorMemberWithOwnerRole(
  userId: UserId,
  displayName: string,
  firmDatabase: D1Database = env.DB_FIRM_POOL_1,
): Promise<void> {
  const ownerRole = await firmDatabase
    .prepare("SELECT id FROM role WHERE name = 'Owner/Admin'")
    .first<{ id: string }>();
  if (ownerRole === null) throw new Error("seeded Owner/Admin role missing from the firm database");
  await insertMemberStatement(firmDatabase, {
    userId,
    displayName,
    now: new Date().toISOString(),
  }).run();
  await insertRoleAssignmentStatement(firmDatabase, {
    id: newIdentifier("memberRole"),
    memberUserId: userId,
    roleId: assertIdentifier(ownerRole.id, "role"),
  }).run();
}
