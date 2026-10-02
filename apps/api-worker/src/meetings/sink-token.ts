import type {
  FirmId,
  MeetingRecordingId,
  MeetingRecordingTrackId,
} from "@magna-carta/identifiers/types";
import { isIdentifier } from "@magna-carta/identifiers/validate";
import type { Bindings } from "../app.ts";
import { mintSignedToken, verifySignedToken } from "../signed-token.ts";
import { runningUnderTest } from "./sfu/sfu-client.ts";

// THE CREDENTIAL THE ROUTING SERVICE DIALS A RECORDER WITH — one per ADAPTER, on the one signed-token
// format this Worker uses (../signed-token.ts), with its own `typ` and its OWN SECRET.
//
// The routing service's WebSocket adapter dials a `wss://` address we name and documents no header,
// no token and no query mechanism for authenticating that socket. So the address IS the credential:
// `/internal/meeting-audio/<token>`, where the token names the firm, the recording, the track ROW and
// the adapter, and carries its own expiry, signed so the sink route can refuse anything this Worker did
// not mint without a database read. The route then asks the record whether that recording is still
// running and that track still open — the signature proves who minted the token, and the record proves
// it still means something.
//
// THE SAME TOKEN MAY ALSO RIDE THE SOCKET'S SUBPROTOCOL (`meeting-sink`, then the token), answered with
// the bare protocol name, so a later change can move it out of the address — the one place a credential
// is most likely to be written down — once the live adapter is shown to offer a subprotocol. Until that
// is proven the path stays the address the recorder hands out.
//
// BOUND TO ONE TRACK ROW AND ONE ADAPTER. The track is named by the row the server minted, never by the
// track name a browser chose. The adapter is named by a nonce the recorder mints each time it opens one
// and keeps beside the track: a reopened track gets a new adapter and a new nonce, so the token an
// EARLIER adapter carried opens nothing any more, however long its expiry has left. And the recorder
// takes one socket per track: a dial against a track whose socket is live is refused, because the
// routing service dials again only after a drop.
//
// ITS OWN SECRET, `MEETING_SINK_SIGNING_KEY`, rather than `AUTH_SECRET`: the token rides an address,
// so the secret that signs it must be one whose rotation costs nothing but the recordings running at
// that moment, rather than every session and every guest link the Worker has issued.
//
// SHORT-LIVED. It lives as long as a recording may run plus a margin, because the routing service
// reconnects to the SAME address after a dropped socket and a token that expired mid-meeting would end
// the track.
//
// NEVER LOGGED, COUNTED, ECHOED OR STORED: no telemetry field holds it and no problem carries it.

/** The token's `typ`, which is what stops any other token this Worker signs from passing as one. */
export const MEETING_SINK_TOKEN_TYPE = "meeting-sink";

/** The address the routing service dials, before the token. Outside `/api`, outside the chokepoint. */
export const MEETING_SINK_PATH_PREFIX = "/internal/meeting-audio/";

/**
 * HOW LONG A RECORDING MAY RUN. The recorder stops a recording that reaches it (`ceiling`), and no
 * token it issues outlives it; a deposition that runs longer is a second recording, which it should be
 * anyway.
 */
export const MAXIMUM_RECORDING_HOURS = 12;

/** A token lives as long as a recording may, and an hour more for a dial that arrives late. */
export const SINK_TOKEN_LIFETIME_MILLISECONDS = (MAXIMUM_RECORDING_HOURS + 1) * 60 * 60 * 1000;

/**
 * The subprotocol a sink token may ride instead of the path: offered as this name and then the token,
 * and answered with this name alone, so the token never comes back in a response header.
 */
export const MEETING_SINK_SOCKET_PROTOCOL = "meeting-sink";

/** What a sink token names. */
export interface MeetingSinkClaims {
  readonly firmId: FirmId;
  readonly recordingId: MeetingRecordingId;
  // The track ROW, which the server minted — never the track name, which a browser chose.
  readonly trackId: MeetingRecordingTrackId;
  // The adapter this token was minted for; the recorder rotates it whenever it opens another.
  readonly adapterNonce: string;
  // Milliseconds since the epoch: an instant, and one the verifier compares without parsing a string.
  readonly expiresAt: number;
}

