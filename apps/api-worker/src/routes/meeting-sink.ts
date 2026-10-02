import type { OpenAPIHono } from "@hono/zod-openapi";
import { readSinkTrack } from "@magna-carta/meetings/recording-statements";
import { meetingRecordingSinkRefused } from "@magna-carta/telemetry/events";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import type { Bindings } from "../app.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import { realtimeLoggerFor } from "../meetings/sfu/realtime-failure.ts";
import {
  MEETING_SINK_PATH_PREFIX,
  sinkSigningKeyForEnv,
  verifySinkToken,
} from "../meetings/sink-token.ts";
import { isWebSocketUpgrade } from "../progress/job-progress-sockets.ts";

// THE SOCKET THE ROUTING SERVICE DIALS: `GET /internal/meeting-audio/{sinkToken}`, a WebSocket upgrade
// that hands one recorded track's audio to the recorder that asked for it.
//
// OUTSIDE THE CHOKEPOINT, for the reason the WOPI and search-object surfaces are: the caller is a
// Cloudflare service with no session, no cookie and no membership of anything. What admits it is the
// address itself — a token the recorder signed for one track of one recording (meetings/sink-token.ts)
// — and then the record: the recording must still be running and the track still open, so a token for
// a settled recording opens nothing however validly it was signed.
//
// THE MIRROR IMAGE OF THE MEETING SOCKET'S ORIGIN RULE. The meeting socket refuses a FOREIGN Origin,
// because a browser sends one and a page on another site must not reach a member's signaling with
// their cookie. The routing service is not a browser and sends no Origin at all, so this route refuses
// a request that carries ANY Origin — which keeps every page, on any site including this one, from
// ever reaching this path. It is asked first, before the token is even looked at, because it is a
// question about the request rather than about anything the token names.
//
// EVERY REFUSAL SAYS AS LITTLE AS IT CAN. A token that is not one, that expired, that names another
// firm's recording, or that names a settled one is the same 404 with no body: a caller that is not
// the routing service learns nothing by asking. The token itself is never logged, counted or echoed;
// the event records only which of the four kinds of refusal it was.
//
// A FIRM IS NAMED BY THE TOKEN AND ONLY BY THE TOKEN. The recorder is addressed `${firmId}:${recordingId}`
// from the verified claims, so a token minted for one firm reaches that firm's recorder and nothing
// else — the same scoping every Durable Object this Worker addresses keeps.

/** Records which kind of refusal it was, and nothing else about the request. */
function refuse(env: Bindings, reason: "origin" | "upgrade" | "token" | "settled", status: number) {
  try {
    realtimeLoggerFor(env).log(
      meetingRecordingSinkRefused(
        { correlationId: newCorrelationId(), now: new Date().toISOString() },
        { reason },
      ),
    );
  } catch {
    // Telemetry never costs a refusal anything.
  }
  return new Response(null, { status });
}

export function registerMeetingSinkRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
): void {
  // Registered as a literal path so the worker-first routing scan can match it against the
  // `/internal/*` family the Worker is routed.
  app.get("/internal/meeting-audio/:sinkToken", async (c) => {
    // A page cannot set or suppress Origin on a WebSocket, so its presence is the browser's signature.
    if (c.req.header("origin") !== undefined) return refuse(c.env, "origin", 403);
    if (!isWebSocketUpgrade(c.req.raw)) return refuse(c.env, "upgrade", 426);

    const key = sinkSigningKeyForEnv(c.env);
    const recorders = c.env.MEETING_RECORDER;
    // A deployment that cannot record has no recorder to hand a socket to, and says so the way every
    // other refusal here does.
    if (key === null || recorders === undefined) return refuse(c.env, "token", 404);
    const token = new URL(c.req.url).pathname.slice(MEETING_SINK_PATH_PREFIX.length);
    const claims = await verifySinkToken(key, token, Date.now());
    if (claims === null) return refuse(c.env, "token", 404);

    // THE RECORD, AFTER THE SIGNATURE: still running, and this track still open. The platform's own
    // read — the routing service is not a member and there is no visibility to compose.
    const database = firmDatabaseFor(c.env.FIRM_DATABASE, claims.firmId);
    const sink = await readSinkTrack(database, claims.recordingId, claims.trackName);
    if (sink === undefined || sink.recordingState !== "recording" || sink.trackState !== "open") {
      return refuse(c.env, "settled", 404);
    }

    // Built from the verified claims and nothing the caller sent, so no header the routing service
    // supplied — nor anything a forger might have — travels on to the recorder.
    const inward = new URL("https://meeting-recorder.invalid/sink");
    inward.searchParams.set("track", claims.trackName);
    const recorder = recorders.get(recorders.idFromName(`${claims.firmId}:${claims.recordingId}`));
    return await recorder.fetch(
      new Request(inward.toString(), { headers: { Upgrade: "websocket" } }),
    );
  });
}
