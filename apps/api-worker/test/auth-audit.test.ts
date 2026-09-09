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

// The audit wiring: login.success via databaseHooks.session.create.after, logout via
// databaseHooks.session.delete.after gated on the /sign-out endpoint,
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

  it("writes logout when the session is signed out, and expires both session cookies", async () => {
    const { userId } = await seedCredentialedUser("audit-logout@example.com");
    const sessionCookie = await signInForSessionCookie("audit-logout@example.com");

    const signOutResponse = await postJson("/api/auth/sign-out", {}, sessionCookie);
    expect(signOutResponse.status).toBe(200);

    expect(await auditEvents(userId)).toEqual(["login.success", "logout"]);

    // Both cookies go, not just the token: the session also rides a five-minute signed cache
    // (session.cookieCache in src/auth.ts), and a sign-out that left THAT one behind would leave a
    // believable session on the device it was signed out of. `liveCookie` finds only a cookie with
    // a value, so an expired one is absent from both of these.
    const cleared = setCookies(signOutResponse);
    expect(liveCookie(cleared, "session_token")).toBeUndefined();
    expect(liveCookie(cleared, "session_data")).toBeUndefined();
  });

  it("writes session.revoked once per device when the other sessions are signed out", async () => {
    const { userId } = await seedCredentialedUser("audit-revoke@example.com");
    // Three devices, of which the last is the one doing the revoking.
    await signInForSessionCookie("audit-revoke@example.com");
    await signInForSessionCookie("audit-revoke@example.com");
    const here = await signInForSessionCookie("audit-revoke@example.com");

    const revokeResponse = await postJson("/api/auth/revoke-other-sessions", {}, here);
    expect(revokeResponse.status).toBe(200);

    const events = await auditEvents(userId);
    // Two ended, one left standing — and not one of the three is recorded as a logout: nobody
    // signed out, they revoked somebody else's session.
    expect(events.filter((event) => event === "session.revoked")).toHaveLength(2);
    expect(events).not.toContain("logout");
  });

  // THE NESTED-PATH TRAP, pinned. better-call gives a nested endpoint call the OUTER endpoint's
  // path, so the getSession that /revoke-session's own session middleware performs arrives at the
  // delete hook wearing "/revoke-session". When that call finds the caller's session expired it
  // deletes it — and an endpoint-only gate filed session.revoked for a request that then 401s
  // having revoked nothing. The hook also asks whether the row that went is the row the request
  // NAMED, which is what makes this pass.
  it("files nothing when a revoke request only sweeps the caller's own expired session", async () => {
    const { userId } = await seedCredentialedUser("audit-sweep@example.com");
    const cookie = await signInForSessionCookie("audit-sweep@example.com");
    await env.DB_CONTROL.prepare("UPDATE session SET expires_at = ?2 WHERE user_id = ?1")
      .bind(userId, Date.now() - 60_000)
      .run();

    const response = await postJson("/api/auth/revoke-session", { token: "ses_whatever" }, cookie);

    // Nothing was revoked — the request could not even authenticate — so nothing is recorded.
    expect(response.status).toBe(401);
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

    // THE CANARY FOR THE ENDPOINT GATE ON THE logout HOOK. Enabling and disabling a factor each
    // rotate the session, which DELETES the old row through the very hook logout is written from —
    // so an ungated hook would file two departures for somebody who never left. Nobody signed out
    // in this test, and the trail has to say so.
    expect(eventsAfterDisable).not.toContain("logout");
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
