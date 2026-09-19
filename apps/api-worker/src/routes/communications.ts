import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { encodeCursor } from "@magna-carta/data-access/cursor-pagination";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { decodeTimelineCursor } from "@magna-carta/calendar/merge";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import {
  logCommunication,
  routeCommunication,
  setCommunicationDisposition,
  unrouteCommunication,
  updateCommunication,
} from "@magna-carta/communications/communication-service";
import {
  countUnroutedCommunicationsStatement,
  readCommunication,
  selectCommunicationsStatement,
  type CommunicationWithMatterRow,
} from "@magna-carta/communications/communication-statements";
import {
  communicationNumberScope,
  isCommunicationNumberConflict,
  renderCommunicationNumber,
  COMMUNICATION_NUMBER_START_VALUE,
  COMMUNICATION_NUMBERING_TABLES,
} from "@magna-carta/communications/numbering";
import { drawWithBoundedRetry } from "@magna-carta/sequence-numbering/bounded-retry";
import { readCounterValue } from "@magna-carta/sequence-numbering/counter-statements";
import {
  COMMUNICATION_CHANNELS,
  COMMUNICATION_DIRECTIONS,
  COMMUNICATION_DISPOSITIONS,
  COMMUNICATION_SCOPES,
  MAX_CALL_DURATION_SECONDS,
  MAX_COMMUNICATION_BODY_LENGTH,
  MAX_COMMUNICATION_PAGE_SIZE,
  MAX_COMMUNICATION_SUMMARY_LENGTH,
  MAX_COUNTERPARTY_NUMBER_LENGTH,
} from "@magna-carta/communications/types";
import { CommunicationValidationError } from "@magna-carta/communications/validation";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { CommunicationId, MatterId } from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../bindings.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  assertAlsoHasPermission,
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointPermissions,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierField, identifierPathParam } from "../contracts/common.ts";
import { cursorQuery, paginated } from "../contracts/pagination.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";

// The call and text log's HTTP surface over @magna-carta/communications.
//
// TWO READS OF ONE TABLE, and the difference between them is the whole design. The firm-wide list
// holds the unassigned and the cross-matter; a matter's own list holds the assigned and the
// case-bound. Filing a call or a message onto a matter is the act that moves a row from the first to
// the second, and it exists only on the firm-wide surface — inside a matter the matter is already
// known, so there is nothing left to decide.
//
// THE UNROUTED QUEUE IS GATED SEPARATELY, and this is the part that would be easy to get wrong.
// Every routed row is narrowed to matters the member may see, so a walled matter contributes nothing
// to the firm-wide read. An UNROUTED row has no matter, so that narrowing has nothing to bite on —
// it would otherwise be readable by anyone holding the read key. What sits in that queue is whatever
// was said to the firm's number before anybody decided where it belonged, so it takes its own
// capability. Asking for the queue without the key is a refusal; browsing everything without the key
// simply does not include it.

const READ = "communications:read" as const;
const WRITE = "communications:log" as const;
const REVIEW_UNROUTED = "communications:reviewUnrouted" as const;

// ---- request/response contracts ----

const channelField = z.enum(COMMUNICATION_CHANNELS);
const directionField = z.enum(COMMUNICATION_DIRECTIONS);
const dispositionField = z.enum(COMMUNICATION_DISPOSITIONS);

