import { env, SELF, runInDurableObject } from "cloudflare:test";
import { insertPlatformOperatorStatement } from "@magna-carta/data-access/platform-operator-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import type { MeetingRoom } from "../src/meetings/meeting-room.ts";
import { meetingSocketRequestUrl } from "../src/meetings/meeting-room.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedCredentialedUser, signInForSessionCookie } from "./support/test-auth.ts";

// THE OPERATOR'S READ INTO A LIVE ROOM — the guard, and what comes back through it.
//
// Two halves, deliberately: the ROUTE is about who may ask, and the ROOM's own `inspect()` is about
// what the answer may contain. The second is the one with a rule in it that can be broken silently —
// a session description or a display name added to the projection would pass every type check and
// every other test in this worker — so it is asserted as text as well as by field.
//
// Storage is SHARED across this file; the control-plane migrations run once.

// A well-formed handle, not a label: the route validates both the firm and the meeting against the
// identifier pattern before it addresses anything, so a readable fixture name that is the wrong
// LENGTH is refused at the door and the case never reaches the guard it is about.
const FIRM = "firm_meetingInspectFirm000";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

let meetingCounter = 0;

function freshMeeting(): { meetingId: string; stub: ReturnType<typeof roomStub> } {
  meetingCounter += 1;
  const meetingId = `meeting_inspect${String(meetingCounter).padStart(14, "0")}`;
  return { meetingId, stub: roomStub(meetingId) };
}

function roomStub(meetingId: string) {
  return env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(`${FIRM}:${meetingId}`));
}

/** A socket in the room, opened exactly as the meetings route opens one. */
async function connect(
  stub: ReturnType<typeof roomStub>,
  meetingId: string,
  attendanceId: string,
  displayName: string,
  options?: { readonly hostRole?: "host" | "co-host" | null; readonly waiting?: boolean },
): Promise<void> {
  const waiting = options?.waiting === true;
  const response = await stub.fetch(
    new Request(
      meetingSocketRequestUrl({
        firmId: FIRM,
        meetingId,
        userId: `user_${attendanceId}`,
        attendanceId,
        displayName,
        medium: "video",
        hostRole: options?.hostRole ?? null,
        locked: false,
        lobby: waiting ? "on" : "off",
        waiting,
        waitingFrom: waiting ? new Date().toISOString() : "",
      }),
      { headers: { Upgrade: "websocket" } },
    ),
  );
  expect(response.status).toBe(101);
  response.webSocket?.accept();
}

async function inspect(stub: ReturnType<typeof roomStub>) {
  return await stub.inspect();
}

