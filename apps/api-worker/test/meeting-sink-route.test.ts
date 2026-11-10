import { env } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import type { RecorderStartInput } from "../src/meetings/meeting-recorder.ts";
import { setSfuFetchForTests } from "../src/meetings/sfu/sfu-client.ts";
import {
  MEETING_SINK_PATH_PREFIX,
  MEETING_SINK_SOCKET_PROTOCOL,
  mintSinkToken,
  setMeetingSinkSigningKeyForTests,
  type MeetingSinkClaims,
} from "../src/meetings/sink-token.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  fakeAdapterService,
  seedMemberIn,
  seedRecordedMeeting,
  seedRoomRoster,
  seedRunningRecording,
  sinkClaimsFor,
  type AdapterCall,
  type SeededTrack,
} from "./support/meeting-recording-fixture.ts";
import { seedFirmRow } from "./support/test-auth.ts";

// THE SECURITY SURFACE: the one route on this Worker that admits a caller with no session at all.
//
// The routing service dials `/internal/meeting-audio/<token>` (or offers the token as the subprotocol
// pair `meeting-sink, <token>`), and what decides whether that socket reaches a recorder is the
// token's signature, its expiry, the firm it names, the record — the recording must still be running
// and the track ROW still open — and the recorder, which takes one socket per track and only for the
// adapter it opened last. Every refusal is the same bare 404 so a
// caller who is not the routing service learns nothing by asking. Two refusals come before the token
// is looked at, because they are about the request: any Origin at all (a page, on any site including
// this one, must never reach this path) and a request that is not an upgrade.

const SIGNING_KEY = "meeting-sink-route-test-signing-key";
const app = createApp();

let firmId: FirmId;
let calls: AdapterCall[] = [];

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = newIdentifier("firm") as FirmId;
  await seedFirmRow(firmId);
  setMeetingSinkSigningKeyForTests(SIGNING_KEY);
});

afterAll(() => {
  setSfuFetchForTests(null);
  setMeetingSinkSigningKeyForTests(null);
});

beforeEach(() => {
  calls = [];
  setSfuFetchForTests(fakeAdapterService(calls));
});

/** A recording with one track, its recorder started — and the address the routing service was given. */
async function startedTrack(): Promise<{
  recordingId: string;
  track: SeededTrack;
  endpoint: URL;
  claims: MeetingSinkClaims & { readonly token: string };
}> {
  const meeting = await seedRecordedMeeting(firmId);
  const member = await seedMemberIn(firmId, "A Member");
  const { recordingId, tracks, startedAt } = await seedRunningRecording(meeting, [member]);
  await seedRoomRoster(meeting, tracks);
  const track = tracks[0]!;
  const input: RecorderStartInput = {
    firmId,
    meetingId: meeting.meetingId,
    matterId: meeting.matterId,
    recordingId: recordingId,
    startedAt,
    ceiling: 32,
    tracks: [
      {
        trackId: track.trackId,
        trackName: track.trackName,
        sessionId: track.sessionId,
        participantKind: "member",
        participantId: track.participantId,
        userId: track.userId,
      },
    ],
  };
  await env
    .MEETING_RECORDER!.get(env.MEETING_RECORDER!.idFromName(`${firmId}:${recordingId}`))
    .start(input);
  const opened = calls.find((call) => call.path.endsWith("/adapters/websocket/new"));
  const [request] = (opened?.body["tracks"] ?? []) as { endpoint: string }[];
  const claims = await sinkClaimsFor(calls, track.trackName, SIGNING_KEY);
  return { recordingId, track, endpoint: new URL(request?.endpoint ?? ""), claims };
}

async function dial(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return await app.request(
    `https://magnacarta.esq${path}`,
    { headers: { Upgrade: "websocket", ...headers } },
    env,
  );
}

