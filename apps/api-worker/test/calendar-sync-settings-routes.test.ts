/*
 * Calendar sync settings through the real chokepoint over Miniflare bindings, with Microsoft
 * answered by a script. What is pinned: a member's rule never exceeds the firm's limit (a save is
 * refused, and closing a subject removes the rules that depended on it); a rule can only point at a
 * calendar the member's account really has and can write to; one member cannot read or change
 * another's rules; and only a seat that sets firm policy can set the limit.
 */
import { env, runInDurableObject } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { HttpRequest } from "@magna-carta/integrations/http";
import { runConnectionPass } from "../src/calendar-sync/connection-pass.ts";
import { createApp } from "../src/http/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { settleBackgroundWork } from "./support/settle-background-work.ts";
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
const SETTINGS_URL = `${ORIGIN}/api/v1/me/calendar-sync`;
const RULES_URL = `${ORIGIN}/api/v1/me/calendar-sync/rules`;
const FIRM_LIMITS_URL = `${ORIGIN}/api/v1/calendar-sync/firm-limits`;
const START_URL = `${ORIGIN}/api/v1/me/connected-accounts/microsoft/sign-in`;
const CALLBACK_URL = `${ORIGIN}/api/v1/integrations/microsoft/callback`;
const ATTEMPT_COOKIE = "__Host-calendar-sign-in";

const PROVISIONED = {
  ...env,
  MICROSOFT_CLIENT_ID: "client-1",
  MICROSOFT_CLIENT_SECRET: "secret-1",
};

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
            : { status: 200, body: { mail: "jane@firm.example" } };
        return Promise.resolve({ status: answer.status, json: () => Promise.resolve(answer.body) });
      },
    },
  },
});

let firmId: FirmId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let memberCookie: string;
let colleagueCookie: string;
let adminCookie: string;
let hearingTypeId: string;
let trialTypeId: string;

interface Subject {
  subject: string;
  kind: string;
  name: string | null;
  mayLeave: boolean;
  detail: string;
}
interface Settings {
  account: { id: string; status: string; accountLabel: string | null } | null;
  calendars: { remoteId: string; name: string; canWrite: boolean }[] | null;
  subjects: Subject[];
  rules: { subject: string; calendarRemoteId: string; calendarName: string; scope: string }[];
}

function headers(cookie: string, attempt?: string): Record<string, string> {
  return {
    cookie: attempt === undefined ? cookie : `${cookie}; ${ATTEMPT_COOKIE}=${attempt}`,
    origin: ORIGIN,
    "content-type": "application/json",
  };
}

async function connect(cookie: string): Promise<void> {
  const started = await app.request(
    START_URL,
    { method: "POST", headers: headers(cookie) },
    PROVISIONED,
  );
  const url = new URL((await readJson<{ authorizationUrl: string }>(started)).authorizationUrl);
  const attempt = setCookies(started).find((entry) => entry.name === ATTEMPT_COOKIE);
  if (attempt === undefined) throw new Error("the sign-in start set no attempt cookie");
  const query = new URLSearchParams({ code: "code-1", state: url.searchParams.get("state") ?? "" });
  const returned = await app.request(
    `${CALLBACK_URL}?${query.toString()}`,
    { headers: headers(cookie, attempt.value) },
    PROVISIONED,
  );
  expect(returned.headers.get("location")).toContain("outcome=connected");
}

async function readSettings(cookie: string): Promise<Settings> {
  const response = await app.request(SETTINGS_URL, { headers: headers(cookie) }, PROVISIONED);
  expect(response.status).toBe(200);
  return readJson<Settings>(response);
}

async function saveRules(cookie: string, rules: unknown[]): Promise<Response> {
  return await app.request(
    RULES_URL,
    { method: "PUT", headers: headers(cookie), body: JSON.stringify({ rules }) },
    PROVISIONED,
  );
}

