import { describe, expect, it } from "vitest";
import type { HttpClient, HttpRequest } from "@magna-carta/integrations/http";
import {
  GOOGLE_CALENDAR_SCOPES,
  authorizationUrl,
  checkApplicationCredentials,
  grantsCalendar,
  readSignedInAccount,
  redeemAuthorizationCode,
  refreshAccessToken,
  type GoogleApplication,
} from "../src/sign-in.ts";

const application: GoogleApplication = {
  clientId: "client-1",
  clientSecret: "secret-1",
  redirectUri: "https://app.example.test/callback",
};

const now = () => new Date("2026-11-13T12:00:00.000Z");

function answering(status: number, body: unknown): { http: HttpClient; sent: HttpRequest[] } {
  const sent: HttpRequest[] = [];
  return {
    sent,
    http: {
      request: (input) => {
        sent.push(input);
        return Promise.resolve({ status, json: () => Promise.resolve(body) });
      },
    },
  };
}

describe("the calendar grant", () => {
  it("asks for events and the calendar list, and nothing about mail or who the member is", () => {
    expect([...GOOGLE_CALENDAR_SCOPES]).toEqual([
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    ]);
    for (const scope of GOOGLE_CALENDAR_SCOPES) {
      expect(scope).not.toMatch(/mail|gmail|contacts|drive|openid|profile|email/i);
    }
  });

  it("is granted only when both permissions were", () => {
    expect(grantsCalendar([...GOOGLE_CALENDAR_SCOPES])).toBe(true);
    expect(grantsCalendar([GOOGLE_CALENDAR_SCOPES[0]])).toBe(false);
    expect(grantsCalendar([])).toBe(false);
  });
});

