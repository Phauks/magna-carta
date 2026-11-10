import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { readSinkTrackById } from "@magna-carta/meetings/recording-statements";
import { meetingRecordingSinkRefused } from "@magna-carta/telemetry/events";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import type { Bindings } from "../bindings.ts";
import type { AppVariables } from "../http/chokepoint/ports.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import { captionerFor } from "./caption-binding.ts";
import { verifyCaptionSinkToken } from "./caption-sink-token.ts";
import { realtimeLoggerFor } from "./sfu/realtime-failure.ts";
import {
  MEETING_SINK_PATH_PREFIX,
  MEETING_SINK_SOCKET_PROTOCOL,
  sinkSigningKeyForEnv,
  sinkTokenFromSocketProtocols,
  verifySinkToken,
} from "./sink-token.ts";
import { isWebSocketUpgrade } from "../progress/job-progress-sockets.ts";

// THE SOCKET THE ROUTING SERVICE DIALS: `GET /internal/meeting-audio/{sinkToken}`, a WebSocket upgrade
// that hands one recorded track's audio to the recorder that asked for it. The same token is taken
// from the `Sec-WebSocket-Protocol` pair `meeting-sink, <token>` (on the bare `/internal/meeting-audio`
// as well), answered `meeting-sink`, so the token can leave the address once the live adapter is shown
// to offer a subprotocol; the path is still what the recorder hands out.
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
// firm's recording, that names a settled one, that an earlier adapter carried, or that dials a track
// whose socket is still live is the same 404 with no body: a caller that is not
// the routing service learns nothing by asking. The token itself is never logged, counted or echoed;
// the event records only which of the four kinds of refusal it was.
//
// THE SAME ADDRESS CARRIES A CAPTION SESSION'S AUDIO. A token signed as a caption sink token
// (meetings/caption-sink-token.ts, its own `typ` under the same secret) names a meeting and a stay rather
// than a recording and a track, and is forwarded to that meeting's captioner instead. There is no row to
// read back for it — a caption session is not a record — so the captioner is the authority on whether
// that stay's session is open and this is its adapter, and refuses anything else with the same bare 404.
// One address for both, because the adapter is one mechanism and the zone route that reaches this path
// is one operator step.
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

/**
 * The answer to the routing service, from the object that took (or refused) its socket. The object's
 * own refusal — an earlier adapter's token, a second dial against a live socket, a session that is not
 * open — is the same bare 404 as every other, recorded as a token that no longer opens anything. A
 * client that offered subprotocols fails a handshake whose answer names none of them, so the answer
 * names the bare protocol — never the token.
 */
function answerUpgrade(env: Bindings, upgraded: Response, offeredProtocolToken: string | null) {
  if (upgraded.status !== 101) return refuse(env, "token", 404);
  if (offeredProtocolToken === null) return upgraded;
  const headers = new Headers(upgraded.headers);
  headers.set("sec-websocket-protocol", MEETING_SINK_SOCKET_PROTOCOL);
  return new Response(null, { status: 101, webSocket: upgraded.webSocket, headers });
}

export function registerMeetingSinkRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
): void {
  const handler = async (c: Context<{ Bindings: Bindings; Variables: AppVariables }>) => {
    // A page cannot set or suppress Origin on a WebSocket, so its presence is the browser's signature.
    if (c.req.header("origin") !== undefined) return refuse(c.env, "origin", 403);
    if (!isWebSocketUpgrade(c.req.raw)) return refuse(c.env, "upgrade", 426);

    const key = sinkSigningKeyForEnv(c.env);
    // A deployment that signs no addresses has nothing to admit, and says so the way every other
    // refusal here does.
    if (key === null) return refuse(c.env, "token", 404);
    const offeredProtocolToken = sinkTokenFromSocketProtocols(
      c.req.header("sec-websocket-protocol"),
    );
    const pathToken = new URL(c.req.url).pathname.slice(MEETING_SINK_PATH_PREFIX.length);
    // The path is the address the recorder hands out, so it is read first; the subprotocol answers
    // only when the path carries nothing. Two DIFFERENT tokens on one request is not something the
    // routing service would send, and neither is believed.
    if (pathToken !== "" && offeredProtocolToken !== null && offeredProtocolToken !== pathToken) {
      return refuse(c.env, "token", 404);
    }
    const token = pathToken !== "" ? pathToken : (offeredProtocolToken ?? "");
    const claims = await verifySinkToken(key, token, Date.now());
    if (claims === null) {
      const captionClaims = await verifyCaptionSinkToken(key, token, Date.now());
      if (captionClaims === null) return refuse(c.env, "token", 404);
      const captioner = captionerFor(c.env, captionClaims.firmId, captionClaims.meetingId);
      if (captioner === null) return refuse(c.env, "token", 404);
      const inward = new URL("https://meeting-captioner.invalid/sink");
      inward.searchParams.set("participant", captionClaims.participantId);
      inward.searchParams.set("adapter", captionClaims.adapterNonce);
      return answerUpgrade(
        c.env,
        await captioner.fetch(
          new Request(inward.toString(), { headers: { Upgrade: "websocket" } }),
        ),
        offeredProtocolToken,
      );
    }
    // A deployment that cannot record has no recorder to hand a recording's socket to.
    const recorders = c.env.MEETING_RECORDER;
    if (recorders === undefined) return refuse(c.env, "token", 404);

    // THE RECORD, AFTER THE SIGNATURE: still running, and this track ROW still open. The platform's
    // own read — the routing service is not a member and there is no visibility to compose.
    const database = firmDatabaseFor(c.env.FIRM_DATABASE, claims.firmId);
    const sink = await readSinkTrackById(database, claims.recordingId, claims.trackId);
    if (sink?.recordingState !== "recording" || sink.trackState !== "open") {
      return refuse(c.env, "settled", 404);
    }

    // Built from the verified claims and nothing the caller sent, so no header the routing service
    // supplied — nor anything a forger might have — travels on to the recorder. The recorder checks the
    // adapter nonce against the one it holds and refuses a dial against a socket that is still live.
    const inward = new URL("https://meeting-recorder.invalid/sink");
    inward.searchParams.set("track", claims.trackId);
    inward.searchParams.set("adapter", claims.adapterNonce);
    const recorder = recorders.get(recorders.idFromName(`${claims.firmId}:${claims.recordingId}`));
    const upgraded = await recorder.fetch(
      new Request(inward.toString(), { headers: { Upgrade: "websocket" } }),
    );
    return answerUpgrade(c.env, upgraded, offeredProtocolToken);
  };
  // Registered as literal paths so the worker-first routing scan can match them against the
  // `/internal/*` family the Worker is routed.
  app.get("/internal/meeting-audio/:sinkToken", handler);
  app.get("/internal/meeting-audio", handler);
}