describe("what one room answers an operator", () => {
  it("names who is in it, who is at the door, and the sockets carrying each stay", async () => {
    const { meetingId, stub } = freshMeeting();
    await connect(stub, meetingId, "meetingAttendance_inspectHost", "A Host", {
      hostRole: "host",
    });
    await connect(stub, meetingId, "meetingAttendance_inspectMember", "A Member");
    await connect(stub, meetingId, "meetingAttendance_inspectWaiter", "A Late Arrival", {
      waiting: true,
    });

    const report = await inspect(stub);
    expect(report.firmId).toBe(FIRM);
    expect(report.meetingId).toBe(meetingId);
    expect(report.medium).toBe("video");
    expect(report.roster.map((one) => one.participantId).toSorted()).toEqual([
      "meetingAttendance_inspectHost",
      "meetingAttendance_inspectMember",
    ]);
    expect(report.roster.find((one) => one.hostRole === "host")?.participantId).toBe(
      "meetingAttendance_inspectHost",
    );
    // A WAITER IS NOT IN THE ROSTER AND IS NOT FILTERED OUT OF IT — they are under a different key
    // entirely, which is the guarantee the whole lobby rests on. The inspect reads the same two
    // keyspaces the room does, so it cannot disagree with the room about which one somebody is in.
    expect(report.waiting.map((one) => one.participantId)).toEqual([
      "meetingAttendance_inspectWaiter",
    ]);
    // Three sockets, and the waiting one has not been welcomed — which is what stops a roster frame
    // reaching it.
    expect(report.sockets.count).toBe(3);
    expect(report.sockets.welcomed).toBe(2);
    expect(report.sockets.attendanceIds).toContain("meetingAttendance_inspectWaiter");
    expect(report.storage.keyCount).toBeGreaterThan(3);
    expect(report.storage.approximateBytes).toBeGreaterThan(0);
  });

  it("carries no display name, no track name and no session description", async () => {
    const { meetingId, stub } = freshMeeting();
    await connect(stub, meetingId, "meetingAttendance_inspectNamed", "Jane Attorney-Smith");
    // A published track written straight into the record, so the projection is asked about one
    // without this file needing the routing service.
    await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
      const key = "participant:meetingAttendance_inspectNamed";
      const stored = await state.storage.get<Record<string, unknown>>(key);
      await state.storage.put(key, {
        ...stored,
        sfuSessionId: "routing-session-inspect",
        tracks: [
          {
            trackName: "meetingAttendance_inspectNamed:camera",
            kind: "video",
            mid: "0",
          },
        ],
      });
    });

    const report = await inspect(stub);
    expect(report.roster[0]?.trackCount).toBe(1);
    expect(report.sfuSessionIds).toEqual(["routing-session-inspect"]);
    // Read as text, because this is the rule that can be broken by ADDING a field: every one of
    // these is knowable inside the room and none of it may leave it.
    const asText = JSON.stringify(report);
    expect(asText).not.toContain("Jane");
    expect(asText).not.toContain("Attorney-Smith");
    expect(asText).not.toContain("camera");
    expect(asText).not.toContain("sdp");
    expect(asText).toContain("meetingAttendance_inspectNamed");
  });

  it("says which of the alarm's deadlines the room is holding", async () => {
    const { meetingId, stub } = freshMeeting();
    await connect(stub, meetingId, "meetingAttendance_inspectAlarm", "A Member");
    expect((await inspect(stub)).alarm.pendingJobs).toEqual([]);

    // A stay whose socket has gone and whose grace is running — the deadline an operator asking
    // "why has this person not left the roster" is actually asking about.
    await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
      const key = "participant:meetingAttendance_inspectAlarm";
      const stored = await state.storage.get<Record<string, unknown>>(key);
      await state.storage.put(key, { ...stored, socketLostAt: new Date().toISOString() });
    });
    const report = await inspect(stub);
    // The socket in this test is still open, so the room is not yet counting the grace against it —
    // which is itself the right answer, and the one a bare "socketLostAt is set" read would get
    // wrong. The record says it dropped; the sockets say it came back.
    expect(report.roster[0]?.socketLostAt).not.toBeNull();
    expect(report.roster[0]?.connected).toBe(true);
    expect(report.alarm.pendingJobs).toEqual([]);
  });

  it("answers for a room nobody has ever addressed, rather than refusing", async () => {
    const empty = roomStub("meeting_inspectNeverAddressed");
    const report = await empty.inspect();
    // An empty answer IS the finding: the room the caller named has never been opened, which is a
    // different thing from a refusal and is what somebody chasing a meeting that "never started"
    // needs to be told.
    expect(report.firmId).toBeNull();
    expect(report.roster).toEqual([]);
    expect(report.storage.keyCount).toBe(0);
  });
});