const LogCommunicationRequest = z
  .object({
    channel: channelField,
    direction: directionField,
    // Optional, and an UNNUMBERED matter counts: matter_number is null until a matter opens, and an
    // intake or a consultation is a real anchor a first contact usually lands on. Omit it and the
    // row lands in the unrouted queue for somebody to file.
    matterId: identifierField("matter").nullable().optional(),
    counterpartyNumber: z.string().min(1).max(MAX_COUNTERPARTY_NUMBER_LENGTH),
    counterpartyEntityId: z.string().min(1).max(64).nullable().optional(),
    // Who was ON the call. Defaults to whoever is logging it, which is the overwhelmingly common
    // case; a receptionist logging the call they transferred is the other one.
    memberUserId: identifierField("user").nullable().optional(),
    occurredAt: z.string().datetime(),
    // When the line closed, which is NOT how long the call ran. A caller left on hold occupies the
    // span without spending it, so the two are recorded separately and neither is derived from the
    // other; a length that disagrees with the span is a fact about the call, not a contradiction.
    endedAt: z.string().datetime().nullable().optional(),
    durationSeconds: z.number().int().min(0).max(MAX_CALL_DURATION_SECONDS).nullable().optional(),
    body: z.string().max(MAX_COMMUNICATION_BODY_LENGTH).nullable().optional(),
    summary: z.string().max(MAX_COMMUNICATION_SUMMARY_LENGTH).nullable().optional(),
    // The other anchor: why this belongs to no matter. Not every call a firm takes is about a case —
    // spam, a wrong number, the landlord, a prospect who never came back — and a row that can only
    // be filed onto a matter sits in the queue forever. Refused together with matterId: a row is on
    // a matter, or set aside, never both.
    disposition: dispositionField.nullable().optional(),
  })
  .openapi("LogCommunicationRequest");

const SetDispositionRequest = z
  .object({ disposition: dispositionField })
  .openapi("SetCommunicationDispositionRequest");

// A CORRECTION, not a patch of arbitrary shape: every field a member could have mistyped, each
// optional and each keeping what the row holds when it is omitted. The ANCHOR is deliberately absent
// — a matter and a disposition move a row between queues through their own acts, and a correction to
// a summary must not be able to re-file a message somebody else has just filed.
const UpdateCommunicationRequest = z
  .object({
    channel: channelField.optional(),
    direction: directionField.optional(),
    counterpartyNumber: z.string().min(1).max(MAX_COUNTERPARTY_NUMBER_LENGTH).optional(),
    counterpartyEntityId: z.string().min(1).max(64).nullable().optional(),
    memberUserId: identifierField("user").nullable().optional(),
    occurredAt: z.string().datetime().optional(),
    endedAt: z.string().datetime().nullable().optional(),
    durationSeconds: z.number().int().min(0).max(MAX_CALL_DURATION_SECONDS).nullable().optional(),
    body: z.string().max(MAX_COMMUNICATION_BODY_LENGTH).nullable().optional(),
    summary: z.string().max(MAX_COMMUNICATION_SUMMARY_LENGTH).nullable().optional(),
  })
  .openapi("UpdateCommunicationRequest");

const RouteCommunicationRequest = z
  .object({ matterId: identifierField("matter") })
  .openapi("RouteCommunicationRequest");

