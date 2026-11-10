/*
 * A member's own Outlook connection, through the real chokepoint over Miniflare bindings, with
 * Microsoft answered by a script. Three things are pinned that no screen can enforce for itself:
 * the SHIPPED state (no application registered, so nothing is offered and nothing is called), the
 * return trip's proofs (a return this browser did not start records nothing), and what is stored
 * (the refresh token sealed, the account named, an audit row, and one member unable to reach
 * another's connection).
 */
import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { HttpRequest } from "@magna-carta/integrations/http";
import { resolveMicrosoftApplication } from "../src/calendar-sync/microsoft-application.ts";
import { createApp } from "../src/http/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithRole,
  readJson,
  seedCredentialedUser,
  seedFirm,
  seedFirmKey,
  setCookies,
  signInForSessionCookie,
} from "./support/test-auth.ts";

const ORIGIN = "https://example.com";
const LIST_URL = `${ORIGIN}/api/v1/me/connected-accounts`;
const START_URL = `${ORIGIN}/api/v1/me/connected-accounts/microsoft/sign-in`;
const CALLBACK_URL = `${ORIGIN}/api/v1/integrations/microsoft/callback`;
// What Microsoft is told to return to: the deployment's stated public origin, which the test pool
// sets, and not the origin a request happened to arrive on.
const REGISTERED_CALLBACK_URL = `${env.APP_BASE_URL}/api/v1/integrations/microsoft/callback`;
const ATTEMPT_COOKIE = "__Host-calendar-sign-in";

const PROVISIONED = {
  ...env,
  MICROSOFT_CLIENT_ID: "client-1",
  MICROSOFT_CLIENT_SECRET: "secret-1",
};
const UNPROVISIONED = {
  ...env,
  MICROSOFT_CLIENT_ID: undefined,
  MICROSOFT_CLIENT_SECRET: undefined,
};

// Microsoft, as a script. `token` and `calendars` are swapped per test; every request is kept so a
// test can say what was and was not sent.
const microsoftCalls: HttpRequest[] = [];
let tokenAnswer: { status: number; body: unknown };
let calendarsAnswer: { status: number; body: unknown };

const app = createApp({
  connectedAccounts: {
    now: () => new Date("2026-11-10T12:00:00.000Z"),
    http: {
      request: (input) => {
        microsoftCalls.push(input);
        const answer = input.url.startsWith("https://login.microsoftonline.com/")
          ? tokenAnswer
          : input.url.startsWith("https://graph.microsoft.com/v1.0/me/calendars")
            ? calendarsAnswer
            : {
                status: 200,
                body: { mail: "jane@firm.example", userPrincipalName: "jane_1@tenant.example" },
              };
        return Promise.resolve({ status: answer.status, json: () => Promise.resolve(answer.body) });
      },
    },
  },
});

let firmId: FirmId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let memberCookie: string;
let memberUserId: string;
let colleagueCookie: string;
let noRoleCookie: string;

interface AccountList {
  providers: { provider: string; available: boolean }[];
  accounts: {
    id: string;
    provider: string;
    accountLabel: string | null;
    status: string;
    connectedAt: string;
  }[];
}

function headers(cookie: string, attempt?: string): Record<string, string> {
  return {
    cookie: attempt === undefined ? cookie : `${cookie}; ${ATTEMPT_COOKIE}=${attempt}`,
    origin: ORIGIN,
  };
}

async function list(cookie: string, environment = PROVISIONED): Promise<AccountList> {
  const response = await app.request(LIST_URL, { headers: headers(cookie) }, environment);
  expect(response.status).toBe(200);
  return readJson<AccountList>(response);
}

// Starts a sign-in and answers what the browser would then hold: the state Microsoft will echo and
// the attempt cookie.
async function start(cookie: string): Promise<{ state: string; attempt: string; url: URL }> {
  const response = await app.request(
    START_URL,
    { method: "POST", headers: headers(cookie) },
    PROVISIONED,
  );
  expect(response.status).toBe(200);
  const url = new URL((await readJson<{ authorizationUrl: string }>(response)).authorizationUrl);
  const attempt = setCookies(response).find((entry) => entry.name === ATTEMPT_COOKIE);
  if (attempt === undefined) throw new Error("the sign-in start set no attempt cookie");
  return { state: url.searchParams.get("state") ?? "", attempt: attempt.value, url };
}

