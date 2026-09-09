import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  postJson,
  readJson,
  seedCredentialedUser,
  setCookies,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The routes behind the signed-in-devices screen (apps/web/src/routes/account/sessions): listing
// this account's live sessions, and ending one of them from another device. Better Auth serves all
// three; what is pinned here is that they are reachable and scoped the way that screen assumes —
// including the freshness dial, which the library defaults to a value that would 403 the listing
// for exactly the long-lived session the screen exists to manage (src/auth.ts, session.freshAge).

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

interface ListedSession {
  readonly token: string;
  readonly userAgent: string | null;
}

async function listSessions(cookie: string): Promise<ListedSession[]> {
  const response = await SELF.fetch("https://example.com/api/auth/list-sessions", {
    headers: { cookie, origin: "https://example.com" },
  });
  expect(response.status).toBe(200);
  return readJson<ListedSession[]>(response);
}

describe("signed-in devices", () => {
  it("lists every live session of the account, and nobody else's", async () => {
    await seedCredentialedUser("sessions-list@example.com");
    await seedCredentialedUser("sessions-other@example.com");
    await signInForSessionCookie("sessions-list@example.com");
    const here = await signInForSessionCookie("sessions-list@example.com");
    const strangerCookie = await signInForSessionCookie("sessions-other@example.com");

    const listed = await listSessions(here);
    expect(listed).toHaveLength(2);

    // The other account's session is live at the same moment and is not in this answer.
    const strangerListed = await listSessions(strangerCookie);
    expect(strangerListed).toHaveLength(1);
    const strangerTokens = new Set(strangerListed.map((session) => session.token));
    expect(listed.some((session) => strangerTokens.has(session.token))).toBe(false);
  });

  // THE REGRESSION THIS FILE EXISTS FOR. Better Auth gates /list-sessions on freshSessionMiddleware,
  // whose default freshAge (one day) would answer 403 SESSION_NOT_FRESH for any session older than
  // that — the "keep me signed in" session somebody would be reading this screen ON. src/auth.ts
  // sets freshAge to 0; a version bump that reinstates the default breaks the screen and not one
  // other test, so the assertion is made directly against a session aged past the old default.
  it("still lists sessions for an account signed in longer than the library's default freshness", async () => {
    const { userId } = await seedCredentialedUser("sessions-stale@example.com");
    const cookie = await signInForSessionCookie("sessions-stale@example.com");

    // Age the session row two days. created_at is epoch milliseconds on the Better Auth tables.
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    await env.DB_CONTROL.prepare("UPDATE session SET created_at = ?2 WHERE user_id = ?1")
      .bind(userId, twoDaysAgo)
      .run();

    expect(await listSessions(cookie)).toHaveLength(1);
  });

  it("ends one named session and leaves the rest, including the one that asked", async () => {
    await seedCredentialedUser("sessions-revoke-one@example.com");
    const there = await signInForSessionCookie("sessions-revoke-one@example.com");
    const here = await signInForSessionCookie("sessions-revoke-one@example.com");

    // The session cookie carries its own token (signed), so the OTHER device's row is the one
    // whose token that cookie contains.
    const listed = await listSessions(here);
    const target = listed.find((session) => there.includes(session.token));
    expect(target).toBeDefined();

    const revoked = await postJson("/api/auth/revoke-session", { token: target?.token }, here);
    expect(revoked.status).toBe(200);

    // The revoking device is still signed in; the revoked one is gone from the list.
    const remaining = await listSessions(here);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.token).not.toBe(target?.token);
  });

  it("refuses to end another account's session, without saying that is what happened", async () => {
    await seedCredentialedUser("sessions-mine@example.com");
    await seedCredentialedUser("sessions-theirs@example.com");
    const mine = await signInForSessionCookie("sessions-mine@example.com");
    const theirs = await signInForSessionCookie("sessions-theirs@example.com");
    const theirToken = (await listSessions(theirs))[0]?.token;

    // The answer is the same 200 a real revocation gets — a different answer would turn this route
    // into an oracle for whether a token is live.
    const response = await postJson("/api/auth/revoke-session", { token: theirToken }, mine);
    expect(response.status).toBe(200);

    // And their session is untouched.
    expect(await listSessions(theirs)).toHaveLength(1);
  });

  it("signs every other device out and keeps this one", async () => {
    await seedCredentialedUser("sessions-revoke-others@example.com");
    await signInForSessionCookie("sessions-revoke-others@example.com");
    await signInForSessionCookie("sessions-revoke-others@example.com");
    const here = await signInForSessionCookie("sessions-revoke-others@example.com");
    expect(await listSessions(here)).toHaveLength(3);

    const response = await postJson("/api/auth/revoke-other-sessions", {}, here);
    expect(response.status).toBe(200);

    const remaining = await listSessions(here);
    expect(remaining).toHaveLength(1);
    // And nothing was sent to expire THIS device's cookies — a revocation of the others must not
    // sign out the device that asked for it (an expiry is a Set-Cookie with an empty value).
    const expired = setCookies(response).filter(
      (cookie) => cookie.name.endsWith("session_token") && cookie.value === "",
    );
    expect(expired).toEqual([]);
  });
});