const CommunicationDetail = z
  .object({
    id: z.string(),
    // The number the firm says out loud — the day the call happened and that day's own sequence,
    // "2026-09-08-0042". A handle is what the platform joins on; this is what a receptionist writes
    // on a message slip and reads back down a telephone. Null only on rows recorded before the
    // sequence existed and never numbered.
    referenceNumber: z.string().nullable(),
    channel: channelField,
    direction: directionField,
    // Null while the row is in the unrouted queue.
    matterId: z.string().nullable(),
    // The matter as it stands, resolved by the read rather than kept as a second copy that could
    // drift. The STATUS is not decoration: an anchor may be an intake or a consultation, and what
    // may be said to a prospect and to a client are different things, so somebody about to reply
    // needs to see which. matterNumber is null on exactly those, and the rung's own number — a
    // consultation's tentative one, an intake's — is what a surface shows in its place.
    matterTitle: z.string().nullable(),
    matterStatus: z.string().nullable(),
    matterNumber: z.string().nullable(),
    consultationNumber: z.string().nullable(),
    intakeNumber: z.string().nullable(),
    // Why the row belongs to no matter, where somebody has said so. Null on a filed row and on one
    // nobody has decided about yet — those two are told apart by matterId, not by this.
    disposition: dispositionField.nullable(),
    counterpartyNumber: z.string(),
    counterpartyEntityId: z.string().nullable(),
    memberUserId: z.string().nullable(),
    occurredAt: z.string(),
    // When the line closed. The span from occurredAt to here is how long the line was open;
    // durationSeconds is how long the call actually took. A caller on hold makes them differ, and
    // both are true.
    endedAt: z.string().nullable(),
    durationSeconds: z.number().nullable(),
    body: z.string().nullable(),
    summary: z.string().nullable(),
    // How the row came to exist. A member's recollection of a call and a carrier's report of the
    // same call carry different weight, and a surface that cannot tell them apart will present the
    // wrong one as fact.
    producer: z.enum(["member", "carrier"]),
    loggedByUserId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("CommunicationDetail");

const CommunicationPage = paginated(CommunicationDetail).openapi("CommunicationPage");
const UnroutedCount = z
  .object({ count: z.number().int().min(0) })
  .openapi("UnroutedCommunicationCount");
const CreatedResponse = z.object({ id: z.string() }).openapi("LoggedCommunication");
// The number a record HAS NOT BEEN GIVEN YET (owner ruling, 2026-09-08: a call should be
// identifiable in the log "before it has been created"). A person still on the telephone needs
// something to write on the slip and read back to the caller, and waiting for the save to answer is
// too late for the sentence they are in the middle of. It is what the next draw for that day WOULD
// render, so a concurrent recording can take it first — which is why the record's own number is
// read back from the record and this one is never stored anywhere.
const NextCommunicationNumber = z
  .object({ referenceNumber: z.string() })
  .openapi("NextCommunicationNumber");
const AcknowledgedResponse = z.object({ ok: z.literal(true) }).openapi("CommunicationAcknowledged");

const matterIdParam = z.object({ matterId: identifierPathParam("matter", "matterId") });
const communicationIdParam = z.object({
  communicationId: identifierPathParam("communication", "communicationId"),
});

const listQuery = cursorQuery.extend({
  scope: z.enum(COMMUNICATION_SCOPES).optional(),
  channel: channelField.optional(),
  // Matched against what was said and against the number. Searching by number is how people
  // actually look for a text — more often than by remembering a phrase in it.
  search: z.string().min(1).max(200).optional(),
});

// Which day's sequence to look in. The instant the form currently holds, because the number counts
// within the day the call HAPPENED and a call being recorded about last Tuesday draws Tuesday's next
// number. Omitted, it answers for now.
const nextNumberQuery = z.object({ occurredAt: z.string().datetime().optional() });

const matterListQuery = cursorQuery.extend({
  channel: channelField.optional(),
  search: z.string().min(1).max(200).optional(),
});

const authErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required permission",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the row is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "A request with this Idempotency-Key is still in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "The request body is not a shape this operation accepts",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limited",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

// ---- error mapping ----

function communicationErrorResponse(
  c: Context,
  caught: CommunicationValidationError,
): ProblemResponse<404> | ProblemResponse<422> {
  switch (caught.code) {
    case "communication-unknown":
    // 404 and not 403: which matter a call belongs to is itself a fact about the firm's work, and a
    // distinguishable refusal would let a caller probe for either.
    case "communication-unknown-matter":
    case "communication-matter-mismatch":
      return problemJson(c, {
        type: "not-found",
        title: "Not found",
        status: 404,
        detail: caught.message,
      });
    default:
      return problemJson(c, {
        type: "validation",
        title: "Communication request invalid",
        status: 422,
        detail: caught.message,
      });
  }
}

// ---- route metas ----

// Every communication route binds resource: "firm" rather than "matter", INCLUDING the matter-scoped
// list. A communication's matter is nullable by construction — an inbound text from an unrecognised
// number belongs to nobody until somebody files it — so a matter cannot be the tenancy root for a
// record that need not have one. This is the line tasks:* and custody:* already sit on. The
// matter-scoped read still composes the visible-matter predicate; the binding decides which root the
// chokepoint resolves, not what a read returns.
function readMeta(action: string): RouteMeta {
  return {
    operationId: `communications.${action}`,
    surface: "app",
    authenticated: true,
    permission: READ,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

function writeMeta(action: string): RouteMeta {
  return {
    operationId: `communications.${action}`,
    surface: "app",
    authenticated: true,
    permission: WRITE,
    resource: "firm",
    audited: true,
    // Required. A retried log must not put a second copy of the same call on the matter — two
    // identical accounts of one phone call, minutes apart, read as two calls, which is exactly the
    // wrong thing for a record whose whole value is saying what happened.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

// ---- routes ----

const listRoute = defineOpenAPIRoute(readMeta("list"), {
  method: "get",
  path: "/api/v1/communications",
  description:
    "The firm's calls and texts, most recent first, across every matter the member may see plus " +
    "the ones that belong to no matter yet. Narrow with scope: routed is everything already filed, " +
    "unrouted is the queue waiting to be filed. The unrouted rows require the review capability — " +
    "without it, scope=unrouted is refused and the other scopes simply omit them.",
  request: { query: listQuery },
  responses: {
    200: {
      description: "One page of calls and texts",
      content: { "application/json": { schema: CommunicationPage } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const unroutedCountRoute = defineOpenAPIRoute(
  { ...readMeta("unroutedCount"), permission: REVIEW_UNROUTED },
  {
    method: "get",
    path: "/api/v1/communications/unrouted-count",
    description:
      "How many calls and texts are waiting to be filed onto a matter. Counted rather than derived " +
      "from a page, because a queue somebody is meant to empty needs a number and not a plus sign.",
    request: {},
    responses: {
      200: {
        description: "The queue's size",
        content: { "application/json": { schema: UnroutedCount } },
      },
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      429: authErrors[429],
    },
  },
);

// The permission is the WRITE key rather than the read one: this answers a question only somebody
// about to record a call has, and the answer is a number the firm has not yet issued.
const nextNumberRoute = defineOpenAPIRoute(
  { ...readMeta("nextNumber"), permission: WRITE },
  {
    method: "get",
    path: "/api/v1/communications/next-number",
    description:
      "The reference number the next call or text recorded for that day would carry, so somebody " +
      "still on the telephone can write it down before the record exists. A preview and not a " +
      "reservation: nothing is drawn, and a call recorded first takes it.",
    request: { query: nextNumberQuery },
    responses: {
      200: {
        description: "The number the next record would draw",
        content: { "application/json": { schema: NextCommunicationNumber } },
      },
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      429: authErrors[429],
    },
  },
);

const listForMatterRoute = defineOpenAPIRoute(readMeta("listForMatter"), {
  method: "get",
  path: "/api/v1/matters/{matterId}/communications",
  description:
    "One matter's calls and texts, most recent first — what the matter's Messaging section reads. " +
    "The same rows the firm-wide list returns, narrowed to this matter; nothing unrouted appears " +
    "here, because a row with no matter is not on this one.",
  request: { params: matterIdParam, query: matterListQuery },
  responses: {
    200: {
      description: "One page of the matter's calls and texts",
      content: { "application/json": { schema: CommunicationPage } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const getRoute = defineOpenAPIRoute(readMeta("get"), {
  method: "get",
  path: "/api/v1/communications/{communicationId}",
  description:
    "One call or message by its id, through the same matter visibility the lists read under. A row " +
    "on a matter the member may not see is not found, never partially shown; an unrouted row needs " +
    "the review capability.",
  request: { params: communicationIdParam },
  responses: {
    200: {
      description: "The call or message",
      content: { "application/json": { schema: CommunicationDetail } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const logRoute = defineOpenAPIRoute(writeMeta("log"), {
  method: "post",
  path: "/api/v1/communications",
  description:
    "Records a call or a message that happened. Say when it happened, which is not when it was " +
    "typed: a call logged on Thursday about Tuesday carries Tuesday, and every list places it " +
    "there. Naming a matter files it straight onto that matter — an intake or a consultation " +
    "counts, so a prospect can be recorded before the file opens; omitting one leaves it in the " +
    "queue for somebody to file.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: LogCommunicationRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The logged call or message",
      content: { "application/json": { schema: CreatedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const routeToMatterRoute = defineOpenAPIRoute(writeMeta("routeToMatter"), {
  method: "post",
  path: "/api/v1/communications/{communicationId}/matter",
  description:
    "Files a call or a message onto a matter, taking it out of the queue. The matter needs a " +
    "status rather than a number: an intake and a consultation are both anchors, and only a closed " +
    "matter is refused. A row already on a matter is refused — take it off first.",
  request: {
    headers: idempotencyKeyHeader,
    params: communicationIdParam,
    body: {
      content: { "application/json": { schema: RouteCommunicationRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Filed",
      content: { "application/json": { schema: AcknowledgedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const unrouteFromMatterRoute = defineOpenAPIRoute(
  {
    ...writeMeta("unrouteFromMatter"),
    // Putting it back is filing it again, and it really is the same act: nothing was destroyed, the
    // row went back to the queue with its words and its instant intact, so the matter it names is the
    // only fact that changed and re-naming one restores it exactly.
    reversal: { kind: "inverse", by: "communications.routeToMatter" },
  },
  {
    method: "delete",
    path: "/api/v1/communications/{communicationId}/matter",
    description:
      "Takes a call or a message off the matter it was filed to. The row returns to the queue rather " +
      "than being deleted: what was said still happened, and a message taken off the wrong matter " +
      "has to land somewhere a person will see it again.",
    request: { headers: idempotencyKeyHeader, params: communicationIdParam },
    responses: {
      200: {
        description: "Taken off",
        content: { "application/json": { schema: AcknowledgedResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const setDispositionRoute = defineOpenAPIRoute(writeMeta("setDisposition"), {
  method: "post",
  path: "/api/v1/communications/{communicationId}/disposition",
  description:
    "Sets a call or a message aside as something that belongs to no matter — spam or a wrong " +
    "number, the firm's own business, or a prospect nothing came of. It leaves the queue without " +
    "being filed and without being deleted, because what was said still happened. A row already on " +
    "a matter is refused: take it off first.",
  request: {
    headers: idempotencyKeyHeader,
    params: communicationIdParam,
    body: { content: { "application/json": { schema: SetDispositionRequest } }, required: true },
  },
  responses: {
    200: {
      description: "Set aside",
      content: { "application/json": { schema: AcknowledgedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const clearDispositionRoute = defineOpenAPIRoute(
  {
    ...writeMeta("clearDisposition"),
    // Putting it back in the queue is the exact inverse: nothing was destroyed, and the row returns
    // with its words, its number and its instant intact.
    reversal: { kind: "inverse", by: "communications.setDisposition" },
  },
  {
    method: "delete",
    path: "/api/v1/communications/{communicationId}/disposition",
    description:
      "Returns a set-aside call or message to the queue — what a firm does when it decides " +
      "something it had written off is real work after all.",
    request: { headers: idempotencyKeyHeader, params: communicationIdParam },
    responses: {
      200: {
        description: "Back in the queue",
        content: { "application/json": { schema: AcknowledgedResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const updateRoute = defineOpenAPIRoute(writeMeta("update"), {
  method: "patch",
  path: "/api/v1/communications/{communicationId}",
  description:
    "Corrects a call or a message somebody recorded — a digit in the number, the wrong direction, " +
    "a length in the wrong units, what was said. An omitted field keeps what the record holds. The " +
    "matter and the set-aside reason are not changeable here: each moves the row between queues " +
    "through its own operation. A carrier-written record is refused, because it is what the network " +
    "reported rather than somebody's recollection.",
  request: {
    headers: idempotencyKeyHeader,
    params: communicationIdParam,
    body: {
      content: { "application/json": { schema: UpdateCommunicationRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Corrected",
      content: { "application/json": { schema: AcknowledgedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

// ---- helpers ----

function serviceOptions(userId: string, mayReviewQueue: boolean) {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: userId as never,
    randomSource: cryptoRandomSource,
    // The same predicate the federated timeline composes, so an id-addressed write cannot reach a
    // row a list read could not.
    visibility: visibleMatterPredicate(),
    mayReviewUnrouted: mayReviewQueue,
  };
}

function communicationDetail(row: CommunicationWithMatterRow): z.infer<typeof CommunicationDetail> {
  return {
    id: row.id,
    referenceNumber: row.reference_number,
    channel: row.channel,
    direction: row.direction,
    matterId: row.matter_id,
    matterTitle: row.matter_title,
    matterStatus: row.matter_status,
    matterNumber: row.matter_number,
    consultationNumber: row.consultation_number,
    intakeNumber: row.intake_number,
    disposition: row.disposition,
    counterpartyNumber: row.counterparty_number,
    counterpartyEntityId: row.counterparty_entity_id,
    memberUserId: row.member_user_id,
    occurredAt: row.occurred_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    body: row.body,
    summary: row.summary,
    producer: row.producer,
    loggedByUserId: row.logged_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function readPage(
  database: SqlDatabase,
  options: {
    readonly cursor: string | undefined;
    readonly includeUnrouted: boolean;
    readonly scope?: z.infer<typeof listQuery>["scope"];
    readonly channel?: z.infer<typeof channelField>;
    readonly search?: string;
    readonly matterId?: MatterId;
  },
): Promise<{ data: z.infer<typeof CommunicationDetail>[]; nextCursor: string | null }> {
  const decoded = decodeTimelineCursor(options.cursor);
  const { results } = await selectCommunicationsStatement(database, {
    cursor: decoded === undefined ? undefined : { sortKey: decoded.sortKey, id: decoded.id },
    limit: MAX_COMMUNICATION_PAGE_SIZE + 1,
    visibility: visibleMatterPredicate(),
    includeUnrouted: options.includeUnrouted,
    scope: options.scope,
    channel: options.channel,
    search: options.search,
    matterId: options.matterId,
  }).all<CommunicationWithMatterRow>();
  const hasMore = results.length > MAX_COMMUNICATION_PAGE_SIZE;
  const rows = hasMore ? results.slice(0, MAX_COMMUNICATION_PAGE_SIZE) : results;
  const last = rows.at(-1);
  return {
    data: rows.map((row) => communicationDetail(row)),
    // Keyed on the same expression the list is ordered by, so the walk cannot skip or repeat.
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.occurred_at, last.id) : null,
  };
}

/** The clock the idempotency gate stamps its records with. */
function nowInstant(): string {
  return new Date().toISOString();
}

type EffectOutcome =
  | { ok: true; id: string; replayed: boolean }
  | { ok: false; problem: ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> };

async function commitEffect(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  responseCode: number,
  call: () => Promise<{ id: string; effect: EffectWrite }>,
): Promise<EffectOutcome> {
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now: nowInstant,
      effect: async () => {
        const { id, effect } = await call();
        return {
          write: effect,
          responseCode,
          // The stored body IS the wire body: the idempotency gate replays it verbatim.
          responseBody: canonicalJsonStringify({ id }),
        };
      },
    });
  } catch (caught) {
    if (caught instanceof CommunicationValidationError) {
      return { ok: false, problem: communicationErrorResponse(c, caught) };
    }
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  }
  const stored = JSON.parse(result.responseBody ?? "{}") as { id: string };
  return { ok: true, id: stored.id, replayed: result.kind === "replayed" };
}

function mayReviewUnrouted(c: Context<{ Bindings: Bindings; Variables: AppVariables }>): boolean {
  return requireChokepointPermissions(c).has(REVIEW_UNROUTED as never);
}

export function registerCommunicationsRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // GET /api/v1/communications
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { cursor, scope, channel, search } = c.req.valid("query");
      const mayReview = mayReviewUnrouted(c);
      // Asking for the queue — or for what has been set aside, which is the same rows on the other
      // side of a decision — without the key is a refusal, in the identical shape the chokepoint's
      // own denial takes. Browsing without it is not: the other scopes simply omit those rows.
      if ((scope === "unrouted" || scope === "setAside") && !mayReview) {
        const denial = assertAlsoHasPermission(c, REVIEW_UNROUTED);
        if (denial !== null) return denial;
      }
      return c.json(
        await readPage(firm.firmDatabase, {
          cursor,
          includeUnrouted: mayReview,
          scope,
          channel,
          search,
        }),
        200,
      );
    },
  );

  // GET /api/v1/communications/unrouted-count
  app.openapi(
    { ...unroutedCountRoute, middleware: chokepointMiddleware(chokepoint, unroutedCountRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { results } = await countUnroutedCommunicationsStatement(firm.firmDatabase).all<{
        count: number;
      }>();
      return c.json({ count: results[0]?.count ?? 0 }, 200);
    },
  );

  // GET /api/v1/communications/next-number
  // Registered before the id-addressed read below, so "next-number" is matched as itself rather
  // than as a communication handle.
  app.openapi(
    { ...nextNumberRoute, middleware: chokepointMiddleware(chokepoint, nextNumberRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { occurredAt } = c.req.valid("query");
      // Canonicalized before the day is taken from it: the query accepts any ISO-8601 instant and
      // the scope key is the UTC day of a CANONICAL one.
      const instant = new Date(occurredAt ?? nowInstant());
      const scopeKey = communicationNumberScope(
        Number.isNaN(instant.getTime()) ? nowInstant() : instant.toISOString(),
      );
      const observed =
        (await readCounterValue(firm.firmDatabase, COMMUNICATION_NUMBERING_TABLES, scopeKey)) ??
        COMMUNICATION_NUMBER_START_VALUE;
      return c.json({ referenceNumber: renderCommunicationNumber(scopeKey, observed) }, 200);
    },
  );

  // GET /api/v1/matters/{matterId}/communications
  app.openapi(
    { ...listForMatterRoute, middleware: chokepointMiddleware(chokepoint, listForMatterRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const { cursor, channel, search } = c.req.valid("query");
      return c.json(
        await readPage(firm.firmDatabase, {
          cursor,
          // Naming a matter already excludes every unrouted row, so the flag would change nothing
          // here. It is passed as false rather than omitted so the read stays narrow by default if
          // the statement's shape ever changes.
          includeUnrouted: false,
          channel,
          search,
          matterId: matterId as MatterId,
        }),
        200,
      );
    },
  );

  // GET /api/v1/communications/{communicationId}
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { communicationId } = c.req.valid("param");
      const row = await readCommunication(
        firm.firmDatabase,
        communicationId as CommunicationId,
        visibleMatterPredicate(),
        mayReviewUnrouted(c),
      );
      if (row === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such call or message in this firm.",
        });
      }
      return c.json(communicationDetail(row), 200);
    },
  );

  // POST /api/v1/communications
  app.openapi(
    { ...logRoute, middleware: chokepointMiddleware(chokepoint, logRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      const mayReview = mayReviewUnrouted(c);
      // THE NUMBER IS DRAWN INSIDE THE WRITE, so the record and its number are one batch or neither.
      // A concurrent recording on the same day that took the value first aborts this batch on the
      // partial unique index over the rendered number; the shared loop advances the counter out of
      // band — the in-batch increment rolled back with everything else — and runs this again, which
      // renders the next number. The idempotency gate is INSIDE the retry, on the matter draw's
      // arrangement: a replay answers from the stored body without drawing anything.
      const outcome = await drawWithBoundedRetry(
        firm.firmDatabase,
        COMMUNICATION_NUMBERING_TABLES,
        {
          sequenceLabel: "communication reference number",
          alsoRetryable: isCommunicationNumberConflict,
          // No named refusal: losing five consecutive races on one day's counter is not a state a
          // person can be told anything useful about, so it stays an unexpected fault the standard
          // pipeline reports and correlates. Written out rather than inherited, as the loop insists.
          nonConvergenceError: ({ message }) => new Error(message),
        },
        async (observe) =>
          await commitEffect(c, firm.firmDatabase, idempotency, 201, async () => {
            const created = await logCommunication(
              firm.firmDatabase,
              { ...request, matterId: (request.matterId ?? null) as MatterId | null },
              { ...serviceOptions(userId, mayReview), observeDraw: observe },
            );
            return { id: created.communicationId, effect: created.effect };
          }),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id }, 201);
    },
  );

  // POST /api/v1/communications/{communicationId}/matter
  app.openapi(
    { ...routeToMatterRoute, middleware: chokepointMiddleware(chokepoint, routeToMatterRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { communicationId } = c.req.valid("param");
      const { matterId } = c.req.valid("json");
      // Filing necessarily READS an unrouted row on its way, so the act is gated by the same key as
      // looking at the queue. Without this, the queue could be worked by id from outside the
      // permission that reveals it.
      const denial = assertAlsoHasPermission(c, REVIEW_UNROUTED);
      if (denial !== null) return denial;
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await routeCommunication(
          firm.firmDatabase,
          communicationId as CommunicationId,
          matterId as MatterId,
          serviceOptions(userId, true),
        );
        return { id: communicationId, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // POST /api/v1/communications/{communicationId}/disposition
  app.openapi(
    { ...setDispositionRoute, middleware: chokepointMiddleware(chokepoint, setDispositionRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { communicationId } = c.req.valid("param");
      const { disposition } = c.req.valid("json");
      // Setting one aside necessarily READS an unrouted row on its way, exactly as filing one does,
      // so it is gated by the same key as looking at the queue.
      const denial = assertAlsoHasPermission(c, REVIEW_UNROUTED);
      if (denial !== null) return denial;
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await setCommunicationDisposition(
          firm.firmDatabase,
          communicationId as CommunicationId,
          disposition,
          serviceOptions(userId, true),
        );
        return { id: communicationId, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // DELETE /api/v1/communications/{communicationId}/disposition
  app.openapi(
    {
      ...clearDispositionRoute,
      middleware: chokepointMiddleware(chokepoint, clearDispositionRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { communicationId } = c.req.valid("param");
      const denial = assertAlsoHasPermission(c, REVIEW_UNROUTED);
      if (denial !== null) return denial;
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await setCommunicationDisposition(
          firm.firmDatabase,
          communicationId as CommunicationId,
          null,
          serviceOptions(userId, true),
        );
        return { id: communicationId, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // PATCH /api/v1/communications/{communicationId}
  app.openapi(
    { ...updateRoute, middleware: chokepointMiddleware(chokepoint, updateRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { communicationId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await updateCommunication(
          firm.firmDatabase,
          communicationId as CommunicationId,
          request,
          // A row waiting in the queue is correctable by whoever may see it, which is the same key
          // that reveals it; a filed row needs no queue capability at all.
          serviceOptions(userId, mayReviewUnrouted(c)),
        );
        return { id: communicationId, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // DELETE /api/v1/communications/{communicationId}/matter
  app.openapi(
    {
      ...unrouteFromMatterRoute,
      middleware: chokepointMiddleware(chokepoint, unrouteFromMatterRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { communicationId } = c.req.valid("param");
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await unrouteCommunication(
          firm.firmDatabase,
          communicationId as CommunicationId,
          // The row being taken off HAS a matter, so reaching it needs no queue capability — this
          // is the one write path a member without the review key may legitimately perform.
          serviceOptions(userId, mayReviewUnrouted(c)),
        );
        return { id: communicationId, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );
}