describe("who may ask", () => {
  // Signed in once by the case below and reused by the one after it, in declaration order.
  let operatorCookie = "";

  function inspectUrl(meetingId: string): string {
    return `https://example.com/api/v1/meetings/${meetingId}/inspect?firmId=${FIRM}`;
  }

  async function get(meetingId: string, cookie?: string): Promise<Response> {
    return await SELF.fetch(inspectUrl(meetingId), {
      headers: { origin: "https://example.com", ...(cookie === undefined ? {} : { cookie }) },
    });
  }

  it("refuses a caller with no session at all", async () => {
    const response = await get("meeting_inspectGuardNoSession");
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("refuses a signed-in member who is not a platform operator", async () => {
    const email = "inspect-not-an-operator@example.com";
    await seedCredentialedUser(email);
    const cookie = await signInForSessionCookie(email);

    const response = await get("meeting_inspectGuardMember000", cookie);
    // A firm member reading the internals of a room would be reading a colleague's connection
    // quality and their place in the meeting. The capability does not exist to be granted.
    expect(response.status).toBe(403);
  });

  it("refuses a platform operator whose second factor is not enabled", async () => {
    const email = "inspect-operator-no-second-factor@example.com";
    const seeded = await seedCredentialedUser(email);
    const cookie = await signInForSessionCookie(email);
    await insertPlatformOperatorStatement(env.DB_CONTROL, {
      userId: seeded.userId,
      grantedByUserId: newIdentifier("user") as UserId,
      grantedAt: new Date().toISOString(),
      expiresAt: null,
      note: "meeting inspect route test, second factor absent",
    }).run();
    // Deliberately NOT raising `two_factor_enabled`, which is the whole case: the grant on its own
    // is not the authority. What this read reaches is every live meeting in the fleet — a colleague's
    // connection quality, who is in which room, who is standing at which door — so the standing rule
    // for a platform-operator surface is a grant AND a second factor, and a session that holds only
    // the first is a session an intercepted password would have.
    const response = await get("meeting_inspectGuardNoSecond0", cookie);
    expect(response.status).toBe(403);
  });

  it("answers a platform operator with two-factor authentication enabled", async () => {
    const email = "inspect-operator@example.com";
    const seeded = await seedCredentialedUser(email);
    // SIGNED IN FIRST, and the order is not incidental: Better Auth's two-factor plugin answers a
    // password sign-in for a user whose second factor is enabled with the CHALLENGE rather than a
    // session, so a fixture that raised the flag before signing in would be testing the guard
    // against a caller who never got a cookie. The guard reads the flag at request time off the
    // user row, which is what lets the two be seeded in this order at all.
    const cookie = await signInForSessionCookie(email);
    await env.DB_CONTROL.prepare("UPDATE user SET two_factor_enabled = 1 WHERE id = ?1")
      .bind(seeded.userId)
      .run();
    await insertPlatformOperatorStatement(env.DB_CONTROL, {
      userId: seeded.userId,
      grantedByUserId: newIdentifier("user") as UserId,
      grantedAt: new Date().toISOString(),
      expiresAt: null,
      note: "meeting inspect route test",
    }).run();
    operatorCookie = cookie;

    const { meetingId, stub } = freshMeeting();
    await connect(stub, meetingId, "meetingAttendance_inspectRouted", "A Member");

    const response = await get(meetingId, cookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      firmId: string;
      roster: { participantId: string }[];
      sockets: { count: number };
    };
    // Addressed by the firm the OPERATOR named, which is the one route in this family that takes
    // one — there is no session firm to read, because a platform operator belongs to no firm.
    expect(body.firmId).toBe(FIRM);
    expect(body.roster.map((one) => one.participantId)).toEqual([
      "meetingAttendance_inspectRouted",
    ]);
    expect(body.sockets.count).toBe(1);
  });

  it("leaves a record of the operator who read into the firm's meeting", async () => {
    expect(operatorCookie).not.toBe("");
    const { meetingId, stub } = freshMeeting();
    await connect(stub, meetingId, "meetingAttendance_inspectAudited", "A Member");

    expect((await get(meetingId, operatorCookie)).status).toBe(200);

    // A READ, AND RECORDED ANYWAY. Nothing else in this platform lets one person see into another
    // firm's live conversation, so an operator who looked leaves as much of a record as one who
    // changed something — on the control plane's own log, because the caller belongs to no firm and
    // the firm being read could neither explain nor attribute a row of its own.
    const { results } = await env.DB_CONTROL.prepare(
      "SELECT user_id, metadata FROM auth_audit WHERE event = ?1 ORDER BY created_at DESC",
    )
      .bind("meeting.room_inspected")
      .all<{ user_id: string | null; metadata: string | null }>();
    const mine = results.filter((row) => (row.metadata ?? "").includes(meetingId));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.user_id).not.toBeNull();
    // The firm and the meeting, and nothing else: who was in the room is what the ANSWER is, and a
    // second permanent copy of it on the audit row is the one thing this route must not leave.
    expect(JSON.parse(mine[0]?.metadata ?? "{}")).toEqual({ firmId: FIRM, meetingId });
  });

  it("refuses a firm handle that is not a well-formed identifier before it addresses anything", async () => {
    // The same cookie the case above signed in with, kept rather than signed in for again: a second
    // sign-in spends another attempt against the auth budget for a question that is not about
    // signing in.
    expect(operatorCookie).not.toBe("");
    const response = await SELF.fetch(
      "https://example.com/api/v1/meetings/meeting_inspectBadFirm0000000/inspect?firmId=not-a-handle",
      { headers: { origin: "https://example.com", cookie: operatorCookie } },
    );
    expect(response.status).toBe(422);
  });
});
