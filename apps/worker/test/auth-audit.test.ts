import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  captureResetToken,
  liveCookie,
  PASSWORD,
  postJson,
  seedCredentialedUser,
  setCookies,
  signInForSessionCookie,
} from "./support/test-auth.ts";
import { createAuthenticator, secretFromTotpUri } from "./support/totp.ts";

// The decided #10 audit wiring (Task 13): login.success via databaseHooks.session.create.after,
// two_factor.enabled/disabled via the paired user.update hooks (1.6.16 exposes no dedicated
// twoFactor hook — the flip rides internalAdapter.updateUser), password.reset via the
// emailAndPassword.onPasswordReset server hook. All writes land in control-plane auth_audit
// with ids-only metadata.

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

async function auditEvents(userId: string): Promise<string[]> {
  const rows = await env.DB_CONTROL.prepare(
    "SELECT event FROM auth_audit WHERE user_id = ?1 ORDER BY created_at",
  )
    .bind(userId)
    .all<{ event: string }>();
  return rows.results.map((row) => row.event);
}

describe("auth audit hooks", () => {
  it("writes login.success when a session is created at sign-in", async () => {
    const { userId } = await seedCredentialedUser("audit-login@example.com");
    await signInForSessionCookie("audit-login@example.com");
    expect(await auditEvents(userId)).toEqual(["login.success"]);
  });

  it("writes two_factor.enabled exactly at the verify-totp transition, and two_factor.disabled on disable", async () => {
    const { userId } = await seedCredentialedUser("audit-totp@example.com");
    const sessionCookie = await signInForSessionCookie("audit-totp@example.com");

    // Enable alone does NOT flip twoFactorEnabled (verification is required) — no audit event yet.
    const enableResponse = await postJson(
      "/api/auth/two-factor/enable",
      { password: PASSWORD },
      sessionCookie,
    );
    expect(enableResponse.status).toBe(200);
    expect(await auditEvents(userId)).toEqual(["login.success"]);

    const { totpURI } = (await enableResponse.json()) as { totpURI: string };
    const authenticator = createAuthenticator(secretFromTotpUri(totpURI));

    // verify-totp performs the transition (twoFactorEnabled false → true) and rotates the
    // session — so the audit trail gains two_factor.enabled plus the rotation's login.success.
    const verifyResponse = await postJson(
      "/api/auth/two-factor/verify-totp",
      { code: authenticator.generate() },
      sessionCookie,
    );
    expect(verifyResponse.status).toBe(200);
    const eventsAfterEnable = await auditEvents(userId);
    expect(eventsAfterEnable.filter((event) => event === "two_factor.enabled")).toHaveLength(1);

    // Disable flips the transition the other way (the rotated session cookie authenticates it).
    const rotatedCookie = liveCookie(setCookies(verifyResponse), "session_token");
    const disableResponse = await postJson(
      "/api/auth/two-factor/disable",
      { password: PASSWORD },
      rotatedCookie?.pair ?? sessionCookie,
    );
    expect(disableResponse.status).toBe(200);
    const eventsAfterDisable = await auditEvents(userId);
    expect(eventsAfterDisable.filter((event) => event === "two_factor.disabled")).toHaveLength(1);
  });

  it("writes password.reset when a reset completes (alongside the activation email-verified flip)", async () => {
    const { userId } = await seedCredentialedUser("audit-reset@example.com");

    // Capturing email port — the reset link must be parsed for its token.
    const { auth, token } = await captureResetToken("audit-reset@example.com");

    const reset = await auth.api.resetPassword({
      body: { newPassword: "a-sufficiently-long-password", token },
    });
    expect(reset.status).toBe(true);

    expect(await auditEvents(userId)).toContain("password.reset");
  });
});
