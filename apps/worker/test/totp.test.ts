import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import * as OTPAuth from "otpauth";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  createTestAuth,
  liveCookie,
  PASSWORD,
  postJson,
  seedCredentialedUser,
  setCookies,
  signIn,
  signInForSessionCookie,
} from "./support/test-auth.ts";
import { createAuthenticator, secretFromTotpUri } from "./support/totp.ts";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

// A six-digit code guaranteed invalid: Better Auth verifies against a ±1-period window around ITS
// clock, which can sit up to one period ahead of ours by the time the request lands — so any
// candidate outside the four codes for offsets -30s through +60s fails deterministically (no
// boundary-crossing flake).
function invalidCodeFor(authenticator: OTPAuth.TOTP): string {
  const now = Date.now();
  const validWindow = new Set(
    [-30_000, 0, 30_000, 60_000].map((offset) =>
      authenticator.generate({ timestamp: now + offset }),
    ),
  );
  for (let candidate = 0; ; candidate += 1) {
    const code = String(candidate).padStart(6, "0");
    if (!validWindow.has(code)) return code;
  }
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
  const secretBase32 = secretFromTotpUri(totpURI);

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
    const sessionCookie = await signInForSessionCookie("totp-enroll@example.com");

    // Enable is password-gated and returns the provisioning URI plus backup codes; the user is
    // NOT 2FA-enabled yet — that requires proving possession of the authenticator via verify-totp.
    const enableResponse = await postJson(
      "/api/auth/two-factor/enable",
      { password: PASSWORD },
      sessionCookie,
    );
    expect(enableResponse.status).toBe(200);
    const enableBody = (await enableResponse.json()) as { totpURI: string; backupCodes: string[] };
    expect(enableBody.totpURI).toMatch(/^otpauth:\/\/totp\//);
    expect(enableBody.backupCodes.length).toBeGreaterThan(0);

    const secretBase32 = secretFromTotpUri(enableBody.totpURI);

    // Encrypted at rest: the stored two_factor.secret is Better Auth's
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
      sessionCookie,
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
    const enrollSession = await signInForSessionCookie("totp-login@example.com");
    const { secretBase32 } = await enrollTotp(enrollSession);

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