async function comeBack(
  cookie: string,
  query: Record<string, string>,
  attempt?: string,
): Promise<Response> {
  return app.request(
    `${CALLBACK_URL}?${new URLSearchParams(query).toString()}`,
    { headers: headers(cookie, attempt) },
    PROVISIONED,
  );
}

function outcomeOf(response: Response): string | null {
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("location") ?? "", ORIGIN);
  expect(location.pathname).toBe("/settings/connected-accounts");
  return location.searchParams.get("outcome");
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Connected Accounts Firm" })).firmId;
  await seedFirmKey(firmId);
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  // A Read-only seat on purpose: connecting one's own calendar is open to every seat that can see
  // the calendar, and a pass asserted against an administrator would prove nothing.
  const member = await seedCredentialedUser("accounts-member@example.com", {
    userName: "Jane Doe",
    firmId,
  });
  memberUserId = member.userId;
  await mirrorMemberWithRole(member.userId, "Jane Doe", firmId, "Read-only");
  memberCookie = await signInForSessionCookie("accounts-member@example.com");

  const colleague = await seedCredentialedUser("accounts-colleague@example.com", {
    userName: "Sam Roe",
    firmId,
  });
  await mirrorMemberWithRole(colleague.userId, "Sam Roe", firmId, "Attorney");
  colleagueCookie = await signInForSessionCookie("accounts-colleague@example.com");

  // In the firm and holding no role, so no calendar:read.
  await seedCredentialedUser("accounts-no-role@example.com", { userName: "No Role", firmId });
  noRoleCookie = await signInForSessionCookie("accounts-no-role@example.com");
});

beforeEach(() => {
  microsoftCalls.length = 0;
  tokenAnswer = {
    status: 200,
    body: {
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 3600,
      scope:
        "https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read",
    },
  };
  calendarsAnswer = {
    status: 200,
    body: { value: [{ id: "cal-1", name: "Calendar", canEdit: true, isDefaultCalendar: true }] },
  };
});

describe("the shipped state: no Microsoft application registered", () => {
  it("offers no provider, starts no sign-in, and asks Microsoft nothing", async () => {
    const body = await list(memberCookie, UNPROVISIONED);
    expect(body.providers).toEqual([{ provider: "microsoft", available: false }]);
    expect(body.accounts).toEqual([]);

    const response = await app.request(
      START_URL,
      { method: "POST", headers: headers(memberCookie) },
      UNPROVISIONED,
    );
    expect(response.status).toBe(501);
    expect(setCookies(response).some((entry) => entry.name === ATTEMPT_COOKIE)).toBe(false);
    expect(microsoftCalls).toHaveLength(0);
  });

  it("treats half a registration as none", async () => {
    const body = await list(memberCookie, { ...PROVISIONED, MICROSOFT_CLIENT_SECRET: undefined });
    expect(body.providers).toEqual([{ provider: "microsoft", available: false }]);
  });
});

describe("who may connect", () => {
  it("refuses a caller with no session", async () => {
    const response = await app.request(
      START_URL,
      { method: "POST", headers: { origin: ORIGIN } },
      PROVISIONED,
    );
    expect(response.status).toBe(401);
  });

  it("refuses a member who cannot see the calendar", async () => {
    const response = await app.request(
      START_URL,
      { method: "POST", headers: headers(noRoleCookie) },
      PROVISIONED,
    );
    expect(response.status).toBe(403);
  });
});