// A test-only signing key, installed through a seam with exactly the posture of the routing service's
// fake (sfu/sfu-client.ts): a Durable Object is constructed with the deployment's own environment, so
// a test cannot hand the recorder an environment of its own, and a placeholder put into a shared
// environment file would make every suite look configured. Inert outside a test runner.
let testSigningKey: string | null = null;

/** Installs (or, with null, removes) a signing key for the duration of a test. */
export function setMeetingSinkSigningKeyForTests(key: string | null): void {
  testSigningKey = key;
}

/**
 * The key this deployment signs sink tokens with, or null when it has none — in which case recording
 * is not configured and the start route answers 503. The environment is read FIRST and the seam only
 * afterwards, so a deployment's answer is never decided by a module variable.
 */
export function sinkSigningKeyForEnv(env: Bindings): string | null {
  const configured = env.MEETING_SINK_SIGNING_KEY;
  if (configured !== undefined && configured !== "") return configured;
  if (testSigningKey !== null && runningUnderTest()) return testSigningKey;
  return null;
}

/** Signs one track's sink token. */
export async function mintSinkToken(key: string, claims: MeetingSinkClaims): Promise<string> {
  return await mintSignedToken(key, MEETING_SINK_TOKEN_TYPE, {
    firmId: claims.firmId,
    recordingId: claims.recordingId,
    trackId: claims.trackId,
    adapterNonce: claims.adapterNonce,
    expiresAt: claims.expiresAt,
  });
}

/**
 * The claims of a token this Worker signed as a sink token and that has not expired, or null. Every
 * failure — shape, signature, kind, expiry, a malformed handle — answers the same null, and the route
 * answers every null the same way.
 */
export async function verifySinkToken(
  key: string,
  token: string,
  now: number,
): Promise<MeetingSinkClaims | null> {
  const payload = await verifySignedToken(key, token, MEETING_SINK_TOKEN_TYPE);
  if (payload === null) return null;
  const { firmId, recordingId, trackId, adapterNonce, expiresAt } = payload;
  if (typeof firmId !== "string" || !isIdentifier(firmId, "firm")) return null;
  if (typeof recordingId !== "string" || !isIdentifier(recordingId, "meetingRecording"))
    return null;
  if (typeof trackId !== "string" || !isIdentifier(trackId, "meetingRecordingTrack")) return null;
  if (typeof adapterNonce !== "string" || adapterNonce === "") return null;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= now) return null;
  return {
    firmId: firmId as FirmId,
    recordingId: recordingId as MeetingRecordingId,
    trackId: trackId as MeetingRecordingTrackId,
    adapterNonce,
    expiresAt,
  };
}

/**
 * The token an upgrade offered as its subprotocol (`meeting-sink`, then the token), or null when it
 * offered none. Only the two-entry form: it is the one whose answer — the bare protocol name — never
 * echoes the credential.
 */
export function sinkTokenFromSocketProtocols(offered: string | undefined | null): string | null {
  if (offered === undefined || offered === null || offered === "") return null;
  const protocols = offered
    .split(",")
    .map((protocol) => protocol.trim())
    .filter((protocol) => protocol !== "");
  const named = protocols.indexOf(MEETING_SINK_SOCKET_PROTOCOL);
  if (named < 0) return null;
  const token = protocols[named + 1];
  return token === undefined || token === "" ? null : token;
}

/**
 * The address the routing service dials for one token: this deployment's own origin, over a secure
 * socket where the origin is secure. A development origin on plain HTTP dials plain WS, which is the
 * only way a local run reaches itself at all.
 */
export function sinkEndpoint(appBaseUrl: string, token: string): string {
  const origin = new URL(appBaseUrl);
  const scheme = origin.protocol === "http:" ? "ws:" : "wss:";
  return `${scheme}//${origin.host}${MEETING_SINK_PATH_PREFIX}${token}`;
}
