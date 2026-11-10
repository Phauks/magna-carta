import { env } from "cloudflare:test";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import type { FirmId } from "@magna-carta/identifiers/types";
import { aiProcessingEligibilityDefinition } from "@magna-carta/inference/settings";
import {
  captionsEnabledDefinition,
  RECORDED_TRACK_CEILING_MAXIMUM,
  recordedTrackCeilingDefinition,
  recordingEnabledDefinition,
  summariesEnabledDefinition,
} from "@magna-carta/meetings/settings";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  mirrorMemberWithRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The firm's meeting settings through the chokepoint over real Miniflare bindings. What the suite
// turns on:
//
//   - ONLY OWNER/ADMIN DECIDES FOR THE FIRM. An attorney may record a meeting they are running and
//     still may not switch recording on for every meeting, so the attorney is refused on both verbs.
//   - THE CEILING IS BOUNDED BY THE RECORDER'S MEMORY, and a value past it is a 422, never a clamp.
//   - EVERY WRITE IS ONE AUDIT ROW, a retried one is a replay, and an empty patch is nothing.
//   - WHAT THIS WRITES IS WHAT THE READERS READ: the generic firm-setting accessor the start route,
//     the recorder and the summary consumer use returns exactly what the route stored.
//   - THE DEPLOYMENT'S OWN READINESS IS STATED, read from bindings, so a firm that switched
//     recording on can be told it still cannot start.

const app = createApp();
const base = "https://example.com";
const SETTINGS_PATH = "/api/v1/firm/meetings/settings";

// A deployment that can record: media routing credentials and a sink signing key, beside the
// recorder binding and the origin the test pool's configuration already carries.
const RECORDING_DEPLOYMENT = {
  ...env,
  REALTIME_SFU_APP_ID: "test-realtime-application",
  REALTIME_SFU_APP_SECRET: "test-realtime-secret",
  MEETING_SINK_SIGNING_KEY: "meeting-settings-test-signing-key",
};

interface MeetingSettings {
  recordingEnabled: boolean;
  captionsEnabled: boolean;
  summariesEnabled: boolean;
  recordedTrackCeiling: number;
  recordedTrackCeilingMaximum: number;
  recordingServiceConfigured: boolean;
  aiProcessingEligible: boolean;
}

let firmId: FirmId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let ownerCookie: string;
let attorneyCookie: string;

async function request(
  method: "GET" | "PATCH",
  cookie: string,
  body?: unknown,
  options: { idempotencyKey?: string; environment?: typeof env } = {},
): Promise<Response> {
  const headers: Record<string, string> = { cookie };
  if (method === "PATCH") {
    headers["idempotency-key"] = options.idempotencyKey ?? crypto.randomUUID();
    headers["content-type"] = "application/json";
    headers.origin = base;
  }
  return await app.request(
    `${base}${SETTINGS_PATH}`,
    { method, headers, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) },
    options.environment ?? env,
  );
}

async function settingsAudits(): Promise<Array<{ actor_user_id: string; metadata: string }>> {
  const { results } = await firmDatabase
    .prepare(
      "SELECT actor_user_id, metadata FROM audit_log WHERE event = 'firm.meeting_settings_updated' ORDER BY created_at, rowid",
    )
    .all<{ actor_user_id: string; metadata: string }>();
  return results;
}

let ownerUserId: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Meeting Settings Test Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("meeting-settings-owner@example.com", {
    userName: "Settings Owner",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Settings Owner", firmId);
  ownerCookie = await signInForSessionCookie("meeting-settings-owner@example.com");

  // The seat that holds meetings:record and meetings:host by seed: the strongest member who must
  // still not decide for the whole firm.
  const attorney = await seedCredentialedUser("meeting-settings-attorney@example.com", {
    userName: "Settings Attorney",
    firmId,
  });
  await mirrorMemberWithRole(attorney.userId, "Settings Attorney", firmId, "Attorney");
  attorneyCookie = await signInForSessionCookie("meeting-settings-attorney@example.com");
});