async function setLimits(cookie: string, limits: unknown[]): Promise<Response> {
  return await app.request(
    FIRM_LIMITS_URL,
    { method: "PUT", headers: headers(cookie), body: JSON.stringify({ limits }) },
    PROVISIONED,
  );
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Calendar Sync Firm" })).firmId;
  await seedFirmKey(firmId);
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  // A Read-only seat on purpose: choosing where one's own events go is open to every seat that can
  // see the calendar.
  const member = await seedCredentialedUser("sync-member@example.com", {
    userName: "Jane Doe",
    firmId,
  });
  await mirrorMemberWithRole(member.userId, "Jane Doe", firmId, "Read-only");
  memberCookie = await signInForSessionCookie("sync-member@example.com");

  const colleague = await seedCredentialedUser("sync-colleague@example.com", {
    userName: "Sam Roe",
    firmId,
  });
  await mirrorMemberWithRole(colleague.userId, "Sam Roe", firmId, "Attorney");
  colleagueCookie = await signInForSessionCookie("sync-colleague@example.com");

  const admin = await seedCredentialedUser("sync-admin@example.com", {
    userName: "Ada Min",
    firmId,
  });
  await mirrorMemberWithRole(admin.userId, "Ada Min", firmId, "Admin");
  adminCookie = await signInForSessionCookie("sync-admin@example.com");

  const { results } = await firmDatabase
    .prepare("SELECT id, name FROM matter_event_type WHERE name IN ('Hearing', 'Trial')")
    .all<{ id: string; name: string }>();
  hearingTypeId = results.find((row) => row.name === "Hearing")?.id ?? "";
  trialTypeId = results.find((row) => row.name === "Trial")?.id ?? "";
  expect(hearingTypeId).not.toBe("");
  expect(trialTypeId).not.toBe("");

  tokenAnswer = {
    status: 200,
    body: {
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 3600,
      scope: "https://graph.microsoft.com/Calendars.ReadWrite",
    },
  };
  calendarsAnswer = { status: 200, body: { value: [] } };
  await connect(memberCookie);
});

beforeEach(() => {
  microsoftCalls.length = 0;
  tokenAnswer = {
    status: 200,
    body: { access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 },
  };
  calendarsAnswer = {
    status: 200,
    body: {
      value: [
        { id: "cal-main", name: "Calendar", canEdit: true, isDefaultCalendar: true },
        { id: "cal-court", name: "Court", canEdit: true, isDefaultCalendar: false },
        { id: "cal-holidays", name: "Holidays", canEdit: false, isDefaultCalendar: false },
      ],
    },
  };
});

