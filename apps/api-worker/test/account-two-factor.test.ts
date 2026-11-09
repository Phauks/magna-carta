/*
 * The two-factor facts the Account → Security page is built on, pinned against the real plugin.
 *
 * The page (apps/web/src/routes/account/security) and its panels make three assumptions about the
 * pinned Better Auth two-factor plugin that nothing else in this repository states. Each one is
 * load-bearing, and each would fail quietly if a library upgrade changed it:
 *
 * 1. The SESSION answers "is two-factor on?" the moment the act returns. The page reads
 *    `user.twoFactorEnabled` from get-session rather than asking separately, which is right only
 *    because verify and disable both re-issue the session cookies — the cached copy included —
 *    carrying the new value.
 * 2. A second `enable` on an account that is already on REPLACES the working secret and marks the
 *    new one verified, with no code asked for. That is why the page never offers Add while
 *    two-factor is on. If an upgrade makes the second enable wait for a code, this test fails and
 *    the page's guard can be reconsidered.
 * 3. Replacing the recovery codes RETIRES every earlier one, which is what makes it the remedy for a
 *    lost sheet as well as a spent one.
 *
 * And one fact about what the member SEES: the authenticator app files the account under
 * TOTP_ISSUER. Unset, the plugin names it after the library.
 */
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { TOTP_ISSUER } from "../src/auth.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  liveCookie,
  PASSWORD,
  postJson,
  readJson,
  seedCredentialedUser,
  setCookies,
  signIn,
} from "./support/test-auth.ts";
import { createAuthenticator, secretFromTotpUri } from "./support/totp.ts";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

/**
 * What a browser holds: every cookie the server has set and not since cleared. The cookie cache
 * (`session_data`) rides along with the session token exactly as it would in a browser, which is the
 * point — a test holding only the token would read the database and miss a stale cache.
 */
class CookieJar {
  private readonly cookies = new Map<string, string>();