describe("the firm's meeting settings", () => {
  it("reads every switch off and the ceiling at its maximum where the firm has set nothing", async () => {
    const response = await request("GET", ownerCookie);
    expect(response.status).toBe(200);
    expect(await response.json<MeetingSettings>()).toEqual({
      recordingEnabled: false,
      captionsEnabled: false,
      summariesEnabled: false,
      recordedTrackCeiling: RECORDED_TRACK_CEILING_MAXIMUM,
      recordedTrackCeilingMaximum: RECORDED_TRACK_CEILING_MAXIMUM,
      recordingServiceConfigured: false,
      aiProcessingEligible: false,
    });
  });

  it("states the recorder's memory ceiling as eleven", () => {
    // The screen says "at most 11" from the read; the number is arithmetic over the recorder's
    // memory in packages/meetings/src/settings.ts, and a change to that arithmetic is a change to
    // what the firm is told.
    expect(RECORDED_TRACK_CEILING_MAXIMUM).toBe(11);
  });

  it("refuses an attorney who may record a meeting, on the read and the write alike", async () => {
    expect((await request("GET", attorneyCookie)).status).toBe(403);
    const response = await request("PATCH", attorneyCookie, { recordingEnabled: true });
    expect(response.status).toBe(403);
    expect(await readFirmSetting(firmDatabase, recordingEnabledDefinition)).toBe(false);
  });

  it("says the recording service is configured only where the deployment can record", async () => {
    const unconfigured = await (await request("GET", ownerCookie)).json<MeetingSettings>();
    expect(unconfigured.recordingServiceConfigured).toBe(false);
    const configured = await (
      await request("GET", ownerCookie, undefined, { environment: RECORDING_DEPLOYMENT })
    ).json<MeetingSettings>();
    expect(configured.recordingServiceConfigured).toBe(true);
  });

  it("switches recording on and leaves the rest, with one audit row naming the actor", async () => {
    const before = (await settingsAudits()).length;
    const response = await request("PATCH", ownerCookie, { recordingEnabled: true });
    expect(response.status).toBe(200);
    const body = await response.json<MeetingSettings>();
    expect(body.recordingEnabled).toBe(true);
    expect(body.captionsEnabled).toBe(false);
    expect(body.summariesEnabled).toBe(false);

    const audits = await settingsAudits();
    expect(audits).toHaveLength(before + 1);
    const row = audits.at(-1);
    expect(row?.actor_user_id).toBe(ownerUserId);
    // The metadata is the patch as submitted, nothing more.
    expect(JSON.parse(row?.metadata ?? "null")).toEqual({ recordingEnabled: true });
  });

  it("round-trips every setting: the write, the next read, and the accessor the readers use", async () => {
    const response = await request("PATCH", ownerCookie, {
      recordingEnabled: true,
      captionsEnabled: true,
      summariesEnabled: true,
      recordedTrackCeiling: 6,
    });
    expect(response.status).toBe(200);

    const read = await (await request("GET", ownerCookie)).json<MeetingSettings>();
    expect(read).toMatchObject({
      recordingEnabled: true,
      captionsEnabled: true,
      summariesEnabled: true,
      recordedTrackCeiling: 6,
    });
    // The start route, the recorder and the summary consumer all read through this accessor, so
    // the route is a writer of what they read rather than of a parallel copy.
    expect(await readFirmSetting(firmDatabase, recordingEnabledDefinition)).toBe(true);
    expect(await readFirmSetting(firmDatabase, captionsEnabledDefinition)).toBe(true);
    expect(await readFirmSetting(firmDatabase, summariesEnabledDefinition)).toBe(true);
    expect(await readFirmSetting(firmDatabase, recordedTrackCeilingDefinition)).toBe(6);

    // And back off: off is a stored answer, not the absence of one.
    const off = await request("PATCH", ownerCookie, { summariesEnabled: false });
    expect((await off.json<MeetingSettings>()).summariesEnabled).toBe(false);
    expect(await readFirmSetting(firmDatabase, summariesEnabledDefinition)).toBe(false);
  });

  it("reports the AI processing gate a summary also needs, and never writes it", async () => {
    expect(
      (await (await request("GET", ownerCookie)).json<MeetingSettings>()).aiProcessingEligible,
    ).toBe(false);
    await writeFirmSettingStatement(
      firmDatabase,
      aiProcessingEligibilityDefinition,
      true,
      new Date().toISOString(),
    ).run();
    expect(
      (await (await request("GET", ownerCookie)).json<MeetingSettings>()).aiProcessingEligible,
    ).toBe(true);
    // A patch naming the gate is not this route's to honour: the field is not in its contract.
    await request("PATCH", ownerCookie, { aiProcessingEligible: false, captionsEnabled: false });
    expect(await readFirmSetting(firmDatabase, aiProcessingEligibilityDefinition)).toBe(true);
  });

  it("accepts the ceiling's two bounds and refuses everything outside them", async () => {
    expect((await request("PATCH", ownerCookie, { recordedTrackCeiling: 1 })).status).toBe(200);
    expect(
      (
        await request("PATCH", ownerCookie, {
          recordedTrackCeiling: RECORDED_TRACK_CEILING_MAXIMUM,
        })
      ).status,
    ).toBe(200);
    const before = (await settingsAudits()).length;
    const refusals = await Promise.all(
      [0, -1, RECORDED_TRACK_CEILING_MAXIMUM + 1, 32, 1.5, "6"].map((refused) =>
        request("PATCH", ownerCookie, { recordedTrackCeiling: refused }),
      ),
    );
    for (const response of refusals) {
      expect(response.status).toBe(422);
      expect(response.headers.get("content-type")).toContain("application/problem+json");
    }
    expect(await readFirmSetting(firmDatabase, recordedTrackCeilingDefinition)).toBe(
      RECORDED_TRACK_CEILING_MAXIMUM,
    );
    expect(await settingsAudits()).toHaveLength(before);
  });

  it("refuses a switch that is not a boolean", async () => {
    expect((await request("PATCH", ownerCookie, { recordingEnabled: "yes" })).status).toBe(422);
  });

  it("replays a retried write rather than recording it twice", async () => {
    const before = (await settingsAudits()).length;
    const key = crypto.randomUUID();
    const body = { recordedTrackCeiling: 4 };
    const first = await request("PATCH", ownerCookie, body, { idempotencyKey: key });
    const second = await request("PATCH", ownerCookie, body, { idempotencyKey: key });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await settingsAudits()).toHaveLength(before + 1);
  });

  it("writes nothing and audits nothing for an empty patch", async () => {
    const before = (await settingsAudits()).length;
    const response = await request("PATCH", ownerCookie, {});
    expect(response.status).toBe(200);
    expect(await settingsAudits()).toHaveLength(before);
  });
});