describe("a member's calendar sync settings", () => {
  it("lists every event type on its own row, deadlines last, with nothing synced", async () => {
    const settings = await readSettings(memberCookie);
    expect(settings.account?.accountLabel).toBe("jane@firm.example");
    expect(settings.calendars?.map((calendar) => calendar.remoteId)).toEqual([
      "cal-main",
      "cal-court",
      "cal-holidays",
    ]);
    expect(settings.rules).toEqual([]);
    const hearing = settings.subjects.find((subject) => subject.subject === hearingTypeId);
    expect(hearing).toMatchObject({ kind: "eventType", name: "Hearing", mayLeave: true });
    expect(settings.subjects.at(-1)).toMatchObject({ subject: "deadline", kind: "deadline" });
  });

  it("answers a member with no account, and asks Microsoft nothing", async () => {
    const settings = await readSettings(colleagueCookie);
    expect(settings.account).toBeNull();
    expect(settings.calendars).toBeNull();
    expect(settings.subjects.length).toBeGreaterThan(1);
    expect(microsoftCalls).toHaveLength(0);

    const response = await saveRules(colleagueCookie, []);
    expect(response.status).toBe(409);
  });

  it("saves rules, taking each calendar's name from the provider", async () => {
    const response = await saveRules(memberCookie, [
      { subject: hearingTypeId, calendarRemoteId: "cal-court", scope: "mine" },
      { subject: "deadline", calendarRemoteId: "cal-main", scope: "my_matters" },
    ]);
    expect(response.status).toBe(200);
    const settings = await readJson<Settings>(response);
    expect(settings.rules.toSorted((a, b) => a.subject.localeCompare(b.subject))).toEqual(
      [
        {
          subject: hearingTypeId,
          calendarRemoteId: "cal-court",
          calendarName: "Court",
          scope: "mine",
        },
        {
          subject: "deadline",
          calendarRemoteId: "cal-main",
          calendarName: "Calendar",
          scope: "my_matters",
        },
      ].toSorted((a, b) => a.subject.localeCompare(b.subject)),
    );
    const audit = await firmDatabase
      .prepare(
        "SELECT COUNT(*) AS count FROM audit_log WHERE event = 'calendar_sync.rules_replaced'",
      )
      .first<{ count: number }>();
    expect(audit?.count).toBe(1);
    // The colleague still sees none of it.
    expect((await readSettings(colleagueCookie)).rules).toEqual([]);
  });

  it("stores the replacement sign-in Microsoft hands back", async () => {
    await readSettings(memberCookie);
    tokenAnswer = {
      status: 200,
      body: { access_token: "access-3", refresh_token: "refresh-3", expires_in: 3600 },
    };
    microsoftCalls.length = 0;
    await readSettings(memberCookie);
    const refresh = microsoftCalls.find((call) =>
      call.url.startsWith("https://login.microsoftonline.com/"),
    );
    expect(String(refresh?.body)).toContain("refresh_token=refresh-2");
  });

  it.each([
    ["a calendar the account does not have", "cal-gone", "calendar-sync-unknown-calendar"],
    ["a calendar the account cannot write to", "cal-holidays", "calendar-sync-calendar-read-only"],
  ])("refuses %s and keeps the rules as they were", async (_label, calendarRemoteId, code) => {
    const before = (await readSettings(memberCookie)).rules;
    const response = await saveRules(memberCookie, [
      { subject: trialTypeId, calendarRemoteId, scope: "mine" },
    ]);
    expect(response.status).toBe(422);
    const problem = await readJson<{ errors: { path: string; code: string }[] }>(response);
    expect(problem.errors).toEqual([expect.objectContaining({ path: trialTypeId, code })]);
    expect((await readSettings(memberCookie)).rules).toEqual(before);
  });

  it("refuses a subject that is no event type, and the same subject twice", async () => {
    const unknown = await saveRules(memberCookie, [
      { subject: "matterEventType_nope", calendarRemoteId: "cal-main", scope: "mine" },
    ]);
    expect(unknown.status).toBe(422);
    const twice = await saveRules(memberCookie, [
      { subject: trialTypeId, calendarRemoteId: "cal-main", scope: "mine" },
      { subject: trialTypeId, calendarRemoteId: "cal-court", scope: "mine" },
    ]);
    expect(twice.status).toBe(422);
  });

  it("saves nothing when Microsoft cannot be asked, and still shows the saved rules", async () => {
    calendarsAnswer = { status: 503, body: {} };
    const response = await saveRules(memberCookie, []);
    expect(response.status).toBe(503);
    const settings = await readSettings(memberCookie);
    expect(settings.calendars).toBeNull();
    expect(settings.rules.length).toBe(2);
  });

  it("says the account needs signing in to again when Microsoft says so", async () => {
    tokenAnswer = { status: 400, body: { error: "invalid_grant" } };
    const settings = await readSettings(memberCookie);
    expect(settings.account?.status).toBe("needs_reauth");
    expect(settings.calendars).toBeNull();
    const stored = await firmDatabase
      .prepare("SELECT status FROM integration_connection WHERE id = ?1")
      .bind(settings.account?.id)
      .first<{ status: string }>();
    expect(stored?.status).toBe("needs_reauth");
  });
});