  take(response: Response): Response {
    for (const cookie of setCookies(response)) {
      if (cookie.value === "") this.cookies.delete(cookie.name);
      else this.cookies.set(cookie.name, cookie.value);
    }
    return response;
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

async function signedInJar(email: string): Promise<CookieJar> {
  const jar = new CookieJar();
  expect(jar.take(await signIn(email)).status).toBe(200);
  return jar;
}

async function post(jar: CookieJar, path: string, body: unknown): Promise<Response> {
  return jar.take(await postJson(path, body, jar.header()));
}

async function twoFactorEnabledInSession(jar: CookieJar): Promise<boolean | undefined> {
  const response = jar.take(
    await SELF.fetch("https://example.com/api/auth/get-session", {
      headers: { cookie: jar.header() },
    }),
  );
  expect(response.status).toBe(200);
  const body = await readJson<{ user: { twoFactorEnabled?: boolean } } | null>(response);
  return body?.user.twoFactorEnabled;
}

/** Sets two-factor up the way the Add Two-Factor panel does, and returns what the panel was handed. */
async function setUp(jar: CookieJar): Promise<{ secretBase32: string; recoveryCodes: string[] }> {
  const enabled = await post(jar, "/api/auth/two-factor/enable", { password: PASSWORD });
  expect(enabled.status).toBe(200);
  const { totpURI, backupCodes } = await readJson<{ totpURI: string; backupCodes: string[] }>(
    enabled,
  );
  const secretBase32 = secretFromTotpUri(totpURI);
  const verified = await post(jar, "/api/auth/two-factor/verify-totp", {
    code: createAuthenticator(secretBase32).generate(),
  });
  expect(verified.status).toBe(200);
  return { secretBase32, recoveryCodes: backupCodes };
}

async function storedTwoFactor(
  userId: string,
): Promise<{ secret: string; verified: number } | null> {
  return env.DB_CONTROL.prepare("SELECT secret, verified FROM two_factor WHERE user_id = ?1")
    .bind(userId)
    .first<{ secret: string; verified: number }>();
}

describe("the two-factor facts the Security page relies on", () => {
  it("reports two-factor in the session the moment it is turned on, and again when it is turned off", async () => {
    await seedCredentialedUser("account-2fa-session@example.com");
    const jar = await signedInJar("account-2fa-session@example.com");
    expect(await twoFactorEnabledInSession(jar)).toBe(false);

    // The first step alone changes nothing about how the account signs in.
    const enabled = await post(jar, "/api/auth/two-factor/enable", { password: PASSWORD });
    expect(enabled.status).toBe(200);
    expect(await twoFactorEnabledInSession(jar)).toBe(false);

    const { totpURI } = await readJson<{ totpURI: string }>(enabled);
    // The name the member's authenticator app files the account under — the product's, never the
    // library's default. Both the label prefix and the issuer parameter carry it, and apps differ in
    // which one they display.
    const [label, query] = totpURI.replace(/^otpauth:\/\/totp\//, "").split("?");
    expect(decodeURIComponent(label ?? "")).toBe(`${TOTP_ISSUER}:account-2fa-session@example.com`);
    expect(new URLSearchParams(query).get("issuer")).toBe(TOTP_ISSUER);
    const verified = await post(jar, "/api/auth/two-factor/verify-totp", {
      code: createAuthenticator(secretFromTotpUri(totpURI)).generate(),
    });
    expect(verified.status).toBe(200);
    expect(await twoFactorEnabledInSession(jar)).toBe(true);

    const disabled = await post(jar, "/api/auth/two-factor/disable", { password: PASSWORD });
    expect(disabled.status).toBe(200);
    expect(await twoFactorEnabledInSession(jar)).toBe(false);
  });

  it("refuses turning it off without the right password, and leaves it on", async () => {
    await seedCredentialedUser("account-2fa-wrong-password@example.com");
    const jar = await signedInJar("account-2fa-wrong-password@example.com");
    await setUp(jar);

    const refused = await post(jar, "/api/auth/two-factor/disable", { password: "not-it" });
    expect(refused.status).toBe(400);
    expect(await readJson<{ code?: string }>(refused)).toMatchObject({ code: "INVALID_PASSWORD" });
    expect(await twoFactorEnabledInSession(jar)).toBe(true);
  });

  // THE PAGE STILL NEVER OFFERS ADD WHILE TWO-FACTOR IS ON. Better Auth used to answer a second
  // enable by replacing the working secret, verified, with no code asked; from 1.7 it refuses
  // instead. This pins the refusal, so a version that went back to replacing the secret is caught.
  it("refuses enable while a verified secret is in place, and leaves that secret alone", async () => {
    const { userId } = await seedCredentialedUser("account-2fa-re-enable@example.com");
    const jar = await signedInJar("account-2fa-re-enable@example.com");
    await setUp(jar);
    const before = await storedTwoFactor(userId);

    const again = await post(jar, "/api/auth/two-factor/enable", { password: PASSWORD });
    expect(again.status).toBe(400);
    expect(await readJson<{ code?: string }>(again)).toMatchObject({
      code: "TOTP_ALREADY_ENABLED",
    });
    const after = await storedTwoFactor(userId);

    expect(after?.secret).toBe(before?.secret);
    expect(after?.verified).toBe(1);
  });

  it("retires every earlier recovery code when new ones are made", async () => {
    await seedCredentialedUser("account-2fa-recovery@example.com");
    const jar = await signedInJar("account-2fa-recovery@example.com");
    const { recoveryCodes: firstSet } = await setUp(jar);

    const replaced = await post(jar, "/api/auth/two-factor/generate-backup-codes", {
      password: PASSWORD,
    });
    expect(replaced.status).toBe(200);
    const { backupCodes: secondSet } = await readJson<{ backupCodes: string[] }>(replaced);
    expect(secondSet).toHaveLength(firstSet.length);
    expect(secondSet).not.toContain(firstSet[0]);

    // A fresh sign-in is challenged; an old code no longer answers it and a new one does.
    const challenge = await signIn("account-2fa-recovery@example.com");
    expect(await readJson<{ twoFactorRedirect?: boolean }>(challenge)).toMatchObject({
      twoFactorRedirect: true,
    });
    const challengeCookie = liveCookie(setCookies(challenge), "two_factor")?.pair;
    expect(challengeCookie).toBeDefined();

    const oldCode = await postJson(
      "/api/auth/two-factor/verify-backup-code",
      { code: firstSet[0] },
      challengeCookie,
    );
    expect(oldCode.status).toBe(401);

    const newCode = await postJson(
      "/api/auth/two-factor/verify-backup-code",
      { code: secondSet[0] },
      challengeCookie,
    );
    expect(newCode.status).toBe(200);
    expect(liveCookie(setCookies(newCode), "session_token")).toBeDefined();
  });
});