describe("starting a sign-in", () => {
  it("sends the browser to Microsoft asking for the calendar and nothing about mail", async () => {
    const { url, state } = await start(memberCookie);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    expect(url.searchParams.get("scope")).toBe("Calendars.ReadWrite User.Read offline_access");
    expect(url.searchParams.get("redirect_uri")).toBe(REGISTERED_CALLBACK_URL);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(state.length).toBeGreaterThanOrEqual(43);
    expect(url.toString()).not.toContain("secret-1");
    // Nothing is stored and Microsoft is not called until the member returns.
    expect(microsoftCalls).toHaveLength(0);
    expect((await list(memberCookie)).accounts).toEqual([]);
  });
});

describe("the return address", () => {
  const registered = { MICROSOFT_CLIENT_ID: "client-1", MICROSOFT_CLIENT_SECRET: "secret-1" };

  it("names the deployment's stated public origin when it has one", () => {
    expect(
      resolveMicrosoftApplication(
        { ...registered, APP_BASE_URL: "https://app.firm.example/" },
        "https://other.example/api/v1/anything",
      )?.redirectUri,
    ).toBe("https://app.firm.example/api/v1/integrations/microsoft/callback");
  });

  it("falls back to the request's own origin, and carries a named tenant", () => {
    expect(
      resolveMicrosoftApplication(
        { ...registered, MICROSOFT_TENANT: "tenant-9" },
        "https://other.example/api/v1/anything",
      ),
    ).toEqual({
      clientId: "client-1",
      clientSecret: "secret-1",
      redirectUri: "https://other.example/api/v1/integrations/microsoft/callback",
      tenant: "tenant-9",
    });
  });
});