describe("the firm's limit", () => {
  it("is set only by a seat that holds the policy permission", async () => {
    for (const cookie of [memberCookie, colleagueCookie]) {
      const read = await app.request(FIRM_LIMITS_URL, { headers: headers(cookie) }, PROVISIONED);
      expect(read.status).toBe(403);
      const write = await setLimits(cookie, [
        { subject: hearingTypeId, mayLeave: false, detail: "full" },
      ]);
      expect(write.status).toBe(403);
    }
  });

  it("removes every member's rule for a subject it closes, and refuses a new one", async () => {
    expect((await readSettings(memberCookie)).rules.map((rule) => rule.subject)).toContain(
      hearingTypeId,
    );
    const response = await setLimits(adminCookie, [
      { subject: hearingTypeId, mayLeave: false, detail: "full" },
      { subject: "deadline", mayLeave: true, detail: "minimal" },
    ]);
    expect(response.status).toBe(200);
    const limits = await readJson<{ subjects: Subject[] }>(response);
    expect(limits.subjects.find((subject) => subject.subject === hearingTypeId)).toMatchObject({
      mayLeave: false,
    });
    expect(limits.subjects.find((subject) => subject.subject === "deadline")).toMatchObject({
      mayLeave: true,
      detail: "minimal",
    });
    // A subject not named keeps the limit it had.
    expect(limits.subjects.find((subject) => subject.subject === trialTypeId)).toMatchObject({
      mayLeave: true,
      detail: "full",
    });

    const after = await readSettings(memberCookie);
    expect(after.rules.map((rule) => rule.subject)).toEqual(["deadline"]);

    const refused = await saveRules(memberCookie, [
      { subject: hearingTypeId, calendarRemoteId: "cal-court", scope: "mine" },
    ]);
    expect(refused.status).toBe(422);
    const problem = await readJson<{ errors: { code: string }[] }>(refused);
    expect(problem.errors[0]?.code).toBe("calendar-sync-subject-not-allowed");
  });

  it("refuses a limit on a subject that is no event type", async () => {
    const response = await setLimits(adminCookie, [
      { subject: "matterEventType_nope", mayLeave: true, detail: "full" },
    ]);
    expect(response.status).toBe(422);
  });
});

describe("sending to the member's calendar", () => {
  // The tests above leave limits and a connection status of their own behind.
  beforeAll(async () => {
    await firmDatabase.prepare("DELETE FROM calendar_sync_firm_limit").run();
    await firmDatabase.prepare("UPDATE integration_connection SET status = 'connected'").run();
  });

  it("asks the account to look again when its rules are saved, and a pass writes the event", async () => {
    const settings = await readSettings(memberCookie);
    const connectionId = settings.account?.id ?? "";
    const member = await firmDatabase
      .prepare("SELECT principal_ref FROM integration_connection WHERE id = ?1")
      .bind(connectionId)
      .first<{ principal_ref: string }>();
    const memberUserId = member?.principal_ref ?? "";
    const stamp = "2026-11-10T12:00:00.000Z";
    await firmDatabase
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, matter_number, created_at, updated_at) VALUES ('matter_syncroutes000000001', 'Doe v. Roe', 'open', ?1, '2026-0100', ?2, ?2)",
      )
      .bind(memberUserId, stamp)
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO matter_event (id, matter_id, event_type_id, title, status, starts_on, starts_at_time, time_zone, recorded_at, created_at, updated_at) VALUES ('matterEvent_syncroutes00001', 'matter_syncroutes000000001', ?1, 'Motion hearing', 'scheduled', '2026-12-01', '09:30', 'America/Chicago', ?2, ?2, ?2)",
      )
      .bind(hearingTypeId, stamp)
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO matter_event_participant (id, event_id, participant_kind, member_user_id, created_at, updated_at) VALUES ('matterEventParticipant_sync1', 'matterEvent_syncroutes00001', 'member', ?1, ?2, ?2)",
      )
      .bind(memberUserId, stamp)
      .run();

    const saved = await saveRules(memberCookie, [
      { subject: hearingTypeId, calendarRemoteId: "cal-court", scope: "mine" },
    ]);
    expect(saved.status).toBe(200);
    await settleBackgroundWork();
    const stub = env.CONNECTION_SYNC.get(
      env.CONNECTION_SYNC.idFromName(`${firmId}:${connectionId}`),
    );
    const armed = await runInDurableObject(stub, async (_instance, state) => ({
      alarm: await state.storage.getAlarm(),
      identity: await state.storage.get("identity"),
    }));
    expect(armed.alarm).not.toBeNull();
    expect(armed.identity).toEqual({ firmId, connectionId, memberUserId });
    // The pass is run here and not by the alarm, so the provider can be played by a script.
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.deleteAlarm();
    });

    const sent: HttpRequest[] = [];
    const outcome = await runConnectionPass(
      PROVISIONED,
      { firmId, connectionId, memberUserId } as never,
      {
        now: () => new Date(stamp),
        http: {
          request: (input) => {
            sent.push(input);
            const body = input.url.startsWith("https://login.microsoftonline.com/")
              ? { access_token: "access-3", refresh_token: "refresh-3", expires_in: 3600 }
              : { id: "evt-1", changeKey: "v1" };
            return Promise.resolve({ status: 200, json: () => Promise.resolve(body) });
          },
        },
      },
    );
    expect(outcome).toMatchObject({ kind: "settled", report: { created: 1 } });
    const write = sent.find(
      (request) => request.method === "POST" && request.url.includes("/events"),
    );
    expect(write?.url).toBe("https://graph.microsoft.com/v1.0/me/calendars/cal-court/events");
    expect(write?.headers.Authorization).toBe("Bearer access-3");
    expect(JSON.parse(write?.body ?? "{}")).toMatchObject({ subject: "Motion hearing" });
    const link = await firmDatabase
      .prepare("SELECT remote_event_id, state FROM calendar_sync_link WHERE connection_id = ?1")
      .bind(connectionId)
      .first<{ remote_event_id: string; state: string }>();
    expect(link).toEqual({ remote_event_id: "evt-1", state: "synced" });
  });

  it("marks the account for signing in again when the provider refuses the stored sign-in", async () => {
    const settings = await readSettings(memberCookie);
    const connectionId = settings.account?.id ?? "";
    const member = await firmDatabase
      .prepare("SELECT principal_ref FROM integration_connection WHERE id = ?1")
      .bind(connectionId)
      .first<{ principal_ref: string }>();
    const identity = { firmId, connectionId, memberUserId: member?.principal_ref ?? "" };
    const outcome = await runConnectionPass(PROVISIONED, identity as never, {
      http: {
        request: () =>
          Promise.resolve({
            status: 400,
            json: () => Promise.resolve({ error: "invalid_grant" }),
          }),
      },
    });
    expect(outcome).toEqual({ kind: "sign-in-again" });
    expect((await readSettings(memberCookie)).account?.status).toBe("needs_reauth");
    expect(await runConnectionPass(PROVISIONED, identity as never)).toEqual({ kind: "dormant" });
    // A deployment with no Microsoft application does nothing at all.
    expect(await runConnectionPass(env, identity as never)).toEqual({ kind: "dormant" });
    await firmDatabase
      .prepare("UPDATE integration_connection SET status = 'connected' WHERE id = ?1")
      .bind(connectionId)
      .run();
  });
});

