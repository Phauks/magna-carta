import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { decodeCursor, encodeCursor } from "@magna-carta/data-access/cursor-pagination";
import {
  commitEffectBatch,
  GuardedWriteRefusedError,
  type BatchDatabase,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type {
  MeetingGuestInvitationId,
  MeetingGuestStayId,
  MeetingId,
} from "@magna-carta/identifiers/types";
import { postGuestMeetingMessage, requireGuestInTheRoom } from "@magna-carta/meetings/chat-service";
import {
  listMeetingMessages,
  listMeetingMessagesRedactedSince,
} from "@magna-carta/meetings/chat-statements";
import {
  MAX_MEETING_MESSAGE_LENGTH,
  MAX_MEETING_MESSAGE_PAGE_SIZE,
} from "@magna-carta/meetings/chat-types";
import {
  arriveAsGuest,
  GUEST_ARRIVAL_GUARD,
  GUEST_DOOR_GUARD,
  GUEST_RETURN_GUARD,
  GuestNoLongerOnTheEventError,
  inviteGuest,
  leaveAsGuest,
  listMeetingGuests,
  MAX_GUEST_INVITATION_PAGE_SIZE,
  readGuestMeeting,
  REISSUE_GUEST_LINK_GUARD,
  revokeGuestLink,
  REVOKE_GUEST_LINK_GUARD,
  rotateGuestLink,
  whyTheSpendWasRefused,
  type MintedGuestLink,
} from "@magna-carta/meetings/guest-service";
import {
  isGuestInvitationConflict,
  isOpenGuestStayConflict,
  readGuestInvitationInMeeting,
  readGuestStayInMeeting,
  readMeetingForGuest,
} from "@magna-carta/meetings/guest-statements";
import {
  guestGrantExpiresAt,
  MAX_GUEST_CONFIRMED_NAME_LENGTH,
  MEETING_GUEST_ENTITY_KINDS,
  type MeetingGuestInvitationEntry,
} from "@magna-carta/meetings/guest-types";
import type { MeetingHostingOptions } from "@magna-carta/meetings/hosting-service";
import { MEETING_MEDIA, MEETING_STATUSES } from "@magna-carta/meetings/types";
import { MeetingValidationError } from "@magna-carta/meetings/validation";
import { meetingGuestRefused } from "@magna-carta/telemetry/events";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointGuestGrant,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { isSameOriginUpgrade } from "../../chokepoint/same-origin-upgrade.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { cursorQuery, paginated } from "@magna-carta/data-access/pagination-contract";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { sendMessage } from "../../../email-delivery.ts";
import type { SendEmail } from "../../../email-port.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { meetingSocketRequest } from "../../../meetings/meeting-room.ts";
import {
  eventEndInstant,
  guestInvitationEmail,
  GUEST_INVITATION_MESSAGE_CLASS,
} from "../../../meetings/guest-invitation-mail.ts";
import { guestLinkRefusalFor } from "../../../meetings/guest-refusals.ts";
import {
  GUEST_SOCKET_OPERATION_ID,
  guestCredentialFromSocketProtocols,
  mintGuestGrantToken,
  mintGuestInvitationToken,
} from "../../../meetings/guest-token.ts";
import { sfuClientForEnv } from "../../../meetings/sfu/sfu-client.ts";
import { isWebSocketUpgrade } from "../../../progress/job-progress-sockets.ts";
import {
  commitChatEffect,
  listMessagesQuery,
  MeetingMessage,
  MeetingMessagePage,
  messageOnTheRecord,
} from "./meeting-chat.ts";
import { GuestArrival } from "./meeting-schemas.ts";
import { iceServersFor, meetingErrorResponse, meetingRoomFor, notConfigured } from "./meetings.ts";

// A MEETING'S GUESTS — somebody from outside the firm on a signed, expiring link — from both sides.
//
// THE HOST'S HALF is four routes on the ordinary member path, `meetings:host` and a grant on this
// meeting: mint a link for a Directory entity on the event and mail it, list the links, send a fresh
// one in place of an old one, and withdraw one. The GUEST'S HALF is six routes on the chokepoint's
// guest lane, which admits a signed credential rather than a session and stashes a firm and the
// credential but never a user id — so nothing a guest calls can reach a member handler.
//
// THE GUEST ROUTES CARRY NO MEETING IDENTIFIER IN THE PATH. The meeting is a fact of the credential,
// not of the request line: a guest cannot address a meeting the link was not minted for, and there is
// no identifier for them to change. What they are answered is a reduced summary of its own schema —
// never `MeetingSummary` with fields nulled, because a nulled field is a field somebody restores, and
// the matter and the event behind a meeting must never be reachable from here.
//
// THE TOKEN, THE SECRET AND THE GRANT never reach a log, an audit row, a telemetry field, an error
// message, or the idempotency store. The one place a credential is written is the mail and the
// response that hands a grant to the browser that just earned it.

const HOST = "meetings:host" as const;

// ---- request/response contracts ----

const InviteGuestRequest = z
  .object({
    // A person or organization from the Directory who is ON THIS EVENT. An external participant
    // carrying only a typed name has nothing a link can be minted for, and is promoted to the
    // Directory deliberately first.
    entityId: z.string().min(1).max(64),
    // Which of their addresses to send to. Absent, the Directory's own choice: the primary, then the
    // preferred — and never one the person has asked the firm not to use.
    directoryEmailId: z.string().min(1).max(64).optional(),
  })
  .openapi("InviteMeetingGuestRequest");

// ONE INVITATION AS A HOST READS IT — never the token and never the secret, not even truncated. Unlike
// a capture address, which a person has to read off a screen, this credential only travels by mail.
export const MeetingGuestInvitation = z
  .object({
    id: z.string(),
    entityKind: z.enum(MEETING_GUEST_ENTITY_KINDS),
    entityId: z.string(),
    // The Directory name when the link was minted, kept as it was.
    invitedName: z.string(),
    // When the link stops working on its own: a couple of hours after the event, and never more than
    // a fortnight after it was sent. An instant.
    expiresAt: z.string(),
    revokedAt: z.string().nullable(),
    arrivalCount: z.number().int().min(0),
    lastArrivalAt: z.string().nullable(),
  })
  .openapi("MeetingGuestInvitation");

const MeetingGuestInvitationPage = paginated(MeetingGuestInvitation).openapi(
  "MeetingGuestInvitationPage",
);

// THE MEETING, AS SOMEBODY HOLDING ITS LINK MAY KNOW IT. A distinct schema, with nothing that names
// a matter or an event, and nothing a guest could use to reach one.
const GuestMeetingSummary = z
  .object({
    firmName: z.string(),
    title: z.string(),
    startsOn: z.string(),
    startsAtTime: z.string().nullable(),
    endsAtTime: z.string().nullable(),
    // The event's own zone, which the times above are read in.
    timeZone: z.string(),
    medium: z.enum(MEETING_MEDIA),
    status: z.enum(MEETING_STATUSES),
    // The Directory name the link was minted for — what the name at the door is pre-filled with.
    invitedName: z.string(),
  })
  .openapi("GuestMeetingSummary");

const GuestArrivalRequest = z
  .object({
    // The name the person gives at the door. Untrusted display text: whitespace-normalized, bounded
    // at eighty characters, and never written over the Directory's own name. Generous here by the
    // whitespace a browser leaves behind; the domain measures what is left.
    confirmedName: z
      .string()
      .min(1)
      .max(MAX_GUEST_CONFIRMED_NAME_LENGTH * 2),
  })
  .openapi("GuestArrivalRequest");

const GuestAcknowledged = z.object({ ok: z.literal(true) }).openapi("GuestAcknowledged");

const SendGuestMessageRequest = z
  .object({
    body: z
      .string()
      .min(1)
      .max(MAX_MEETING_MESSAGE_LENGTH + 64),
  })
  .openapi("SendGuestMeetingMessageRequest");

const guestCredentialHeader = z.object({
  "x-meeting-guest": z
    .string()
    .optional()
    .openapi({
      param: { name: "x-meeting-guest", in: "header" },
      description:
        "The guest's credential: the link the e-mail carried on the summary and the arrival, the " +
        "grant the arrival answered with everywhere else.",
    }),
});

const guestSocketQuery = z.object({
  guest: z
    .string()
    .optional()
    .openapi({
      description:
        "The grant, from a browser built before the subprotocol form. Prefer the subprotocol: an " +
        "address can be recorded by request logging a header is not.",
    }),
});

const meetingIdParam = z.object({ meetingId: identifierPathParam("meeting", "meetingId") });
const invitationParams = z.object({
  meetingId: identifierPathParam("meeting", "meetingId"),
  invitationId: identifierPathParam("meetingGuestInvitation", "invitationId"),
});

// What every guest route may answer beyond its success. 404 is the FLAT refusal — a credential that
// is not one, answered as an address that does not exist, so a stranger learns nothing.
const guestErrors = {
  403: {
    description: "The request is refused — a socket upgrade from another site",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "No such resource — the answer to a missing or unverifiable credential",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "The meeting has ended, the link is used up, or the guest is not in the meeting",
    content: { "application/problem+json": { schema: Problem } },
  },
  410: {
    description: "The link has expired, was withdrawn, or was replaced by a newer one",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "The request is not a shape this operation accepts",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limited",
    content: { "application/problem+json": { schema: Problem } },
  },
};

export const hostErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required permission, or is not hosting this meeting",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "No meeting, or no invitation on it, this member can reach at that address",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "The meeting has ended, another act on this link landed first, or a request with this " +
      "Idempotency-Key is in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  410: {
    description: "The link was withdrawn; invite the entity again to send a new one",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request body is not a shape this operation accepts, or the entity cannot be invited — " +
      "not a Directory entity on this event, or one with no address the firm may use",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limited",
    content: { "application/problem+json": { schema: Problem } },
  },
  503: {
    description:
      "The invitation was recorded but its e-mail could not be sent; nothing is stored under the " +
      "Idempotency-Key, so retrying it sends a fresh link",
    content: { "application/problem+json": { schema: Problem } },
  },
};

