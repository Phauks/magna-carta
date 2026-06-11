import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import * as OTPAuth from "otpauth";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { createAuth } from "../src/auth.ts";
import { createLoggingEmailAdapter } from "../src/email-port.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

// Silent email adapter, as in auth.test.ts — nothing here asserts on outbound mail.
function createTestAuth() {
  return createAuth(
    env,
    createLoggingEmailAdapter(() => {}),
  );
}

// Better Auth's twoFactor plugin TOTP parameters (verified against the pinned 1.6.16 source,
// plugins/two-factor/totp): HMAC-SHA1, 6 digits, 30-second period; the otpauth:// URI carries the
// base32 encoding of the raw secret's ASCII bytes.
function createAuthenticator(secretBase32: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secretBase32),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });
}

// A six-digit code guaranteed invalid: Better Auth verifies against a ±1-period window, so any
// candidate outside the three codes valid right now fails deterministically (no flaky near-misses).
function invalidCodeFor(authenticator: OTPAuth.TOTP): string {
  const now = Date.now();
  const validWindow = new Set(
    [-30_000, 0, 30_000].map((offset) => authenticator.generate({ timestamp: now + offset })),
  );
  for (let candidate = 0; ; candidate += 1) {
    const code = String(candidate).padStart(6, "0");
    if (!validWindow.has(code)) return code;
  }
}

type ResponseCookie = { name: string; value: string; pair: string };

// One entry per Set-Cookie header: `pair` is the resendable `name=value` segment. Cookie names are
// matched by suffix because Better Auth prefixes them (`better-auth.` plus `__Secure-` over https).
// headers.getAll is the Workers-native multi-value accessor (set-cookie only); the standard
// getSetCookie() exists at runtime but @cloudflare/workers-types does not declare it.
function setCookies(response: Response): ResponseCookie[] {
  return response.headers.getAll("set-cookie").map((header) => {
    const pair = header.split(";", 1)[0] ?? "";
    const separator = pair.indexOf("=");
    return { name: pair.slice(0, separator), value: pair.slice(separator + 1), pair };
  });
}

function liveCookie(cookies: ResponseCookie[], nameSuffix: string): ResponseCookie | undefined {
  return cookies.find((cookie) => cookie.name.endsWith(nameSuffix) && cookie.value !== "");
}