describe("the socket the routing service dials", () => {
  it("upgrades on a valid token, for a running recording and an open track", async () => {
    const { endpoint } = await startedTrack();
    const response = await dial(endpoint.pathname);
    expect(response.status).toBe(101);
    expect(response.webSocket).toBeTruthy();
    response.webSocket?.accept();
    response.webSocket?.close(1000, "done");
  });

  it("refuses a request carrying ANY Origin, this application's own included, before reading the token", async () => {
    const { endpoint } = await startedTrack();
    for (const origin of ["https://magnacarta.esq", "https://elsewhere.example"]) {
      const response = await dial(endpoint.pathname, { origin });
      expect(response.status).toBe(403);
      expect(await response.text()).toBe("");
    }
  });

  it("answers 426 to a request that is not an upgrade", async () => {
    const { endpoint } = await startedTrack();
    const response = await app.request(`https://magnacarta.esq${endpoint.pathname}`, {}, env);
    expect(response.status).toBe(426);
  });

  it("takes the token from the subprotocol, answering with the bare protocol name and never the token", async () => {
    const { claims } = await startedTrack();
    const response = await dial("/internal/meeting-audio", {
      "sec-websocket-protocol": `${MEETING_SINK_SOCKET_PROTOCOL}, ${claims.token}`,
    });
    expect(response.status).toBe(101);
    expect(response.headers.get("sec-websocket-protocol")).toBe(MEETING_SINK_SOCKET_PROTOCOL);
    response.webSocket?.accept();
    response.webSocket?.close(1000, "done");
  });

  it("refuses two different tokens on one request, one in the path and one in the subprotocol", async () => {
    const { endpoint } = await startedTrack();
    const other = await startedTrack();
    const response = await dial(endpoint.pathname, {
      "sec-websocket-protocol": `${MEETING_SINK_SOCKET_PROTOCOL}, ${other.claims.token}`,
    });
    expect(response.status).toBe(404);
  });

  it("refuses a second dial against a track whose socket is live", async () => {
    const { endpoint } = await startedTrack();
    const first = await dial(endpoint.pathname);
    expect(first.status).toBe(101);
    first.webSocket?.accept();
    const second = await dial(endpoint.pathname);
    expect(second.status).toBe(404);
    expect(await second.text()).toBe("");
    first.webSocket?.close(1000, "done");
  });

  it("refuses a token naming the right track row with an adapter the recorder never opened", async () => {
    const { claims } = await startedTrack();
    const token = await mintSinkToken(SIGNING_KEY, {
      firmId,
      recordingId: claims.recordingId,
      trackId: claims.trackId,
      adapterNonce: "an-adapter-that-was-never-opened",
      expiresAt: Date.now() + 60_000,
    });
    expect((await dial(`${MEETING_SINK_PATH_PREFIX}${token}`)).status).toBe(404);
  });

  it("refuses an expired token", async () => {
    const { claims } = await startedTrack();
    const token = await mintSinkToken(SIGNING_KEY, {
      firmId,
      recordingId: claims.recordingId,
      trackId: claims.trackId,
      adapterNonce: claims.adapterNonce,
      expiresAt: Date.now() - 1_000,
    });
    expect((await dial(`${MEETING_SINK_PATH_PREFIX}${token}`)).status).toBe(404);
  });

  it("refuses a token this Worker did not sign, and one that is not a token at all", async () => {
    const { claims } = await startedTrack();
    const forged = await mintSinkToken("a-key-this-deployment-does-not-hold", {
      firmId,
      recordingId: claims.recordingId,
      trackId: claims.trackId,
      adapterNonce: claims.adapterNonce,
      expiresAt: Date.now() + 60_000,
    });
    expect((await dial(`${MEETING_SINK_PATH_PREFIX}${forged}`)).status).toBe(404);
    expect((await dial(`${MEETING_SINK_PATH_PREFIX}not-a-token`)).status).toBe(404);
  });

  it("refuses a token for a recording that has settled", async () => {
    const { recordingId, endpoint } = await startedTrack();
    await firmDatabaseFor(env.FIRM_DATABASE, firmId)
      .prepare(
        `UPDATE meeting_recording SET state = 'composing', stopped_at = ?2, stop_reason = 'member' WHERE id = ?1`,
      )
      .bind(recordingId, new Date().toISOString())
      .run();
    expect((await dial(endpoint.pathname)).status).toBe(404);
  });

  it("refuses a token for a track that is no longer open", async () => {
    const { recordingId, track, endpoint } = await startedTrack();
    await firmDatabaseFor(env.FIRM_DATABASE, firmId)
      .prepare(
        `UPDATE meeting_recording_track SET state = 'lost' WHERE recording_id = ?1 AND track_name = ?2`,
      )
      .bind(recordingId, track.trackName)
      .run();
    expect((await dial(endpoint.pathname)).status).toBe(404);
  });

  it("refuses a token naming ANOTHER firm, which reaches that firm's record and finds nothing", async () => {
    const { claims } = await startedTrack();
    const otherFirm = newIdentifier("firm") as FirmId;
    await seedFirmRow(otherFirm);
    const token = await mintSinkToken(SIGNING_KEY, {
      firmId: otherFirm,
      recordingId: claims.recordingId,
      trackId: claims.trackId,
      adapterNonce: claims.adapterNonce,
      expiresAt: Date.now() + 60_000,
    });
    expect((await dial(`${MEETING_SINK_PATH_PREFIX}${token}`)).status).toBe(404);
  });

  it("refuses everything where this deployment holds no signing key", async () => {
    const { endpoint } = await startedTrack();
    setMeetingSinkSigningKeyForTests(null);
    try {
      expect((await dial(endpoint.pathname)).status).toBe(404);
    } finally {
      setMeetingSinkSigningKeyForTests(SIGNING_KEY);
    }
  });
});