// ---- route metas ----

// THE GUEST LANE. `authenticated: false` and `permission: null` because there is no principal to hold
// a capability — registration refuses anything else on a lane route — and `resource: "firm"` because
// the lane resolves the firm from the credential. It is `surface: "app"`: the page is served from the
// firm's own origin, where the meeting's media permissions and the socket's same-origin check live.
function guestMeta(
  action: string,
  lane: "invitation" | "grant",
  options: {
    readonly audited?: boolean;
    readonly rateLimit?: RouteMeta["rateLimit"];
    readonly idempotency?: "required";
  } = {},
): RouteMeta {
  return {
    operationId: `guest.${action}`,
    surface: "app",
    authenticated: false,
    permission: null,
    resource: "firm",
    audited: options.audited ?? false,
    idempotency: options.idempotency ?? "optional",
    ...(options.idempotency === "required" ? { idempotencyStore: "firm" as const } : {}),
    rateLimit: options.rateLimit ?? "default",
    guestLane: lane,
  };
}

// THE HOST'S HALF, on `meetings:host` and a grant on the meeting checked in the service — the line
// every other host act sits on.
function hostMeta(action: string, write: boolean, extra: Partial<RouteMeta> = {}): RouteMeta {
  return {
    operationId: `meetings.${action}`,
    surface: "app",
    authenticated: true,
    permission: HOST,
    resource: "firm",
    audited: write,
    idempotency: write ? "required" : "optional",
    ...(write ? { idempotencyStore: "firm" as const } : {}),
    rateLimit: "default",
    ...extra,
  };
}

// ---- the host's routes ----

const inviteRoute = defineOpenAPIRoute(hostMeta("inviteGuest", true), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/guests",
  description:
    "Mints a signed, expiring link for one person or organization from the Directory who is on " +
    "this meeting's event, and e-mails it to them. The link proves possession of a mailbox and " +
    "nothing more: it brings its holder to the lobby, and a host admits them. A second invitation " +
    "for the same entity REPLACES the first — a fresh secret, the old link stops working at once, " +
    "a withdrawn link is reinstated, its arrivals counted afresh, and a guest sitting on the old " +
    "link is put back outside — rather than standing beside it, and answers 200 rather than " +
    "201. The token is never returned, stored or shown; the invitation is.",
  request: {
    params: meetingIdParam,
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: InviteGuestRequest } }, required: true },
  },
  responses: {
    200: {
      description: "An existing invitation was sent again with a fresh link",
      content: { "application/json": { schema: MeetingGuestInvitation } },
    },
    201: {
      description: "The invitation was created and sent",
      content: { "application/json": { schema: MeetingGuestInvitation } },
    },
    ...hostErrors,
  },
});