describe("a copy the member changed in their own calendar", () => {
  const ISSUES_URL = `${ORIGIN}/api/v1/me/calendar-sync/issues`;
  const stamp = "2026-11-10T12:00:00.000Z";
  const sent = {
    title: "Motion hearing",
    location: null,
    startsOn: "2026-12-01",
    startsAtTime: "09:30",
    endsOn: "2026-12-01",
    endsAtTime: "09:30",
    timeZone: "America/Chicago",
  };
  let connectionId = "";

  async function raise(localId: string, kind: "changed" | "removed"): Promise<void> {
    await firmDatabase
      .prepare(
        "INSERT OR REPLACE INTO calendar_sync_link (connection_id, local_kind, local_id, calendar_remote_id, transaction_id, remote_event_id, remote_version_tag, agreed_hash, state, created_at, updated_at) VALUES (?1, 'matter_event', ?2, 'cal-court', ?2, ?2, 'v1', 'agreed', 'synced', ?3, ?3)",
      )
      .bind(connectionId, localId, stamp)
      .run();
    await firmDatabase
      .prepare(
        "INSERT OR REPLACE INTO connection_sync_issue (connection_id, local_kind, local_id, kind, state, remote_version_tag, sent_json, found_json, detected_at) VALUES (?1, 'matter_event', ?2, ?3, 'open', NULL, ?4, ?5, ?6)",
      )
      .bind(
        connectionId,
        localId,
        kind,
        JSON.stringify(sent),
        kind === "removed" ? null : JSON.stringify({ ...sent, startsAtTime: "14:00" }),
        stamp,
      )
      .run();
  }

  async function answer(cookie: string, localId: string, verb: string): Promise<Response> {
    return await app.request(
      `${ISSUES_URL}/matter_event/${localId}/${verb}`,
      { method: "POST", headers: headers(cookie) },
      PROVISIONED,
    );
  }

  async function linkOf(localId: string) {
    return await firmDatabase
      .prepare("SELECT agreed_hash FROM calendar_sync_link WHERE local_id = ?1")
      .bind(localId)
      .first<{ agreed_hash: string }>();
  }

  beforeAll(async () => {
    connectionId = (await readSettings(memberCookie)).account?.id ?? "";
    await firmDatabase.prepare("DELETE FROM connection_sync_issue").run();
  });

  it("lists the member's own open questions with both sides, and nobody else's", async () => {
    await raise("matterEvent_issue0000000001", "changed");
    const mine = await app.request(ISSUES_URL, { headers: headers(memberCookie) }, PROVISIONED);
    expect(mine.status).toBe(200);
    expect(await readJson(mine)).toEqual({
      issues: [
        {
          localKind: "matter_event",
          localId: "matterEvent_issue0000000001",
          kind: "changed",
          sent,
          found: { ...sent, startsAtTime: "14:00" },
          detectedAt: stamp,
        },
      ],
    });
    const theirs = await app.request(
      ISSUES_URL,
      { headers: headers(colleagueCookie) },
      PROVISIONED,
    );
    expect(await readJson(theirs)).toEqual({ issues: [] });
    // Another member cannot answer it either.
    expect((await answer(colleagueCookie, "matterEvent_issue0000000001", "leave")).status).toBe(
      404,
    );
  });

  it("puts a changed copy back by having the next pass write it again", async () => {
    const response = await answer(memberCookie, "matterEvent_issue0000000001", "put-back");
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ issues: [] });
    expect(await linkOf("matterEvent_issue0000000001")).toEqual({ agreed_hash: "" });
    await settleBackgroundWork();
    // Answered once. A second answer finds no open question.
    expect((await answer(memberCookie, "matterEvent_issue0000000001", "put-back")).status).toBe(
      404,
    );
  });

  it("puts a deleted copy back by forgetting it was ever sent", async () => {
    await raise("matterEvent_issue0000000002", "removed");
    expect((await answer(memberCookie, "matterEvent_issue0000000002", "put-back")).status).toBe(
      200,
    );
    expect(await linkOf("matterEvent_issue0000000002")).toBeNull();
    await settleBackgroundWork();
  });

  it("leaves a copy as the member made it, and keeps the answer", async () => {
    await raise("matterEvent_issue0000000003", "changed");
    const response = await answer(memberCookie, "matterEvent_issue0000000003", "leave");
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ issues: [] });
    expect(await linkOf("matterEvent_issue0000000003")).toEqual({ agreed_hash: "agreed" });
    const row = await firmDatabase
      .prepare("SELECT state FROM connection_sync_issue WHERE local_id = ?1")
      .bind("matterEvent_issue0000000003")
      .first<{ state: string }>();
    expect(row?.state).toBe("left");
    const audit = await firmDatabase
      .prepare(
        "SELECT COUNT(*) AS count FROM audit_log WHERE event IN ('calendar_sync.copy_put_back', 'calendar_sync.copy_left')",
      )
      .first<{ count: number }>();
    expect(audit?.count).toBe(3);
  });
});

describe("disconnecting", () => {
  it("takes the member's rules and the record of their copies with the account", async () => {
    const settings = await readSettings(memberCookie);
    expect(settings.rules.length).toBeGreaterThan(0);
    const response = await app.request(
      `${ORIGIN}/api/v1/me/connected-accounts/${settings.account?.id}`,
      { method: "DELETE", headers: headers(memberCookie) },
      PROVISIONED,
    );
    expect(response.status).toBe(200);
    const left = await firmDatabase
      .prepare(
        "SELECT (SELECT COUNT(*) FROM calendar_sync_rule) + (SELECT COUNT(*) FROM calendar_sync_link) + (SELECT COUNT(*) FROM connection_sync_issue) AS count",
      )
      .first<{ count: number }>();
    expect(left?.count).toBe(0);
  });
});