describe("the authorization address", () => {
  it("carries the application, the scopes, the state and the challenge, and asks for a lasting sign-in", () => {
    const url = new URL(
      authorizationUrl({
        application,
        scopes: GOOGLE_CALENDAR_SCOPES,
        state: "state-1",
        codeChallenge: "challenge-1",
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-1",
      response_type: "code",
      redirect_uri: "https://app.example.test/callback",
      scope:
        "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      state: "state-1",
      code_challenge: "challenge-1",
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent select_account",
    });
    expect(url.toString()).not.toContain("secret-1");
  });
});

describe("redeeming the code", () => {
  it("posts the code with its verifier and answers a credential that expires on the clock", async () => {
    const { http, sent } = answering(200, {
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 3600,
      scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    });
    const outcome = await redeemAuthorizationCode({ http, now }, application, {
      code: "code-1",
      codeVerifier: "verifier-1",
    });
    expect(outcome).toEqual({
      ok: true,
      credential: {
        kind: "oauth",
        accessToken: "access-1",
        refreshToken: "refresh-1",
        expiresAt: "2026-11-13T13:00:00.000Z",
      },
      grantedScopes: [...GOOGLE_CALENDAR_SCOPES],
    });
    expect(sent[0]?.url).toBe("https://oauth2.googleapis.com/token");
    expect(Object.fromEntries(new URLSearchParams(sent[0]?.body))).toEqual({
      client_id: "client-1",
      client_secret: "secret-1",
      grant_type: "authorization_code",
      code: "code-1",
      redirect_uri: "https://app.example.test/callback",
      code_verifier: "verifier-1",
    });
  });

  it("refuses an answer with no refresh token, because the connection could not outlive the hour", async () => {
    const { http } = answering(200, { access_token: "access-1", expires_in: 3600 });
    const outcome = await redeemAuthorizationCode({ http, now }, application, {
      code: "c",
      codeVerifier: "v",
    });
    expect(outcome).toMatchObject({ ok: false, problem: { category: "validation" } });
  });

  it("never carries Google's error description into the problem", async () => {
    const { http } = answering(401, {
      error: "invalid_client",
      error_description: "client_secret secret-1 is wrong",
    });
    const outcome = await redeemAuthorizationCode({ http, now }, application, {
      code: "c",
      codeVerifier: "v",
    });
    expect(outcome).toMatchObject({ ok: false, problem: { category: "validation" } });
    expect(JSON.stringify(outcome)).not.toContain("secret-1");
  });
});

describe("refreshing", () => {
  it("keeps the refresh token it was given, because Google answers a refresh without one", async () => {
    const { http, sent } = answering(200, { access_token: "access-2", expires_in: 3599 });
    const outcome = await refreshAccessToken({ http, now }, application, "refresh-1");
    expect(outcome).toMatchObject({
      ok: true,
      credential: { accessToken: "access-2", refreshToken: "refresh-1" },
    });
    expect(Object.fromEntries(new URLSearchParams(sent[0]?.body))).toEqual({
      client_id: "client-1",
      client_secret: "secret-1",
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
    });
  });

  it("reads a withdrawn grant as the member having to sign in again", async () => {
    const { http } = answering(400, { error: "invalid_grant" });
    expect(await refreshAccessToken({ http, now }, application, "refresh-1")).toMatchObject({
      ok: false,
      problem: { category: "auth" },
    });
  });

  it.each([
    [429, "rate_limit"],
    [503, "upstream"],
  ])("reads a %i as a %s problem", async (status, category) => {
    const { http } = answering(status, {});
    expect(await refreshAccessToken({ http, now }, application, "refresh-1")).toMatchObject({
      ok: false,
      problem: { category },
    });
  });

  it("reads a transport failure as a network problem", async () => {
    const http: HttpClient = { request: () => Promise.reject(new Error("offline")) };
    expect(await refreshAccessToken({ http, now }, application, "refresh-1")).toMatchObject({
      ok: false,
      problem: { category: "network" },
    });
  });
});

describe("naming the account", () => {
  it("reads the account's address from its own primary calendar", async () => {
    const { http, sent } = answering(200, { id: "member@example.test" });
    expect(await readSignedInAccount(http, "access-1")).toEqual({
      ok: true,
      address: "member@example.test",
    });
    expect(sent[0]?.url).toBe(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList/primary?fields=id",
    );
    expect(sent[0]?.headers).toEqual({ Authorization: "Bearer access-1" });
  });

  it("reads a refused token as an auth problem and an unreadable answer as a validation one", async () => {
    expect(await readSignedInAccount(answering(401, {}).http, "a")).toMatchObject({
      ok: false,
      problem: { category: "auth" },
    });
    expect(await readSignedInAccount(answering(200, {}).http, "a")).toMatchObject({
      ok: false,
      problem: { category: "validation" },
    });
  });
});

describe("checkApplicationCredentials", () => {
  it("reads a refused made-up refresh token as the application being accepted", async () => {
    const { http, sent } = answering(400, { error: "invalid_grant", error_description: "Bad" });
    expect(await checkApplicationCredentials(http, application)).toBe("accepted");
    expect(sent[0]?.url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(sent[0]?.body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("client_id")).toBe("client-1");
    // No member's token and no authorization code is ever sent by the check.
    expect(body.get("code")).toBeNull();
  });

  it("reads an unknown application or a wrong secret as refused", async () => {
    expect(
      await checkApplicationCredentials(
        answering(401, { error: "invalid_client" }).http,
        application,
      ),
    ).toBe("refused");
    expect(
      await checkApplicationCredentials(
        answering(400, { error: "unauthorized_client" }).http,
        application,
      ),
    ).toBe("refused");
  });

  it("reads a fault, an unreadable answer or no answer as unreachable", async () => {
    expect(await checkApplicationCredentials(answering(503, {}).http, application)).toBe(
      "unreachable",
    );
    const offline: HttpClient = { request: () => Promise.reject(new Error("offline")) };
    expect(await checkApplicationCredentials(offline, application)).toBe("unreachable");
  });
});