const listRoute = defineOpenAPIRoute(hostMeta("listGuests", false), {
  method: "get",
  path: "/api/v1/meetings/{meetingId}/guests",
  description:
    "The invitations on this meeting, withdrawn ones included, oldest first — never the token or " +
    "the secret. A host act: who has been sent a way into a meeting is for whoever is running it.",
  request: { params: meetingIdParam, query: cursorQuery },
  responses: {
    200: {
      description: "One page of this meeting's invitations",
      content: { "application/json": { schema: MeetingGuestInvitationPage } },
    },
    401: hostErrors[401],
    403: hostErrors[403],
    404: hostErrors[404],
    429: hostErrors[429],
  },
});

const rotateRoute = defineOpenAPIRoute(hostMeta("rotateGuestLink", true), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/guests/{invitationId}/rotation",
  description:
    "Sends a fresh link in place of the old one — the answer to a link forwarded by mistake. Every " +
    "copy of the old link stops working at once, a guest in the room on it is disconnected and " +
    "must arrive again on the new one, and the new link's arrivals are counted afresh. A withdrawn " +
    "link is not rotated; invite the entity again to " +
    "reinstate it.",
  request: { params: invitationParams, headers: idempotencyKeyHeader },
  responses: {
    200: {
      description: "The fresh link was sent",
      content: { "application/json": { schema: MeetingGuestInvitation } },
    },
    ...hostErrors,
  },
});

const revokeRoute = defineOpenAPIRoute(
  hostMeta("revokeGuestLink", true, {
    // Inviting the same entity again reinstates this invitation — the same row, with a fresh secret.
    reversal: { kind: "inverse", by: "meetings.inviteGuest" },
  }),
  {
    method: "delete",
    path: "/api/v1/meetings/{meetingId}/guests/{invitationId}",
    description:
      "Withdraws a link. The invitation is KEPT, marked withdrawn — who was invited is part of what " +
      "the record says happened — and a guest on it, in the room or at the door, is put out. Inviting " +
      "the entity again brings them back. A link already withdrawn answers 200 unchanged.",
    request: { params: invitationParams, headers: idempotencyKeyHeader },
    responses: {
      200: {
        description: "The link no longer works",
        content: { "application/json": { schema: MeetingGuestInvitation } },
      },
      ...hostErrors,
    },
  },
);

// ---- the guest's routes ----

const summaryRoute = defineOpenAPIRoute(guestMeta("meetingSummary", "invitation"), {
  method: "get",
  path: "/api/v1/guest/meeting",
  description:
    "The meeting a guest link opens onto: the firm's name, the event's title and time in its own " +
    "zone, the medium, where the meeting stands, and the name the link was minted for. Nothing is " +
    "written and nothing is spent, so a mail client that prefetches the link costs nothing. The " +
    "link rides the x-meeting-guest header.",
  request: { headers: guestCredentialHeader },
  responses: {
    200: {
      description: "The meeting, as the link's holder may know it",
      content: { "application/json": { schema: GuestMeetingSummary } },
    },
    ...guestErrors,
  },
});

const arriveRoute = defineOpenAPIRoute(
  guestMeta("arrive", "invitation", { audited: true, rateLimit: "guest-arrival" }),
  {
    method: "post",
    path: "/api/v1/guest/arrivals",
    description:
      "Presses Join: spends the link, opens the guest's stay AT THE DOOR — a guest always waits for " +
      "a host — and answers with what the browser needs to connect plus the grant every later guest " +
      "request carries. An arrival while this link already holds an open stay answers with that " +
      "stay and a fresh grant rather than opening a second — and puts that stay back at the door " +
      "under the name just given, because whoever holds the link now is not known to be whoever a " +
      "host let in; the host admits them again. A link spent too many times, a locked " +
      "room, and a guest a host removed or turned away are each refused with a sentence. Answers " +
      "201 when a stay was opened and 200 when an open one was returned. Deliberately not replayed " +
      "from an Idempotency-Key: the answer carries a credential, and a credential is never stored.",
    request: {
      headers: guestCredentialHeader,
      body: { content: { "application/json": { schema: GuestArrivalRequest } }, required: true },
    },
    responses: {
      200: {
        description: "The guest's open stay, with a fresh grant",
        content: { "application/json": { schema: GuestArrival } },
      },
      201: {
        description: "The guest is at the door",
        content: { "application/json": { schema: GuestArrival } },
      },
      ...guestErrors,
      422: {
        description: "The name given at the door is empty or too long",
        content: { "application/problem+json": { schema: Problem } },
      },
      503: {
        description: "This deployment cannot route a meeting's media",
        content: { "application/problem+json": { schema: Problem } },
      },
    },
  },
);

// Named by the one constant the chokepoint reads, because this is the only route a grant may reach
// anywhere but the header — so the two cannot disagree about which route that is.
const socketRoute = defineOpenAPIRoute(
  { ...guestMeta("meetingSocket", "grant"), operationId: GUEST_SOCKET_OPERATION_ID },
  {
    method: "get",
    path: "/api/v1/guest/meeting/socket",
    description:
      "Opens the meeting's signaling socket for a guest — in the lobby state until a host admits " +
      "them, then in the room exactly as a member is, except that no roster or message frame carries " +
      "a firm's user identifiers. A browser cannot set an ordinary header on a WebSocket, so the " +
      "grant rides the Sec-WebSocket-Protocol header — the protocols `meeting-guest` and then the " +
      "grant, answered with `meeting-guest` — or, from an older browser, the `guest` query " +
      "parameter; this is the one route that accepts it anywhere but the x-meeting-guest header. " +
      "Requires Upgrade: websocket; an upgrade carrying another site's Origin is refused.",
    request: { query: guestSocketQuery },
    responses: {
      101: { description: "The signaling socket is open; frames follow" },
      ...guestErrors,
      426: {
        description: "The request did not ask to upgrade to a WebSocket",
        content: { "application/problem+json": { schema: Problem } },
      },
      503: {
        description: "This deployment cannot route a meeting's media",
        content: { "application/problem+json": { schema: Problem } },
      },
    },
  },
);

