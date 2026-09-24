import type {
  FirmId,
  MeetingGuestInvitationId,
  MeetingGuestStayId,
  MeetingId,
} from "@magna-carta/identifiers/types";
import { isIdentifier } from "@magna-carta/identifiers/validate";
import { mintSignedToken, verifySignedToken } from "../signed-token.ts";

// A MEETING GUEST'S TWO CREDENTIALS, on the one signed-token format this worker uses
// (../signed-token.ts), each with its own `typ`.
//
// THE INVITATION is what the e-mail carries: it names the firm, the meeting, the invitation and the
// version of its secret, and carries the SECRET itself. The row keeps only the secret's SHA-256, so
// the database cannot mint a working link and the link cannot outlive the row that authorizes it.
//
// THE GRANT is what an arrival answers with: the same names plus the guest's own STAY, no secret, and
// a shorter life. It rides every later guest request and — because a browser cannot set a header on a
// WebSocket — the socket's address.
//
// WHY A SIGNATURE AS WELL AS A STORED HASH, when either would authenticate. The signature lets a
// public route turn away a flood of guessed or mangled tokens with no database read at all, so a
// stranger's typing never becomes billable storage traffic. The row lets a withdrawal, a rotation or
// an expiry refuse a perfectly-signed token at once rather than at the token's own expiry. Neither
// property comes from the other half.
//
// NEITHER CREDENTIAL IS EVER LOGGED, counted, echoed in a problem, written to an audit row or given a
// telemetry field. A field that holds a bearer credential is a field somebody eventually prints.

/** The `typ` of the link the e-mail carries. */
export const GUEST_INVITATION_TOKEN_TYPE = "meeting-guest-invitation";

/** The `typ` of the credential an arrival mints. */
export const GUEST_GRANT_TOKEN_TYPE = "meeting-guest-grant";

/** The header an ordinary guest request carries its credential in. */
export const GUEST_CREDENTIAL_HEADER = "x-meeting-guest";

/**
 * The query parameter the socket upgrade — and only the socket upgrade — carries a grant in.
 *
 * A browser cannot set a header on a WebSocket, so the address is the only part of the upgrade a
 * credential can ride. It is accepted on that one route and refused on every other, so no ordinary
 * request can be driven by an address somebody was persuaded to open. The request log records the
 * route's TEMPLATE and never the concrete address, so the parameter never reaches a log line.
 */
export const GUEST_CREDENTIAL_QUERY_PARAMETER = "guest";

/** What either credential says, once its signature, its type and its expiry have verified. */
export interface VerifiedGuestCredential {
  readonly lane: "invitation" | "grant";
  readonly firmId: FirmId;
  readonly meetingId: MeetingId;
  readonly invitationId: MeetingGuestInvitationId;
  readonly secretVersion: number;
  /** The link's secret — present on an invitation, absent on a grant. */
  readonly secret: string | null;
  /** The guest's own stay — present on a grant, absent on an invitation. */
  readonly stayId: MeetingGuestStayId | null;
  /** Unix seconds. */
  readonly expiresAt: number;
}

export async function mintGuestInvitationToken(
  signingSecret: string,
  payload: {
    readonly firmId: FirmId;
    readonly meetingId: MeetingId;
    readonly invitationId: MeetingGuestInvitationId;
    readonly secretVersion: number;
    readonly secret: string;
    /** An instant; carried in the token as unix seconds. */
    readonly expiresAt: string;
  },
): Promise<string> {
  return await mintSignedToken(signingSecret, GUEST_INVITATION_TOKEN_TYPE, {
    firmId: payload.firmId,
    meetingId: payload.meetingId,
    invitationId: payload.invitationId,
    secretVersion: payload.secretVersion,
    exp: Math.floor(Date.parse(payload.expiresAt) / 1000),
    secret: payload.secret,
  });
}

export async function mintGuestGrantToken(
  signingSecret: string,
  payload: {
    readonly firmId: FirmId;
    readonly meetingId: MeetingId;
    readonly invitationId: MeetingGuestInvitationId;
    readonly secretVersion: number;
    readonly stayId: MeetingGuestStayId;
    /** An instant; carried in the token as unix seconds. */
    readonly expiresAt: string;
  },
): Promise<string> {
  return await mintSignedToken(signingSecret, GUEST_GRANT_TOKEN_TYPE, {
    firmId: payload.firmId,
    meetingId: payload.meetingId,
    invitationId: payload.invitationId,
    secretVersion: payload.secretVersion,
    stayId: payload.stayId,
    exp: Math.floor(Date.parse(payload.expiresAt) / 1000),
  });
}

/**
 * What a presented credential says, or null for EVERY way it is not one: a bad shape, a signature
 * this worker did not make, the wrong kind of token for the lane, a payload that does not name what
 * the kind must name, or an expiry already past. One answer for all of them, because a stranger
 * guessing at a guest route must learn nothing — not whether a meeting exists, not whether a firm does.
 */
export async function verifyGuestCredential(
  signingSecret: string,
  presented: string,
  lane: "invitation" | "grant",
  nowSeconds: number,
): Promise<VerifiedGuestCredential | null> {
  const typ = lane === "invitation" ? GUEST_INVITATION_TOKEN_TYPE : GUEST_GRANT_TOKEN_TYPE;
  const payload = await verifySignedToken(signingSecret, presented, typ);
  if (payload === null) return null;
  const firmId = payload["firmId"];
  const meetingId = payload["meetingId"];
  const invitationId = payload["invitationId"];
  const secretVersion = payload["secretVersion"];
  const expiresAt = payload["exp"];
  if (
    !isIdentifier(firmId, "firm") ||
    !isIdentifier(meetingId, "meeting") ||
    !isIdentifier(invitationId, "meetingGuestInvitation") ||
    typeof secretVersion !== "number" ||
    !Number.isInteger(secretVersion) ||
    typeof expiresAt !== "number" ||
    expiresAt <= nowSeconds
  ) {
    return null;
  }
  if (lane === "invitation") {
    const secret = payload["secret"];
    if (typeof secret !== "string" || secret === "") return null;
    return {
      lane,
      firmId,
      meetingId,
      invitationId,
      secretVersion,
      secret,
      stayId: null,
      expiresAt,
    };
  }
  const stayId = payload["stayId"];
  if (!isIdentifier(stayId, "meetingGuestStay")) return null;
  return {
    lane,
    firmId,
    meetingId,
    invitationId,
    secretVersion,
    secret: null,
    stayId,
    expiresAt,
  };
}