async function postJson(path: string, body: unknown, cookie?: string): Promise<Response> {
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

const PASSWORD = "correct-horse-battery-staple";

// Public signup is disabled (invitation-only) and the invitation flow is a later task, so the
// credentialed user is seeded straight through the Better Auth adapter: a verified user plus a
// credential account whose password hash comes from the SAME hasher sign-in verifies against
// (context.password.hash — scrypt). requireEmailVerification is ON, hence emailVerified: true.
async function seedCredentialedUser(email: string): Promise<{ userId: string }> {
  const auth = createTestAuth();
  const context = await auth.$context;

  const firmId = newIdentifier("firm");
  await env.DB_CONTROL.prepare(
    "INSERT INTO firm (id, name, database_identifier, created_at) VALUES (?1, ?2, ?3, ?4)",
  )
    .bind(firmId, "TOTP Test Firm", `d1-totp-${firmId}`, new Date().toISOString())
    .run();

  const now = new Date();
  const user = await context.adapter.create<Record<string, unknown>, { id: string }>({
    model: "user",
    data: {
      name: "TOTP Test User",
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
  return { userId: user.id };
}

async function signIn(email: string): Promise<Response> {
  return postJson("/api/auth/sign-in/email", { email, password: PASSWORD });
}

// Runs the full enrollment for a signed-in user: enable (password-gated) returns the totpURI,
// verify-totp with a generated code activates 2FA. Returns the base32 secret for later logins.
async function enrollTotp(sessionCookie: string): Promise<{ secretBase32: string }> {
  const enableResponse = await postJson(
    "/api/auth/two-factor/enable",
    { password: PASSWORD },
    sessionCookie,
  );
  expect(enableResponse.status).toBe(200);
  const { totpURI } = (await enableResponse.json()) as { totpURI: string };
  const secretBase32 = /[?&]secret=([^&]+)/.exec(totpURI)?.[1];
  if (secretBase32 === undefined) throw new Error(`totpURI carries no secret: ${totpURI}`);

  const verifyResponse = await postJson(
    "/api/auth/two-factor/verify-totp",
    { code: createAuthenticator(secretBase32).generate() },
    sessionCookie,
  );
  expect(verifyResponse.status).toBe(200);
  return { secretBase32 };
}

describe("TOTP enrollment", () => {
  it("enables 2FA via enable + verify-totp, storing the secret encrypted at rest", async () => {
    const { userId } = await seedCredentialedUser("totp-enroll@example.com");

    const signInResponse = await signIn("totp-enroll@example.com");
    expect(signInResponse.status).toBe(200);
    const sessionCookie = liveCookie(setCookies(signInResponse), "session_token");
    expect(sessionCookie).toBeDefined();

    // Enable is password-gated and returns the provisioning URI plus backup codes; the user is
    // NOT 2FA-enabled yet — that requires proving possession of the authenticator via verify-totp.
    const enableResponse = await postJson(
      "/api/auth/two-factor/enable",
      { password: PASSWORD },
      sessionCookie?.pair,
    );
    expect(enableResponse.status).toBe(200);
    const enableBody = (await enableResponse.json()) as { totpURI: string; backupCodes: string[] };
    expect(enableBody.totpURI).toMatch(/^otpauth:\/\/totp\//);
    expect(enableBody.backupCodes.length).toBeGreaterThan(0);

    const secretBase32 = /[?&]secret=([^&]+)/.exec(enableBody.totpURI)?.[1];
    if (secretBase32 === undefined) throw new Error("totpURI carries no secret parameter");

    // Encrypted at rest (the plan's decided #8): the stored two_factor.secret is Better Auth's
    // AUTH_SECRET-keyed symmetric encryption of the raw secret — it must match neither the base32
    // form from the URI nor the raw (base32-decoded) secret, and an encryption envelope is longer
    // than both.
    const storedBeforeVerify = await env.DB_CONTROL.prepare(
      "SELECT secret, verified FROM two_factor WHERE user_id = ?1",
    )
      .bind(userId)
      .first<{ secret: string; verified: number }>();
    expect(storedBeforeVerify).not.toBeNull();
    const rawSecret = OTPAuth.Secret.fromBase32(secretBase32).latin1;
    expect(storedBeforeVerify?.secret).not.toBe(secretBase32);
    expect(storedBeforeVerify?.secret).not.toContain(rawSecret);
    expect(storedBeforeVerify?.secret.length).toBeGreaterThan(secretBase32.length);
    expect(storedBeforeVerify?.verified).toBe(0);

    // Proving possession: a generated code against the extracted secret completes activation.
    const verifyResponse = await postJson(
      "/api/auth/two-factor/verify-totp",
      { code: createAuthenticator(secretBase32).generate() },
      sessionCookie?.pair,
    );
    expect(verifyResponse.status).toBe(200);

    const userRow = await env.DB_CONTROL.prepare(
      'SELECT two_factor_enabled FROM "user" WHERE id = ?1',
    )
      .bind(userId)
      .first<{ two_factor_enabled: number }>();
    expect(userRow?.two_factor_enabled).toBe(1);
    const storedAfterVerify = await env.DB_CONTROL.prepare(
      "SELECT verified FROM two_factor WHERE user_id = ?1",
    )
      .bind(userId)
      .first<{ verified: number }>();
    expect(storedAfterVerify?.verified).toBe(1);
  });
});

describe("2FA login", () => {
  it("withholds the session at sign-in, rejects a wrong code, and completes login on a valid code", async () => {
    await seedCredentialedUser("totp-login@example.com");
    const enrollSignIn = await signIn("totp-login@example.com");
    const enrollSession = liveCookie(setCookies(enrollSignIn), "session_token");
    expect(enrollSession).toBeDefined();
    const { secretBase32 } = await enrollTotp(enrollSession?.pair ?? "");

    // Fresh sign-in for the now-2FA-enabled user: the plugin's after-hook deletes the credential
    // session, answers { twoFactorRedirect: true }, and parks the pending login behind a signed
    // two_factor challenge cookie. No live session cookie may appear.
    const challengeResponse = await signIn("totp-login@example.com");
    expect(challengeResponse.status).toBe(200);
    expect(await challengeResponse.json()).toMatchObject({
      twoFactorRedirect: true,
      twoFactorMethods: ["totp"],
    });
    const challengeCookies = setCookies(challengeResponse);
    expect(liveCookie(challengeCookies, "session_token")).toBeUndefined();
    const twoFactorCookie = liveCookie(challengeCookies, "two_factor");
    expect(twoFactorCookie).toBeDefined();

    // A wrong code is rejected and does not yield a session.
    const authenticator = createAuthenticator(secretBase32);
    const wrongResponse = await postJson(
      "/api/auth/two-factor/verify-totp",
      { code: invalidCodeFor(authenticator) },
      twoFactorCookie?.pair,
    );
    expect(wrongResponse.status).toBe(401);
    expect(liveCookie(setCookies(wrongResponse), "session_token")).toBeUndefined();

    // The correct code completes the login: a live session cookie appears and resolves to the user.
    const completeResponse = await postJson(
      "/api/auth/two-factor/verify-totp",
      { code: authenticator.generate() },
      twoFactorCookie?.pair,
    );
    expect(completeResponse.status).toBe(200);
    const completedSession = liveCookie(setCookies(completeResponse), "session_token");
    expect(completedSession).toBeDefined();

    const auth = createTestAuth();
    const resolved = await auth.api.getSession({
      headers: new Headers({ cookie: completedSession?.pair ?? "" }),
    });
    expect(resolved?.user.email).toBe("totp-login@example.com");
  });
});