const departRoute = defineOpenAPIRoute(guestMeta("depart", "grant", { audited: true }), {
  method: "post",
  path: "/api/v1/guest/departures",
  description:
    "Closes the guest's own stay, the way a member's Leave does, and closes their socket. A stay " +
    "already closed answers 200 unchanged: that instant is in somebody's record.",
  request: { headers: guestCredentialHeader },
  responses: {
    200: {
      description: "The guest has left",
      content: { "application/json": { schema: GuestAcknowledged } },
    },
    ...guestErrors,
  },
});

const listMessagesRoute = defineOpenAPIRoute(guestMeta("listMessages", "grant"), {
  method: "get",
  path: "/api/v1/guest/meeting/messages",
  description:
    "The meeting's chat, for a guest who is IN THE ROOM — admitted, not merely at the door. The " +
    "same transcript and the same paging as a member's read, with every firm user identifier " +
    "taken out.",
  request: { headers: guestCredentialHeader, query: listMessagesQuery },
  responses: {
    200: {
      description: "One page of this meeting's chat",
      content: { "application/json": { schema: MeetingMessagePage } },
    },
    ...guestErrors,
  },
});

const sendMessageRoute = defineOpenAPIRoute(
  guestMeta("sendMessage", "grant", { audited: true, idempotency: "required" }),
  {
    method: "post",
    path: "/api/v1/guest/meeting/messages",
    description:
      "Says something in the meeting's chat from the guest's own stay, on the record like every " +
      "other line. Only a guest who is in the room may speak. A retried send is answered with the " +
      "message's record and an empty body, as a member's is.",
    request: {
      headers: guestCredentialHeader.merge(idempotencyKeyHeader),
      body: {
        content: { "application/json": { schema: SendGuestMessageRequest } },
        required: true,
      },
    },
    responses: {
      201: {
        description: "The message is on the record",
        content: { "application/json": { schema: MeetingMessage } },
      },
      400: {
        description: "Missing Idempotency-Key (this operation requires one)",
        content: { "application/problem+json": { schema: Problem } },
      },
      ...guestErrors,
      422: {
        description: "The message is empty, or longer than a message may be",
        content: { "application/problem+json": { schema: Problem } },
      },
    },
  },
);

// ---- refusals ----

export type GuestProblem =
  | ProblemResponse<403>
  | ProblemResponse<404>
  | ProblemResponse<409>
  | ProblemResponse<410>
  | ProblemResponse<422>;

/**
 * What a guest — or a host acting on a guest's link — is told about a refusal the domain raised.
 *
 * The link's own codes go through the one table the chokepoint's lane reads, so a condition met at
 * the lane and the same condition met in the service say the same sentence. Everything else is the
 * meetings family's own mapping, so a locked room tells a guest what it tells a member.
 */
export function guestErrorResponse(c: Context, caught: MeetingValidationError): GuestProblem {
  const linkRefusal = guestLinkRefusalFor(caught.code);
  if (linkRefusal !== null) return problemJson(c, linkRefusal);
  if (caught.code === "guest-not-invitable") {
    return problemJson(c, {
      type: "guest-not-invitable",
      title: "This person cannot be invited",
      status: 422,
      detail: caught.message,
    });
  }
  if (caught.code === "guest-name-not-valid") {
    return problemJson(c, {
      type: "validation",
      title: "That name cannot be used",
      status: 422,
      detail: caught.message,
    });
  }
  return meetingErrorResponse(c, caught);
}

/** A refusal at the guest's own arrival, counted as the lane's are — a gate that is silent when it works is a gate nobody notices has stopped. */
function recordArrivalRefused(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
  reason: string,
): void {
  const grant = requireChokepointGuestGrant(c);
  c.get("logger")?.log(
    meetingGuestRefused(
      { correlationId: c.get("correlationId") ?? "", now: new Date().toISOString() },
      {
        lane: grant.lane,
        reason,
        firmId: grant.firmId,
        meetingId: grant.meetingId,
        invitationId: grant.invitationId,
      },
    ),
  );
}

function mailNotSent(c: Context, errorId: string): ProblemResponse<503> {
  return problemJson(c, {
    type: "mail-undeliverable",
    status: 503,
    title: "The invitation could not be e-mailed",
    detail:
      "The invitation is recorded, but its e-mail could not be sent just now. Try again shortly — " +
      "the retry sends a fresh link, and the one that was not mailed stops working when it does.",
    errorId,
  });
}

// ---- helpers ----

type GuestContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

export function hostingOptions(c: GuestContext): MeetingHostingOptions {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: requireChokepointUserId(c),
    randomSource: cryptoRandomSource,
    visibility: visibleMatterPredicate(),
  };
}

/** The mail a mint or a rotation owed did not go out; nothing is stored, so a retry sends it. */
class InvitationMailNotSent extends Error {
  constructor(readonly errorId: string) {
    super("the invitation's e-mail could not be sent");
    this.name = "InvitationMailNotSent";
  }
}

/**
 * Runs one host act on a link through the idempotency gate. The STORED body is the invitation and
 * never the token — the idempotency store is served verbatim to whoever retries the key, and a bearer
 * credential there would outlive the link it belongs to. `executed` says whether THIS call committed.
 *
 * AN ACT THAT OWES A MAIL COMMITS ITS WRITE FIRST, SENDS, AND ONLY THEN STORES ITS ANSWER. The mail
 * cannot go before the commit — nobody may be sent a link to an invitation that did not land — and it
 * cannot ride the batch, because the only thing that could carry it there is the token, which is never
 * written anywhere. So `afterCommit` runs between the two: the room is told, the mail is sent, and a
 * mail that fails stores NOTHING under the key. The host's retry then runs the act again, which for a
 * link that now exists is a fresh secret and a fresh mail — rather than being handed the success the
 * first call stored before its mail had even been tried, with the guest never mailed.
 */