describe("the return from Microsoft", () => {
  it("records nothing for a return this browser did not start", async () => {
    const { attempt } = await start(memberCookie);
    expect(
      outcomeOf(await comeBack(memberCookie, { code: "code-1", state: "forged" }, attempt)),
    ).toBe("expired");
    const real = await start(memberCookie);
    // The right state and no cookie: a link opened in another browser.
    expect(outcomeOf(await comeBack(memberCookie, { code: "code-1", state: real.state }))).toBe(
      "expired",
    );
    // The right state and cookie under somebody else's session.
    expect(
      outcomeOf(
        await comeBack(colleagueCookie, { code: "code-1", state: real.state }, real.attempt),
      ),
    ).toBe("expired");
    expect(microsoftCalls).toHaveLength(0);
    expect((await list(memberCookie)).accounts).toEqual([]);
    expect((await list(colleagueCookie)).accounts).toEqual([]);
  });

  it("records nothing when the member declines at Microsoft", async () => {
    const { state, attempt } = await start(memberCookie);
    expect(
      outcomeOf(await comeBack(memberCookie, { error: "access_denied", state }, attempt)),
    ).toBe("declined");
    expect(microsoftCalls).toHaveLength(0);
  });

  it("records nothing when the calendar was withheld from the grant", async () => {
    tokenAnswer = {
      status: 200,
      body: { access_token: "a", refresh_token: "r", expires_in: 3600, scope: "User.Read" },
    };
    const { state, attempt } = await start(memberCookie);
    expect(outcomeOf(await comeBack(memberCookie, { code: "code-1", state }, attempt))).toBe(
      "declined",
    );
    expect((await list(memberCookie)).accounts).toEqual([]);
  });

  it("records nothing when the calendar cannot actually be read", async () => {
    calendarsAnswer = { status: 403, body: {} };
    const { state, attempt } = await start(memberCookie);
    expect(outcomeOf(await comeBack(memberCookie, { code: "code-1", state }, attempt))).toBe(
      "failed",
    );
    expect((await list(memberCookie)).accounts).toEqual([]);
  });

  it("connects the account, names it, seals the token, and writes the audit row", async () => {
    const { state, attempt } = await start(memberCookie);
    const response = await comeBack(memberCookie, { code: "code-1", state }, attempt);
    expect(outcomeOf(response)).toBe("connected");
    // The attempt is spent: the cookie is cleared on the way back.
    expect(setCookies(response).find((entry) => entry.name === ATTEMPT_COOKIE)?.value).toBe("");

    const redeem = microsoftCalls.find((call) => call.url.endsWith("/oauth2/v2.0/token"));
    expect(Object.fromEntries(new URLSearchParams(redeem?.body))).toMatchObject({
      grant_type: "authorization_code",
      code: "code-1",
      redirect_uri: REGISTERED_CALLBACK_URL,
    });

    const { accounts } = await list(memberCookie);
    expect(accounts).toEqual([
      {
        id: expect.any(String) as string,
        provider: "microsoft",
        accountLabel: "jane@firm.example",
        status: "connected",
        connectedAt: "2026-11-10T12:00:00.000Z",
      },
    ]);

    const row = await firmDatabase
      .prepare(
        "SELECT scope, principal_ref AS principalRef, credential_ref AS credentialRef FROM integration_connection WHERE id = ?1",
      )
      .bind(accounts[0]?.id)
      .first<{ scope: string; principalRef: string; credentialRef: string }>();
    expect(row).toMatchObject({ scope: "user", principalRef: memberUserId });

    // Sealed: neither token appears anywhere in the stored row.
    const credential = await firmDatabase
      .prepare("SELECT ciphertext FROM integration_credential WHERE credential_ref = ?1")
      .bind(row?.credentialRef)
      .first<{ ciphertext: string }>();
    expect(credential?.ciphertext).toBeTruthy();
    expect(credential?.ciphertext).not.toContain("refresh-1");
    expect(credential?.ciphertext).not.toContain("access-1");

    const audit = await firmDatabase
      .prepare(
        "SELECT actor_user_id AS actor, metadata FROM audit_log WHERE event = 'calendar_sync.account_connected' AND subject_id = ?1",
      )
      .bind(accounts[0]?.id)
      .first<{ actor: string; metadata: string }>();
    expect(audit?.actor).toBe(memberUserId);
    expect(audit?.metadata).not.toContain("jane@firm.example");
  });

  it("keeps one member's connection out of another member's list and reach", async () => {
    const mine = (await list(memberCookie)).accounts[0];
    expect(mine).toBeDefined();
    expect((await list(colleagueCookie)).accounts).toEqual([]);
    const response = await app.request(
      `${LIST_URL}/${mine?.id}`,
      { method: "DELETE", headers: headers(colleagueCookie) },
      PROVISIONED,
    );
    expect(response.status).toBe(404);
    expect((await list(memberCookie)).accounts).toHaveLength(1);
  });

  it("signing in again replaces the connection in place", async () => {
    const before = (await list(memberCookie)).accounts[0];
    tokenAnswer = {
      status: 200,
      body: { access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 },
    };
    const { state, attempt } = await start(memberCookie);
    expect(outcomeOf(await comeBack(memberCookie, { code: "code-2", state }, attempt))).toBe(
      "connected",
    );
    const after = (await list(memberCookie)).accounts;
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(before?.id);
  });
});

describe("disconnecting", () => {
  it("deletes the connection and its sealed token together, and says so in the audit log", async () => {
    const account = (await list(memberCookie)).accounts[0];
    const response = await app.request(
      `${LIST_URL}/${account?.id}`,
      { method: "DELETE", headers: headers(memberCookie) },
      PROVISIONED,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: account?.id, status: "disconnected" });
    expect((await list(memberCookie)).accounts).toEqual([]);

    const credentials = await firmDatabase
      .prepare("SELECT COUNT(*) AS total FROM integration_credential WHERE credential_ref LIKE ?1")
      .bind(`%${memberUserId}`)
      .first<{ total: number }>();
    expect(credentials?.total).toBe(0);
    const audit = await firmDatabase
      .prepare(
        "SELECT COUNT(*) AS total FROM audit_log WHERE event = 'calendar_sync.account_disconnected' AND subject_id = ?1",
      )
      .bind(account?.id)
      .first<{ total: number }>();
    expect(audit?.total).toBe(1);

    // A second disconnect finds nothing, and says so.
    const again = await app.request(
      `${LIST_URL}/${account?.id}`,
      { method: "DELETE", headers: headers(memberCookie) },
      PROVISIONED,
    );
    expect(again.status).toBe(404);
  });
});
