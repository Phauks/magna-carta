import type { FirmId, MeetingId } from "@magna-carta/identifiers/types";
import { isIdentifier } from "@magna-carta/identifiers/validate";
import { mintSignedToken, verifySignedToken } from "../signed-token.ts";
import { MAXIMUM_RECORDING_HOURS } from "./sink-token.ts";

// THE CREDENTIAL THE ROUTING SERVICE DIALS THE CAPTIONER WITH — one per caption ADAPTER, on the one
// signed-token format this Worker uses (../signed-token.ts), with a `typ` of its own.
//
// It rides the SAME address the recorder's sink token does (`/internal/meeting-audio/<token>`) and is
// signed with the SAME secret (`MEETING_SINK_SIGNING_KEY`), for one reason each. The address, because
// the routing service's adapter is one mechanism whatever listens at the other end, so what the
// recording's experiment proves about it — that the adapter dials the path intact — is proved for
// captions in the same run, and the zone route the operator adds once serves both. The secret, because
// a deployment that cannot sign a recorder's address cannot sign a captioner's either: captions wait on
// exactly the same owner action recording does, rather than on a second secret nobody has set.
//
// THE `typ` IS WHAT KEEPS THE TWO APART. A recorder's token can never open a caption session and a
// caption token can never open a recorded track: `verifySignedToken` refuses a token of the other kind
// before a claim is read, so the sink route asks each kind in turn and forwards to the object the
// verified kind names.
//
// WHAT IT NAMES: the firm, the meeting, the STAY whose audio it carries, and the nonce of the one
// adapter it was minted for. A caption session is not a record — nothing is written for it — so there is
// no row for the route to read back; the captioner itself is the authority on whether that stay's
// session is open and whether this is its current adapter, and refuses anything else.
//
// NEVER LOGGED, COUNTED, ECHOED OR STORED, on the recorder token's terms.

/** The token's `typ`, which is what stops any other token this Worker signs from passing as one. */
export const MEETING_CAPTION_SINK_TOKEN_TYPE = "meeting-caption-sink";

/**
 * How long a caption adapter's token lives. A session closes three seconds after its speaker falls
 * quiet, but somebody may speak without a pause for a long time, and the routing service redials the
 * same address after a dropped socket — so the token outlives the longest a meeting is recorded for,
 * and an hour more, rather than the length of a sentence.
 */
export const CAPTION_SINK_TOKEN_LIFETIME_MILLISECONDS =
  (MAXIMUM_RECORDING_HOURS + 1) * 60 * 60 * 1000;

/** What a caption sink token names. */
export interface MeetingCaptionSinkClaims {
  readonly firmId: FirmId;
  readonly meetingId: MeetingId;
  // The STAY whose audio the adapter carries: a member's attendance or a guest's stay.
  readonly participantId: string;
  // The adapter this token was minted for; the captioner mints a new one for every session it opens.
  readonly adapterNonce: string;
  // Milliseconds since the epoch.
  readonly expiresAt: number;
}

/** Signs one caption adapter's token. */
export async function mintCaptionSinkToken(
  key: string,
  claims: MeetingCaptionSinkClaims,
): Promise<string> {
  return await mintSignedToken(key, MEETING_CAPTION_SINK_TOKEN_TYPE, {
    firmId: claims.firmId,
    meetingId: claims.meetingId,
    participantId: claims.participantId,
    adapterNonce: claims.adapterNonce,
    expiresAt: claims.expiresAt,
  });
}

/**
 * The claims of a token this Worker signed as a caption sink token and that has not expired, or null.
 * Every failure answers the same null, as the recorder's verifier does.
 */
export async function verifyCaptionSinkToken(
  key: string,
  token: string,
  now: number,
): Promise<MeetingCaptionSinkClaims | null> {
  const payload = await verifySignedToken(key, token, MEETING_CAPTION_SINK_TOKEN_TYPE);
  if (payload === null) return null;
  const { firmId, meetingId, participantId, adapterNonce, expiresAt } = payload;
  if (typeof firmId !== "string" || !isIdentifier(firmId, "firm")) return null;
  if (typeof meetingId !== "string" || !isIdentifier(meetingId, "meeting")) return null;
  if (
    typeof participantId !== "string" ||
    !(
      isIdentifier(participantId, "meetingAttendance") ||
      isIdentifier(participantId, "meetingGuestStay")
    )
  ) {
    return null;
  }
  if (typeof adapterNonce !== "string" || adapterNonce === "") return null;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= now) return null;
  return {
    firmId: firmId as FirmId,
    meetingId: meetingId as MeetingId,
    participantId,
    adapterNonce,
    expiresAt,
  };
}