export async function commitHostGuestEffect(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  call: () => Promise<{
    value: MeetingGuestInvitationEntry;
    responseCode: number;
    effect: EffectWrite;
    afterCommit?: () => Promise<{ delivered: true } | { delivered: false; errorId: string }>;
  }>,
): Promise<
  | { ok: true; executed: boolean; value: MeetingGuestInvitationEntry; responseCode: number }
  | { ok: false; problem: GuestProblem | ProblemResponse<503> }
> {
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now: () => new Date().toISOString(),
      effect: async () => {
        const { value, responseCode, effect, afterCommit } = await call();
        const responseBody = canonicalJsonStringify(value);
        if (afterCommit === undefined) return { write: effect, responseCode, responseBody };
        await commitEffectBatch(database, effect, { now: () => new Date().toISOString() });
        const mailed = await afterCommit();
        if (!mailed.delivered) throw new InvitationMailNotSent(mailed.errorId);
        return { write: { statements: [], outboxMessages: [] }, responseCode, responseBody };
      },
    });
  } catch (caught) {
    if (caught instanceof InvitationMailNotSent) {
      return { ok: false, problem: mailNotSent(c, caught.errorId) };
    }
    if (caught instanceof MeetingValidationError) {
      return { ok: false, problem: guestErrorResponse(c, caught) };
    }
    // Two acts on one link in the same instant — two mints, two rotations, a rotation and a
    // withdrawal. The loser's batch rolled back whole; the host re-reads and decides again.
    if (
      (caught instanceof GuardedWriteRefusedError &&
        (caught.guard === REISSUE_GUEST_LINK_GUARD || caught.guard === REVOKE_GUEST_LINK_GUARD)) ||
      isGuestInvitationConflict(caught)
    ) {
      return {
        ok: false,
        problem: problemJson(c, {
          type: "conflict",
          title: "Somebody else changed this link first",
          status: 409,
          detail: "Another act on this invitation landed first. Read the guests again.",
        }),
      };
    }
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  }
  return {
    ok: true,
    executed: result.kind === "executed",
    value: JSON.parse(result.responseBody ?? "{}") as MeetingGuestInvitationEntry,
    responseCode: result.responseCode,
  };
}

/**
 * The one mail a mint or a rotation sends, AFTER its batch committed — so nobody is sent a link to an
 * invitation that did not land. The token is minted here, used for this mail, and forgotten.
 */
async function mailTheLink(
  c: GuestContext,
  sendEmail: (env: Bindings) => SendEmail,
  meetingId: string,
  minted: MintedGuestLink,
): Promise<{ delivered: true } | { delivered: false; errorId: string }> {
  const firm = requireChokepointFirmContext(c);
  const token = await mintGuestInvitationToken(c.env.AUTH_SECRET, {
    firmId: requireChokepointFirmId(c),
    meetingId: meetingId as MeetingId,
    invitationId: minted.invitation.id,
    secretVersion: minted.secretVersion,
    secret: minted.secret,
    expiresAt: minted.invitation.expiresAt,
  });
  const { subject, text } = guestInvitationEmail({
    firmName: await firm.readFirmName(),
    event: minted.event,
    origin: new URL(c.req.url).origin,
    token,
  });
  const delivery = await sendMessage({
    send: sendEmail(c.env),
    surface: "meetings.guests",
    logger: c.get("logger"),
    correlationId: c.get("correlationId") ?? "",
    message: {
      to: minted.emailAddress,
      subject,
      text,
      messageClass: GUEST_INVITATION_MESSAGE_CLASS,
    },
  });
  return delivery.delivered ? { delivered: true } : { delivered: false, errorId: delivery.errorId };
}

/**
 * What a mint or a rotation does once its batch has committed: the room lets go of the stay the old
 * link held — which the same batch closed — and then the fresh link is mailed. In that order, on the
 * standing ordering: the socket on the old link is closed only once the record says it no longer
 * works, and nobody is mailed a link while somebody is still sitting in the room on the one it
 * replaces.
 */
export async function replaceAndMail(
  c: GuestContext,
  sendEmail: (env: Bindings) => SendEmail,
  meetingId: string,
  minted: MintedGuestLink,
): Promise<{ delivered: true } | { delivered: false; errorId: string }> {
  if (minted.closedStayId !== null) {
    await meetingRoomFor(c.env, requireChokepointFirmId(c), meetingId).guestCredentialReplaced(
      minted.closedStayId,
    );
  }
  return await mailTheLink(c, sendEmail, meetingId, minted);
}

function redactedForGuest<T extends { userId: string | null; redactedByUserId: string | null }>(
  message: T,
): T {
  return { ...message, userId: null, redactedByUserId: null };
}

// ---- registration ----

