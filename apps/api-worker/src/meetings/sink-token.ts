import type { FirmId, MeetingRecordingId } from "@magna-carta/identifiers/types";
import { isIdentifier } from "@magna-carta/identifiers/validate";
import type { Bindings } from "../app.ts";
import { mintSignedToken, verifySignedToken } from "../signed-token.ts";
import { runningUnderTest } from "./sfu/sfu-client.ts";

// THE CREDENTIAL THE ROUTING SERVICE DIALS A RECORDER WITH — one per track, on the one signed-token
// format this Worker uses (../signed-token.ts), with its own `typ` and its OWN SECRET.
//
// The routing service's WebSocket adapter dials a `wss://` address we name and documents no header,
// no token and no query mechanism for authenticating that socket. So the address IS the credential:
// `/internal/meeting-audio/<token>`, where the token names the firm, the recording and the track and
// carries its own expiry, signed so the sink route can refuse anything this Worker did not mint
// without a database read. The route then asks the record whether that recording is still running
// and that track still open — the signature proves who minted the token, and the record proves it
// still means something.
//
// ITS OWN SECRET, `MEETING_SINK_SIGNING_KEY`, rather than `AUTH_SECRET`: the token rides an address,
// and an address is the one place a credential is most likely to be written down — so the secret that
// signs it must be one whose rotation costs nothing but the recordings running at that moment, rather
// than every session and every guest link the Worker has issued.
//
// SHORT-LIVED AND BOUND TO ONE TRACK. It lives as long as a recording may run plus a margin, because
// the routing service reconnects to the SAME address after a dropped socket and a token that expired
// mid-meeting would end the track. Only the recorder can accept the socket, and it accepts one per
// track, so a second dial supersedes the first rather than adding a listener.
//
// NEVER LOGGED, COUNTED, ECHOED OR STORED: no telemetry field holds it and no problem carries it.

/** The token's `typ`, which is what stops any other token this Worker signs from passing as one. */
export const MEETING_SINK_TOKEN_TYPE = "meeting-sink";

/** The address the routing service dials, before the token. Outside `/api`, outside the chokepoint. */
export const MEETING_SINK_PATH_PREFIX = "/internal/meeting-audio/";

/**
 * HOW LONG A RECORDING MAY RUN. A recorder that has held a track this long stops issuing tokens that
 * would outlive it; a deposition that runs longer is a second recording, which it should be anyway.
 */
export const MAXIMUM_RECORDING_HOURS = 12;

/** A token lives as long as a recording may, and an hour more for a dial that arrives late. */
export const SINK_TOKEN_LIFETIME_MILLISECONDS = (MAXIMUM_RECORDING_HOURS + 1) * 60 * 60 * 1000;

/** What a sink token names. */
export interface MeetingSinkClaims {
  readonly firmId: FirmId;
  readonly recordingId: MeetingRecordingId;
  readonly trackName: string;
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
    trackName: claims.trackName,
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
  const { firmId, recordingId, trackName, expiresAt } = payload;
  if (typeof firmId !== "string" || !isIdentifier(firmId, "firm")) return null;
  if (typeof recordingId !== "string" || !isIdentifier(recordingId, "meetingRecording"))
    return null;
  if (typeof trackName !== "string" || trackName === "") return null;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= now) return null;
  return {
    firmId: firmId as FirmId,
    recordingId: recordingId as MeetingRecordingId,
    trackName,
    expiresAt,
  };
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
