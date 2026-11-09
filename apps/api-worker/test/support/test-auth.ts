import { env, SELF } from "cloudflare:test";
import { expect } from "vitest";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { generateFirmKeyBytes, importRootKek, wrapFirmKey } from "@magna-carta/encryption/keys";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { createAuth } from "../../src/auth.ts";
import { createLoggingEmailAdapter } from "../../src/email-port.ts";
import { firmDatabaseFor } from "../../src/firm-database/firm-database-proxy.ts";

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
// firm.database_identifier is vestigial (the per-firm database is addressed by firmId through its
// FirmDatabase Durable Object) and nullable, but seedFirm still writes a per-seed-unique placeholder
// so older suites that read the column keep observing a stable value.
export async function seedFirm(options?: {
  readonly name?: string;
  readonly databaseIdentifier?: string;
  readonly bucketName?: string;
}): Promise<SeededFirm> {
  const firmId = newIdentifier("firm");
  const databaseIdentifier = options?.databaseIdentifier ?? `d1-test-${firmId}`;
  // Every provisioned firm has a bucket, and every firm-scoped read resolves it through
  // src/files/firm-bucket.ts, which refuses a firm that has none. A fixture firm without one is a
  // shape production never has, so the default is a per-seed name — firm.bucket_name is UNIQUE, and
  // the resolver's name/handle reconciliation is inert here because the R2 S3 credential set is
  // deliberately incomplete under the test pool.
  const bucketName = options?.bucketName ?? `magna-carta-test-${firmId}`;
  await env.DB_CONTROL.prepare(
    "INSERT INTO firm (id, name, database_identifier, bucket_name, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  )
    // firm.name is UNIQUE (the provisioner's resume identity), so the default is per-seed unique.
    .bind(
      firmId,
      options?.name ?? `Test Firm ${firmId}`,
      databaseIdentifier,
      bucketName,
      new Date().toISOString(),
    )
    .run();
  return { firmId, databaseIdentifier };
}

// A control-plane firm row for a firm id a test minted itself. Queue consumers and Durable Objects
// resolve a firm's bucket from this row (src/files/firm-bucket.ts), so a test that drives one with a
// bare newIdentifier("firm") needs the firm to exist here even when it never signs anybody in.
export async function seedFirmRow(firmId: string, name?: string): Promise<void> {
  await env.DB_CONTROL.prepare(
    "INSERT OR IGNORE INTO firm (id, name, bucket_name, status, created_at) VALUES (?1, ?2, ?3, 'active', ?4)",
  )
    .bind(
      firmId,
      name ?? `Test Firm ${firmId}`,
      `magna-carta-test-${firmId}`,
      new Date().toISOString(),
    )
    .run();
}

// Mints + stores a wrapped firm key on a seeded firm — the provisioner's step 4c, done directly so
// a test firm seeded with seedFirm (which inserts no key) can exercise protected reads/writes. Uses
// the same test ROOT_KEK the worker reads from env, so the worker's firm-key provider unwraps it.
export async function seedFirmKey(firmId: FirmId): Promise<void> {
  const rootKek = await importRootKek(env.ROOT_KEK);
  const wrappedFirmKey = await wrapFirmKey(rootKek, generateFirmKeyBytes());
  await env.DB_CONTROL.prepare("UPDATE firm SET wrapped_firm_key = ?2 WHERE id = ?1")
    .bind(firmId, wrappedFirmKey)
    .run();
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

// A credentialed user who belongs to NO firm — the account-before-a-firm state the joining surface
// creates between making a person and settling which firm they are part of. Seeded through the same
// adapter as above, minus the firm: `user.firm_id` is nullable, and NULL is what every gate reads as
// "resolve no firm" rather than "resolve some firm".
export async function seedFirmlessCredentialedUser(
  email: string,
  options?: { readonly userName?: string },
): Promise<{ readonly userId: UserId }> {
  const auth = createTestAuth();
  const context = await auth.$context;
  const now = new Date();
  const user = await context.adapter.create<Record<string, unknown>, { id: string }>({
    model: "user",
    data: {
      name: options?.userName ?? "Firmless Test User",
      email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
      firmId: null,
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
  return { userId: assertIdentifier(user.id, "user") };
}

// Requests a password reset through a capturing email port and parses the reset token out of the
// emailed link — the activation path (Path A) every invitee travels. Returns the auth instance
// (resetPassword must run against the same control plane), the token, and the captured emails for
// callers that assert on delivery.
export async function captureResetToken(email: string): Promise<{
  auth: ReturnType<typeof createAuth>;
  token: string;
  sentEmails: Array<{ to: string; subject: string; text: string }>;
}> {
  const sentEmails: Array<{ to: string; subject: string; text: string }> = [];
  const auth = createAuth(env, (message) => {
    sentEmails.push(message);
    return Promise.resolve();
  });
  const requested = await auth.api.requestPasswordReset({ body: { email } });
  expect(requested.status).toBe(true);
  // The mail links straight at the reset screen with `?token=` (src/password-reset-link.ts), never
  // at the library's own /reset-password/{token} redirect hop, whose bare GET spends the token.
  const token = /[?&]token=([^&\s]+)/.exec(sentEmails[0]?.text ?? "")?.[1];
  if (token === undefined) throw new Error(`reset email carries no token: ${sentEmails[0]?.text}`);
  return { auth, token, sentEmails };
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

// `Response.json()` is declared `Promise<unknown>`, because a response body is whatever crossed the
// wire and the compiler has no way to know its shape. Reading a field off it is therefore an error,
// and the honest fix is for the test to SAY what it expects back — which is what the type argument
// here is. Naming the shape is the assertion: a route that stops returning `remainingMinor` fails to
// compile at the test that claims it, instead of comparing `undefined` at runtime.
//
// One home for the conversion, so the day this should validate at runtime rather than trust the
// declaration (a zod parse against the route's own response schema) is a change to this function
// and to nothing that calls it. Standard: docs/conventions/typescript.md.
export async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
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

// The five roles the per-firm baseline seeds into every firm. Named rather than handle-typed so a
// test reads as the seat it means; the rol_ handles are committed literals in the baseline
// migration and are looked up by name here.
export type SeededRoleName = "Admin" | "Attorney" | "Paralegal" | "Billing" | "Read-only";

// Mirrors the user into a firm database's member table and assigns one of the five seeded default
// roles. The firm's per-firm FirmDatabase Durable Object is addressed by firmId and self-migrates
// the per-firm lineage on first access, so the seeded role rows and their permission grants already
// exist.
//
// Reach for this rather than a direct_grant when a test needs a member who must NOT hold a
// capability: the permission seeds decide what each seat carries, so a denial asserted against a
// member of the wrong seat stops meaning anything the moment that seat is granted the key. A
// direct_grant still says "this one member, additionally" and is the right tool for that.
export async function mirrorMemberWithRole(
  userId: UserId,
  displayName: string,
  firmId: FirmId,
  roleName: SeededRoleName,
): Promise<void> {
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  const roleResult = await firmDatabase
    .prepare("SELECT id FROM role WHERE name = ?1")
    .bind(roleName)
    .all<{ id: string }>();
  const role = roleResult.results[0];
  if (role === undefined) {
    throw new Error(`seeded ${roleName} role missing from the firm database`);
  }
  await insertMemberStatement(firmDatabase, {
    userId,
    displayName,
    now: new Date().toISOString(),
  }).run();
  await insertRoleAssignmentStatement(firmDatabase, {
    id: newIdentifier("memberRole"),
    memberUserId: userId,
    roleId: assertIdentifier(role.id, "role"),
  }).run();
}

// The Admin case, which is what most suites want for their acting member.
export async function mirrorMemberWithOwnerRole(
  userId: UserId,
  displayName: string,
  firmId: FirmId,
): Promise<void> {
  await mirrorMemberWithRole(userId, displayName, firmId, "Admin");
}