export function registerMeetingGuestRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
  sendEmail: (env: Bindings) => SendEmail,
): void {
  // POST /api/v1/meetings/{meetingId}/guests
  app.openapi(
    { ...inviteRoute, middleware: chokepointMiddleware(chokepoint, inviteRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId } = c.req.valid("param");
      const { entityId, directoryEmailId } = c.req.valid("json");

      // The secret and the address exist for this one send, inside the effect, and are written
      // nowhere — so they cannot come back out of the idempotency gate.
      const outcome = await commitHostGuestEffect(c, firm.firmDatabase, idempotency, async () => {
        const minted = await inviteGuest(
          firm.firmDatabase,
          meetingId as MeetingId,
          {
            entityId,
            ...(directoryEmailId === undefined ? {} : { directoryEmailId }),
            eventEndsAt: eventEndInstant,
          },
          hostingOptions(c),
        );
        return {
          value: minted.invitation,
          responseCode: minted.reissued ? 200 : 201,
          effect: minted.effect,
          afterCommit: () => replaceAndMail(c, sendEmail, meetingId, minted),
        };
      });
      if (!outcome.ok) return outcome.problem;
      return outcome.responseCode === 201 ? c.json(outcome.value, 201) : c.json(outcome.value, 200);
    },
  );

  // GET /api/v1/meetings/{meetingId}/guests
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { meetingId } = c.req.valid("param");
      const { cursor } = c.req.valid("query");
      try {
        const listed = await listMeetingGuests(
          firm.firmDatabase,
          meetingId as MeetingId,
          hostingOptions(c),
          {
            ...(cursor === undefined ? {} : { cursor: decodeCursor(cursor) }),
            limit: MAX_GUEST_INVITATION_PAGE_SIZE,
          },
        );
        return c.json(
          {
            data: [...listed.entries],
            nextCursor:
              listed.next === null ? null : encodeCursor(listed.next.createdAt, listed.next.id),
          },
          200,
        );
      } catch (caught) {
        // The two this read can raise, mapped here so a read whose contract declares no 409 cannot
        // produce one: the meeting out of reach, and the caller not running it.
        if (caught instanceof MeetingValidationError) {
          if (caught.code === "meeting-not-host") {
            return problemJson(c, {
              type: "meeting-not-host",
              title: "You are not hosting this meeting",
              status: 403,
              detail: caught.message,
              requestAccess: false,
            });
          }
          return problemJson(c, {
            type: "meeting-not-found",
            title: "Not found",
            status: 404,
            detail: "No such meeting in this firm.",
          });
        }
        throw caught;
      }
    },
  );

  // POST /api/v1/meetings/{meetingId}/guests/{invitationId}/rotation
  app.openapi(
    { ...rotateRoute, middleware: chokepointMiddleware(chokepoint, rotateRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId, invitationId } = c.req.valid("param");

      const outcome = await commitHostGuestEffect(c, firm.firmDatabase, idempotency, async () => {
        const minted = await rotateGuestLink(
          firm.firmDatabase,
          meetingId as MeetingId,
          invitationId as MeetingGuestInvitationId,
          { eventEndsAt: eventEndInstant },
          hostingOptions(c),
        );
        return {
          value: minted.invitation,
          responseCode: 200,
          effect: minted.effect,
          afterCommit: () => replaceAndMail(c, sendEmail, meetingId, minted),
        };
      });
      if (!outcome.ok) return outcome.problem;
      return c.json(outcome.value, 200);
    },
  );

  // DELETE /api/v1/meetings/{meetingId}/guests/{invitationId}
  app.openapi(
    { ...revokeRoute, middleware: chokepointMiddleware(chokepoint, revokeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId, invitationId } = c.req.valid("param");

      let closedStayId: MeetingGuestStayId | null = null;
      const outcome = await commitHostGuestEffect(c, firm.firmDatabase, idempotency, async () => {
        const revoked = await revokeGuestLink(
          firm.firmDatabase,
          meetingId as MeetingId,
          invitationId as MeetingGuestInvitationId,
          hostingOptions(c),
        );
        closedStayId = revoked.closedStayId;
        return { value: revoked.invitation, responseCode: 200, effect: revoked.effect };
      });
      if (!outcome.ok) return outcome.problem;

      // AFTER the commit: the guest on this link, in the room or at the door, is put out — the roster,
      // the door, the media and their socket — the same release a rotation performs, refused
      // `withdrawn` rather than `removed`: their STAY closed `left`, so inviting them again brings
      // them back, and the socket's refusal says only that the firm took the link back.
      if (outcome.executed && closedStayId !== null) {
        await meetingRoomFor(c.env, requireChokepointFirmId(c), meetingId).guestCredentialReplaced(
          closedStayId,
          "withdrawn",
        );
      }
      return c.json(outcome.value, 200);
    },
  );

  // GET /api/v1/guest/meeting
  app.openapi(
    { ...summaryRoute, middleware: chokepointMiddleware(chokepoint, summaryRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const grant = requireChokepointGuestGrant(c);
      try {
        const summary = await readGuestMeeting(firm.firmDatabase, {
          meetingId: grant.meetingId as MeetingId,
          invitationId: grant.invitationId as MeetingGuestInvitationId,
          secretVersion: grant.secretVersion,
        });
        // Field by field, into the reduced schema — never a spread of anything wider.
        return c.json(
          {
            firmName: await firm.readFirmName(),
            title: summary.title,
            startsOn: summary.startsOn,
            startsAtTime: summary.startsAtTime,
            endsAtTime: summary.endsAtTime,
            timeZone: summary.timeZone,
            medium: summary.medium,
            status: summary.status,
            invitedName: summary.invitedName,
          },
          200,
        );
      } catch (caught) {
        if (caught instanceof MeetingValidationError) {
          return problemJson(
            c,
            guestLinkRefusalFor(caught.code) ?? {
              type: "not-found",
              status: 404,
              title: "Not found",
              detail: "No such resource in this firm.",
            },
          );
        }
        throw caught;
      }
    },
  );

  // POST /api/v1/guest/arrivals
  app.openapi(
    { ...arriveRoute, middleware: chokepointMiddleware(chokepoint, arriveRoute) },
    async (c) => {
      if (sfuClientForEnv(c.env) === null) return notConfigured(c);
      const firm = requireChokepointFirmContext(c);
      const grant = requireChokepointGuestGrant(c);
      const { confirmedName } = c.req.valid("json");
      const credential = {
        meetingId: grant.meetingId as MeetingId,
        invitationId: grant.invitationId as MeetingGuestInvitationId,
        secretVersion: grant.secretVersion,
      };
      const now = new Date().toISOString();

      // One arrival, composed and committed. A refusal comes back as the problem the guest is told;
      // the two races a second attempt settles come back as `retry`.
      const attemptArrival = async (): Promise<
        | { readonly arrived: Awaited<ReturnType<typeof arriveAsGuest>> }
        | { readonly refused: GuestProblem }
        | "retry"
      > => {
        try {
          const composed = await arriveAsGuest(
            firm.firmDatabase,
            credential,
            { confirmedName },
            { clock: { now: () => now }, randomSource: cryptoRandomSource },
          );
          await commitEffectBatch(firm.firmDatabase, composed.effect, { now: () => now });
          return { arrived: composed };
        } catch (caught) {
          // Somebody taken off the event: the refusal carries its own audit row, written before the
          // guest is answered, because nobody withdrew this link by hand.
          if (caught instanceof GuestNoLongerOnTheEventError) {
            await commitEffectBatch(firm.firmDatabase, caught.effect, { now: () => now });
          }
          if (caught instanceof MeetingValidationError) {
            recordArrivalRefused(c, caught.code);
            return { refused: guestErrorResponse(c, caught) };
          }
          // THE LINK CHANGED UNDER THE ARRIVAL — withdrawn, rotated, used up or expired between the
          // lane's check and the commit. The batch rolled back whole, and the guest is told which of
          // the four it was, read back off the row, because each is a different remedy.
          if (caught instanceof GuardedWriteRefusedError && caught.guard === GUEST_ARRIVAL_GUARD) {
            const code = await whyTheSpendWasRefused(firm.firmDatabase, credential, now);
            recordArrivalRefused(c, code);
            return {
              refused: guestErrorResponse(c, new MeetingValidationError(code, "the link changed")),
            };
          }
          // THE DOOR MOVED UNDER THE ARRIVAL — the room was locked or ended, or the lobby filled, in
          // the round trip since the service read it. The row says which.
          if (caught instanceof GuardedWriteRefusedError && caught.guard === GUEST_DOOR_GUARD) {
            const meeting = await readMeetingForGuest(firm.firmDatabase, credential.meetingId);
            const code =
              meeting?.status === "ended"
                ? "meeting-already-ended"
                : meeting?.locked_at !== null && meeting?.locked_at !== undefined
                  ? "meeting-locked"
                  : "meeting-lobby-full";
            recordArrivalRefused(c, code);
            return {
              refused: guestErrorResponse(
                c,
                new MeetingValidationError(code, "the door moved while you were arriving"),
              ),
            };
          }
          if (
            isOpenGuestStayConflict(caught) ||
            (caught instanceof GuardedWriteRefusedError && caught.guard === GUEST_RETURN_GUARD)
          ) {
            return "retry";
          }
          throw caught;
        }
      };

      // AT MOST TWICE, and only for the two races where the second attempt is the right answer: two
      // browsers spending one link in the same instant (the index held one open stay, and the loser's
      // second attempt finds it and puts it back at the door under ITS name — never the winner's stay
      // handed across under the winner's name), and a host closing the open stay while this arrival
      // was taking it back to the door (the second attempt opens a fresh stay, or is refused as barred).
      // Either way the service re-reads everything, so the answer is decided on what is true now; a
      // third race in a row is a conflict the guest retries rather than a loop the Worker spins in.
      let outcome = await attemptArrival();
      if (outcome === "retry") outcome = await attemptArrival();
      if (outcome === "retry") {
        return problemJson(c, {
          type: "conflict",
          status: 409,
          title: "Somebody else arrived on this link at the same moment",
          detail: "Press Join again.",
        });
      }
      if ("refused" in outcome) return outcome.refused;
      const arrived = outcome.arrived;

      // AN ARRIVAL THAT CAME BACK TO AN OPEN STAY PUT IT BACK AT THE DOOR, and the room still holds
      // whoever had it — in the room, or at the door under the name the stay no longer carries. Told
      // AFTER the commit, and before the browser is answered, so their socket is gone before the
      // arriving browser can open its own: the room never holds the new arrival and the old seat at
      // once.
      if (arrived.returnedToOpenStay) {
        await meetingRoomFor(
          c.env,
          requireChokepointFirmId(c),
          credential.meetingId,
        ).guestCredentialReplaced(arrived.stayId);
      }

      // THE GRANT, minted after the stay committed and never stored: shorter-lived than the link, and
      // carrying the stay every frame and every later request names the guest by.
      const guestGrant = await mintGuestGrantToken(c.env.AUTH_SECRET, {
        firmId: requireChokepointFirmId(c),
        meetingId: credential.meetingId,
        invitationId: credential.invitationId,
        secretVersion: credential.secretVersion,
        stayId: arrived.stayId,
        expiresAt: guestGrantExpiresAt(now, arrived.linkExpiresAt),
      });
      const body = {
        waiting: true,
        participantId: arrived.stayId,
        displayName: arrived.confirmedName,
        iceServers: await iceServersFor(c),
        medium: arrived.medium,
        encrypted: arrived.encrypted,
        keyGroup: arrived.encrypted ? credential.meetingId : null,
        guestGrant,
      };
      return arrived.returnedToOpenStay ? c.json(body, 200) : c.json(body, 201);
    },
  );

  // GET /api/v1/guest/meeting/socket
  app.openapi(
    { ...socketRoute, middleware: chokepointMiddleware(chokepoint, socketRoute) },
    async (c) => {
      if (sfuClientForEnv(c.env) === null) return notConfigured(c);
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const grant = requireChokepointGuestGrant(c);

      // Asked before anything is read, for the member socket's reason: it is a question about the
      // REQUEST, and the page a guest opens is served from this application's own origin.
      if (!isSameOriginUpgrade(c.req.raw, c.env.APP_BASE_URL)) {
        return problemJson(c, {
          type: "permission-denied",
          status: 403,
          title: "Cross-origin signaling is refused",
          detail: "Open the meeting from the link you were sent.",
        });
      }

      const meetingId = grant.meetingId as MeetingId;
      const [meeting, stay, invitation] = await Promise.all([
        readMeetingForGuest(firm.firmDatabase, meetingId),
        grant.stayId === null
          ? Promise.resolve(undefined)
          : readGuestStayInMeeting(
              firm.firmDatabase,
              meetingId,
              grant.stayId as MeetingGuestStayId,
            ),
        readGuestInvitationInMeeting(
          firm.firmDatabase,
          meetingId,
          grant.invitationId as MeetingGuestInvitationId,
        ),
      ]);
      // THE OPEN STAY IS THE TICKET, as it is for a member — and it must be the stay THIS link opened.
      if (
        meeting === undefined ||
        invitation === undefined ||
        stay === undefined ||
        stay.invitation_id !== invitation.id ||
        stay.left_at !== null
      ) {
        return problemJson(c, {
          type: "meeting-not-joined",
          title: "You are not in this meeting",
          status: 409,
          detail: "Press Join on your link before opening the meeting.",
        });
      }

      if (!isWebSocketUpgrade(c.req.raw)) {
        return problemJson(c, {
          type: "websocket-upgrade-required",
          status: 426,
          title: "WebSocket upgrade required",
          detail: "This endpoint serves the meeting's signaling socket. Send Upgrade: websocket.",
        });
      }

      // Built from server-derived values only, exactly as the member's upgrade is — and marked a
      // GUEST's, which is what the room redacts every roster and message frame to this socket by.
      const upgraded = await meetingRoomFor(c.env, firmId, meetingId).fetch(
        meetingSocketRequest({
          medium: meeting.medium,
          firmId,
          meetingId,
          // A guest has no user id; the room carries the empty string and never puts it on the wire.
          userId: "",
          attendanceId: stay.id,
          displayName: stay.confirmed_name,
          // A guest can hold no grant on a meeting: the grant table's user column references members.
          hostRole: null,
          locked: meeting.locked_at !== null,
          lobby: meeting.lobby,
          encrypted: meeting.encrypted === 1,
          waiting: stay.admitted_at === null,
          waitingFrom: stay.waiting_from,
          participantKind: "guest",
          invitedName: invitation.invited_name,
        }),
      );
      // A GRANT THAT RODE THE SUBPROTOCOL IS ANSWERED BY NAME, as the WebSocket standard requires:
      // a browser that offered protocols fails a handshake whose answer names none of them. The
      // two-entry form is answered with the bare protocol name, so the credential never comes back
      // in a response header; the single-entry form can only be answered with itself.
      const offered = guestCredentialFromSocketProtocols(c.req.header("sec-websocket-protocol"));
      if (offered === null || upgraded.status !== 101) return upgraded;
      const headers = new Headers(upgraded.headers);
      headers.set("sec-websocket-protocol", offered.chosenProtocol);
      return new Response(null, { status: 101, webSocket: upgraded.webSocket, headers });
    },
  );

  // POST /api/v1/guest/departures
  app.openapi(
    { ...departRoute, middleware: chokepointMiddleware(chokepoint, departRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const grant = requireChokepointGuestGrant(c);
      if (grant.stayId === null) {
        return problemJson(c, {
          type: "meeting-not-joined",
          title: "You are not in this meeting",
          status: 409,
          detail: "You are not in this meeting.",
        });
      }
      const now = new Date().toISOString();
      let closed: boolean;
      try {
        const left = await leaveAsGuest(
          firm.firmDatabase,
          {
            meetingId: grant.meetingId as MeetingId,
            invitationId: grant.invitationId as MeetingGuestInvitationId,
            secretVersion: grant.secretVersion,
            stayId: grant.stayId as MeetingGuestStayId,
          },
          { clock: { now: () => now }, randomSource: cryptoRandomSource },
        );
        closed = left.closed;
        await commitEffectBatch(firm.firmDatabase, left.effect, { now: () => now });
      } catch (caught) {
        if (caught instanceof MeetingValidationError) return guestErrorResponse(c, caught);
        // The stay closed under the leave — a host removed them, or the meeting ended. What they
        // asked for is true.
        if (caught instanceof GuardedWriteRefusedError) return c.json({ ok: true } as const, 200);
        throw caught;
      }
      // Told AFTER the record commits, so nobody is dropped from a room by a write that then failed.
      if (closed) {
        await meetingRoomFor(c.env, requireChokepointFirmId(c), grant.meetingId).participantLeft(
          grant.stayId,
        );
      }
      return c.json({ ok: true } as const, 200);
    },
  );

  // GET /api/v1/guest/meeting/messages
  app.openapi(
    { ...listMessagesRoute, middleware: chokepointMiddleware(chokepoint, listMessagesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const grant = requireChokepointGuestGrant(c);
      const meetingId = grant.meetingId as MeetingId;
      try {
        await requireGuestInTheRoom(firm.firmDatabase, {
          meetingId,
          invitationId: grant.invitationId as MeetingGuestInvitationId,
          stayId: (grant.stayId ?? "") as MeetingGuestStayId,
        });
      } catch (caught) {
        if (caught instanceof MeetingValidationError) return guestErrorResponse(c, caught);
        throw caught;
      }
      const { cursor, since, sinceId } = c.req.valid("query");
      const found = await listMeetingMessages(firm.firmDatabase, meetingId, {
        cursor: decodeCursor(cursor),
        limit: MAX_MEETING_MESSAGE_PAGE_SIZE,
        since,
        sinceId,
      });
      const redacted =
        since === undefined
          ? []
          : await listMeetingMessagesRedactedSince(
              firm.firmDatabase,
              meetingId,
              since,
              MAX_MEETING_MESSAGE_PAGE_SIZE,
            );
      const hasMore = found.length > MAX_MEETING_MESSAGE_PAGE_SIZE;
      const rows = hasMore ? found.slice(0, MAX_MEETING_MESSAGE_PAGE_SIZE) : found;
      const last = rows.at(-1);
      return c.json(
        {
          // The member's transcript, with every firm user identifier taken out.
          data: rows.map(redactedForGuest),
          // A position rather than a has-more flag, for the member read's reason: a transcript is
          // followed, and a poller at the end keeps asking from exactly where it stopped.
          nextCursor: last === undefined ? null : encodeCursor(last.sentAt, last.id),
          redacted: [...redacted],
        },
        200,
      );
    },
  );

  // POST /api/v1/guest/meeting/messages
  app.openapi(
    { ...sendMessageRoute, middleware: chokepointMiddleware(chokepoint, sendMessageRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const grant = requireChokepointGuestGrant(c);
      const idempotency = requireChokepointIdempotency(c);
      const { body } = c.req.valid("json");
      const meetingId = grant.meetingId as MeetingId;

      const outcome = await commitChatEffect(c, firm.firmDatabase, idempotency, async () => {
        const sent = await postGuestMeetingMessage(
          firm.firmDatabase,
          {
            meetingId,
            invitationId: grant.invitationId as MeetingGuestInvitationId,
            stayId: (grant.stayId ?? "") as MeetingGuestStayId,
          },
          { body },
          { clock: { now: () => new Date().toISOString() }, randomSource: cryptoRandomSource },
        );
        return { message: sent.message, responseCode: 201, effect: sent.effect };
      });
      if (!outcome.ok) return outcome.problem;
      const message = await messageOnTheRecord(firm.firmDatabase, meetingId, outcome.messageId);
      // Relayed like every line — the room builds a guest's copy without identifiers itself.
      await meetingRoomFor(c.env, requireChokepointFirmId(c), meetingId).messageSent(message);
      return c.json(redactedForGuest(message), 201);
    },
  );
}
