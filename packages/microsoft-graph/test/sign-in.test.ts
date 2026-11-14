import { describe, expect, it } from "vitest";
import type { HttpClient, HttpRequest } from "@magna-carta/integrations/http";
import {
  checkApplicationCredentials,
  MICROSOFT_CALENDAR_SCOPES,
  authorizationUrl,
  readSignedInAccount,
  redeemAuthorizationCode,
  refreshAccessToken,
  type MicrosoftApplication,
} from "../src/sign-in.ts";

const application: MicrosoftApplication = {
  clientId: "client-1",
  clientSecret: "secret-1",
  redirectUri: "https://app.example.test/callback",
};

const now = () => new Date("2026-11-10T12:00:00.000Z");

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
  it("asks for the calendar, the member's identity and a refresh token, and nothing about mail", () => {
    expect([...MICROSOFT_CALENDAR_SCOPES]).toEqual([
      "Calendars.ReadWrite",
      "User.Read",
      "offline_access",
    ]);
    expect(MICROSOFT_CALENDAR_SCOPES.some((scope) => scope.toLowerCase().includes("mail"))).toBe(
      false,
    );
  });
});

describe("the authorization address", () => {
  it("carries the application, the scopes, the state and the challenge", () => {
    const url = new URL(
      authorizationUrl({
        application,
        scopes: MICROSOFT_CALENDAR_SCOPES,
        state: "state-1",
        codeChallenge: "challenge-1",
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-1",
      response_type: "code",
      redirect_uri: "https://app.example.test/callback",
      response_mode: "query",
      scope: "Calendars.ReadWrite User.Read offline_access",
      state: "state-1",
      code_challenge: "challenge-1",
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    expect(url.toString()).not.toContain("secret-1");
  });

  it("addresses the firm's own tenant when one is named", () => {
    const url = authorizationUrl({
      application: { ...application, tenant: "tenant-9" },
      scopes: MICROSOFT_CALENDAR_SCOPES,
      state: "s",
      codeChallenge: "c",
    });
    expect(
      url.startsWith("https://login.microsoftonline.com/tenant-9/oauth2/v2.0/authorize?"),
    ).toBe(true);
  });
});

describe("redeeming the code", () => {
  it("posts the code with its verifier and answers a credential that expires on the clock", async () => {
    const { http, sent } = answering(200, {
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 3600,
      scope: "Calendars.ReadWrite User.Read",
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
        expiresAt: "2026-11-10T13:00:00.000Z",
      },
      grantedScopes: ["Calendars.ReadWrite", "User.Read"],
    });
    expect(sent[0]?.url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
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

  it("never carries Microsoft's error description into the problem", async () => {
    const { http } = answering(400, {
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
  it("keeps the standing refresh token when Microsoft returns no new one", async () => {
    const { http, sent } = answering(200, { access_token: "access-2", expires_in: 60 });
    const outcome = await refreshAccessToken({ http, now }, application, "refresh-1");
    expect(outcome).toMatchObject({
      ok: true,
      credential: { accessToken: "access-2", refreshToken: "refresh-1" },
    });
    expect(Object.fromEntries(new URLSearchParams(sent[0]?.body))).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
    });
  });

  it("takes the new refresh token when Microsoft replaces it", async () => {
    const { http } = answering(200, {
      access_token: "access-2",
      refresh_token: "refresh-2",
      expires_in: 60,
    });
    const outcome = await refreshAccessToken({ http, now }, application, "refresh-1");
    expect(outcome).toMatchObject({ ok: true, credential: { refreshToken: "refresh-2" } });
  });

  it.each(["invalid_grant", "interaction_required", "consent_required"])(
    "reads %s as the member having to sign in again",
    async (error) => {
      const { http } = answering(400, { error });
      const outcome = await refreshAccessToken({ http, now }, application, "refresh-1");
      expect(outcome).toMatchObject({
        ok: false,
        problem: { category: "auth", retryable: false },
      });
    },
  );

  it("reads a server failure and an unreachable network as worth retrying", async () => {
    const failing = answering(503, {});
    expect(await refreshAccessToken({ http: failing.http, now }, application, "r")).toMatchObject({
      ok: false,
      problem: { category: "upstream", retryable: true },
    });
    const unreachable: HttpClient = { request: () => Promise.reject(new Error("offline")) };
    expect(await refreshAccessToken({ http: unreachable, now }, application, "r")).toMatchObject({
      ok: false,
      problem: { category: "network", retryable: true },
    });
  });
});

describe("reading the signed-in account", () => {
  it("prefers the mailbox address and falls back to the sign-in name", async () => {
    const withMail = answering(200, {
      mail: "a@firm.example",
      userPrincipalName: "a_1@tenant.example",
    });
    expect(await readSignedInAccount(withMail.http, "access-1")).toEqual({
      ok: true,
      address: "a@firm.example",
    });
    expect(withMail.sent[0]?.headers).toEqual({ Authorization: "Bearer access-1" });
    const withoutMail = answering(200, { mail: null, userPrincipalName: "a_1@tenant.example" });
    expect(await readSignedInAccount(withoutMail.http, "access-1")).toEqual({
      ok: true,
      address: "a_1@tenant.example",
    });
  });

  it("refuses an answer that names no account", async () => {
    const { http } = answering(200, {});
    expect(await readSignedInAccount(http, "access-1")).toMatchObject({
      ok: false,
      problem: { category: "validation" },
    });
  });

  it("reads a refused token as the member having to sign in again", async () => {
    const { http } = answering(401, {});
    expect(await readSignedInAccount(http, "access-1")).toMatchObject({
      ok: false,
      problem: { category: "auth" },
    });
  });
});

describe("checkApplicationCredentials", () => {
  it("reads a refused made-up refresh token as the application being accepted", async () => {
    const { http, sent } = answering(400, { error: "invalid_grant" });
    expect(await checkApplicationCredentials(http, application)).toBe("accepted");
    expect(sent[0]?.url).toContain("login.microsoftonline.com");
    expect(new URLSearchParams(sent[0]?.body).get("grant_type")).toBe("refresh_token");
  });

  it("reads a wrong secret as refused and a fault as unreachable", async () => {
    expect(
      await checkApplicationCredentials(
        answering(401, { error: "invalid_client" }).http,
        application,
      ),
    ).toBe("refused");
    expect(await checkApplicationCredentials(answering(500, {}).http, application)).toBe(
      "unreachable",
    );
  });
});
