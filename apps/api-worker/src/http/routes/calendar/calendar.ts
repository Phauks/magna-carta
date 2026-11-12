import { endToEndEncryptionEnabled } from "../../../meetings/encryption-switch.ts";
import { invitedMembers, meetingInvitations } from "./meeting-invitations.ts";
import { CIVIL_DATE_PATTERN, civilDateOf, todayInUtc } from "@magna-carta/civil-time/civil-date";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  closeMatterDeadline,
  createMatterDeadline,
  satisfyMatterDeadline,
  updateMatterDeadline,
} from "@magna-carta/calendar/deadline-service";
import {
  readOpenDeadlineTimeZones,
  selectMatterDeadlinesStatement,
  type MatterDeadlineRow,
} from "@magna-carta/calendar/deadline-statements";
import {
  cancelMatterEvent,
  createMatterEvent,
  updateMatterEvent,
} from "@magna-carta/calendar/event-service";
import {
  readMatterEventDetail,
  readMatterEventParticipants,
  selectMatterEventsStatement,
  type MatterEventDisplayRow,
} from "@magna-carta/calendar/event-statements";
import {
  createFirmResourceBooking,
  deleteFirmResourceBooking,
  readResourceAvailability,
  updateFirmResourceBooking,
  type BookingConflict,
} from "@magna-carta/calendar/booking-service";
import {
  readBookingsForEvent,
  type LiveBookingRow,
} from "@magna-carta/calendar/booking-statements";
import {
  continueMatterEvent,
  readContinuanceChain,
} from "@magna-carta/calendar/continuance-service";
import {
  cancelFirmEvent,
  createFirmEvent,
  updateFirmEvent,
} from "@magna-carta/calendar/firm-event-service";
import {
  readFirmEvent,
  readFirmEventParticipants,
  selectFirmEventsStatement,
  type FirmEventRow,
} from "@magna-carta/calendar/firm-event-statements";
import { createRelatedLink, deleteRelatedLink } from "@magna-carta/calendar/link-service";
import {
  readContinuanceLinksForEvents,
  readLinksTouchingEvent,
  type LinkEnd,
} from "@magna-carta/calendar/link-statements";
import { createFirmResource, updateFirmResource } from "@magna-carta/calendar/resource-service";
import {
  readFirmResource,
  readFirmResources,
  type FirmResourceRow,
} from "@magna-carta/calendar/resource-statements";
import {
  createMatterEventType,
  deactivateMatterEventType,
  updateMatterEventType,
} from "@magna-carta/calendar/event-type-service";
import {
  readCalendarWeekStartsOn,
  writeCalendarWeekStartsOnStatement,
  type WeekStartsOn,
} from "@magna-carta/calendar/settings";
import {
  AcknowledgedResponse,
  BookingConflictDetail,
  BookingCreatedResponse,
  BookingUpdatedResponse,
  CalendarSettingsResponse,
  CancelEventRequest,
  CloseDeadlineRequest,
  ContinuanceChain,
  ContinueEventRequest,
  ContinueEventResponse,
  CreateBookingRequest,
  CreateDeadlineRequest,
  CreateEventLinkRequest,
  CreateEventTypeRequest,
  CreateResourceRequest,
  CreatedResponse,
  EventRecordedResponse,
  EventUpdatedResponse,
  DeadlineDetail,
  EventBooking,
  EventBookings,
  EventDetail,
  EventLinks,
  FirmCalendarPage,
  FirmEventDetail,
  FirmEventPage,
  FirmEventWithParticipants,
  FirmResourceList,
  MatterDeadlinePage,
  MatterEventPage,
  MatterEventTypeList,
  MatterEventWithParticipants,
  PatchCalendarSettingsRequest,
  ResourceAvailability,
  ResourceDetail,
  SatisfyDeadlineRequest,
  TimelineEntryPage,
  UpdateBookingRequest,
  UpdateDeadlineRequest,
  UpdateEventTypeRequest,
  UpdateResourceRequest,
  firmEventRequestFields,
  matterEventRequestFields,
  ParticipantRequest,
} from "@magna-carta/calendar/contract";
import { readMatterEventTypes } from "@magna-carta/calendar/event-type-statements";
import { encodeCursor } from "@magna-carta/data-access/cursor-pagination";
import { decodeTimelineCursor } from "@magna-carta/calendar/merge";
import { isOverdue, overdueCutoffFor, type OverdueCutoff } from "@magna-carta/calendar/overdue";
import { timelineSourceRegistry } from "@magna-carta/calendar/sources/all";
import { readTimelinePage } from "@magna-carta/calendar/timeline";
import {
  CALENDAR_SCOPES,
  FIRM_RESOURCE_KINDS,
  MATTER_DEADLINE_STATES,
  CALENDAR_EVENT_LINK_KINDS,
  MATTER_EVENT_STATUSES,
  MAX_CALENDAR_WINDOW_DAYS,
  MAX_DEADLINE_HORIZON_DAYS,
  TIMELINE_DIRECTIONS,
} from "@magna-carta/calendar/types";
import {
  CalendarValidationError,
  assertCalendarWindow,
  assertDeadlineHorizon,
} from "@magna-carta/calendar/validation";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import {
  CANCEL_CLOSING_GUARD,
  createMeeting,
  endScheduledMeetingForCancelledEvent,
  openMeetingOnEvent,
} from "@magna-carta/meetings/meeting-service";
import { STOP_RECORDING_GUARD } from "@magna-carta/meetings/recording-service";
import { readMeetingForEvent } from "@magna-carta/meetings/meeting-statements";
import { MEETING_LOBBY_MODES } from "@magna-carta/meetings/lobby-types";
import { MEETING_MEDIA, type MeetingEventKind } from "@magna-carta/meetings/types";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type {
  CalendarEventLinkId,
  FirmEventId,
  FirmResourceBookingId,
  FirmResourceId,
  MatterDeadlineId,
  MatterEventId,
  MatterId,
} from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointPermissions,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { assertPermission } from "@magna-carta/access-control/registry";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { identifierField } from "@magna-carta/identifiers/field";
import { cursorQuery } from "@magna-carta/data-access/pagination-contract";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// The case calendar's HTTP surface over @magna-carta/calendar: recording what happens in a case,
// recording the dates the firm must act by, and reading the matter timeline that federates both with
// everything else the firm already recorded.
//
// Two things this surface never does, and they are the subsystem's whole position. It never computes
// a deadline date from a court rule — every date here is one a person supplied. And it never writes
// "missed": whether a deadline is overdue is a comparison against now, made when a page is read.

const READ = "calendar:read" as const;
const MANAGE = "calendar:manage" as const;

const CIVIL_DATE = CIVIL_DATE_PATTERN;

// ---- the event writes: the calendar's fields, with a meeting on them ----
//
// The two event writes take one field the calendar package cannot describe: the meeting a member may
// open on the event, whose vocabularies belong to @magna-carta/meetings, which already depends on the
// calendar package. The fields live in packages/calendar/src/contract.ts; the request shapes are
// composed here, the one place both packages are in scope.

// SCHEDULING A MEETING IS RECORDING AN EVENT WITH A MEDIUM ON IT. There is no second record and no
// second form: a member answers one more question on the event they were recording anyway, and the
// save opens the room the entry window then offers Join on from the moment the event exists.
//
// Absent or null means no meeting, which is what almost every hearing and filing is. A medium is
// chosen once and never changed — the people already in a room agreed to one thing — so this field
// on an UPDATE adds a meeting to an event that has none and can never widen one that has.
const MeetingRequest = z
  .object({
    // Sound alone, or sound and pictures.
    medium: z.enum(MEETING_MEDIA),
    // WHETHER ARRIVALS WAIT AT A DOOR, decided as the room is opened and by the same person who
    // decided there would be one. It is optional and defaults to `off` because that is what every
    // meeting scheduled before the door existed was, and because a form that did not ask must not
    // silently put a firm's colleagues in a queue. Read on the CREATE path only, exactly as the
    // medium beside it is: a meeting's door is then moved through the lobby route, which writes the
    // record and tells the room, rather than through a re-save of the calendar entry.
    lobby: z.enum(MEETING_LOBBY_MODES).default("off"),
  })
  .openapi("CalendarEventMeetingInput");

const CreateEventRequest = z
  .object({ ...matterEventRequestFields, meeting: MeetingRequest.nullable().optional() })
  .openapi("CreateMatterEventRequest");

const UpdateEventRequest = CreateEventRequest.partial().openapi("UpdateMatterEventRequest");

const CreateFirmEventRequest = z
  .object({ ...firmEventRequestFields, meeting: MeetingRequest.nullable().optional() })
  .openapi("CreateFirmEventRequest");

const UpdateFirmEventRequest = CreateFirmEventRequest.partial().openapi("UpdateFirmEventRequest");

const firmEventsQuery = cursorQuery.extend({
  // Required and capped, exactly as the firm calendar's window is: a wider window is refused, never
  // silently narrowed.
  from: z.string().regex(CIVIL_DATE),
  to: z.string().regex(CIVIL_DATE),
  status: z.enum(MATTER_EVENT_STATUSES).optional(),
  eventTypeId: identifierField("matterEventType").optional(),
});

const resourcesQuery = z.object({
  kind: z.enum(FIRM_RESOURCE_KINDS).optional(),
  locationId: identifierField("location").optional(),
  includeInactive: z.enum(["true", "false"]).optional(),
});

const availabilityQuery = z.object({
  from: z.string().regex(CIVIL_DATE),
  to: z.string().regex(CIVIL_DATE),
});

function eventBooking(row: LiveBookingRow): z.infer<typeof EventBooking> {
  return {
    id: row.id,
    resourceId: row.resource_id,
    startsOn: row.starts_on,
    startsAtTime: row.starts_at_time,
    endsOn: row.ends_on,
    endsAtTime: row.ends_at_time,
    timeZone: row.time_zone,
  };
}

const matterIdParam = z.object({ matterId: identifierPathParam("matter", "matterId") });
const eventIdParam = z.object({ eventId: identifierPathParam("matterEvent", "eventId") });
const deadlineIdParam = z.object({
  deadlineId: identifierPathParam("matterDeadline", "deadlineId"),
});
const eventTypeIdParam = z.object({
  eventTypeId: identifierPathParam("matterEventType", "eventTypeId"),
});
const firmEventIdParam = z.object({
  firmEventId: identifierPathParam("firmEvent", "firmEventId"),
});
const firmResourceIdParam = z.object({
  firmResourceId: identifierPathParam("firmResource", "firmResourceId"),
});
const firmResourceBookingIdParam = z.object({
  firmResourceBookingId: identifierPathParam("firmResourceBooking", "firmResourceBookingId"),
});
const calendarEventLinkIdParam = z.object({
  calendarEventLinkId: identifierPathParam("calendarEventLink", "calendarEventLinkId"),
});

const timelineQuery = cursorQuery.extend({
  // Repeatable. Narrows the REGISTRY before any statement is built, so a single-kind request issues
  // one statement rather than one per source.
  kind: z.union([z.string(), z.array(z.string())]).optional(),
  from: z.string().regex(CIVIL_DATE).optional(),
  to: z.string().regex(CIVIL_DATE).optional(),
  // Which half of the case to read. Resolved into the same civil-date bounds `from`/`to` carry, so
  // it narrows in SQL like every other filter and never trims a page after the fact. `all` is the
  // default, because "what has happened" and "what is coming" are one list read in one order.
  direction: z.enum(TIMELINE_DIRECTIONS).optional(),
});

const firmCalendarQuery = cursorQuery.extend({
  // Required and capped. A window wider than the cap is REFUSED, never silently clamped: a caller
  // that asked for three years and quietly received one cannot tell that from a firm with nothing
  // recorded in years two and three.
  from: z.string().regex(CIVIL_DATE),
  to: z.string().regex(CIVIL_DATE),
  matterId: identifierField("matter").optional(),
  // Matches a matter event's participants (or the matter's responsible member) and a firm event
  // when the member is a participant OR the event's audience is all_members — a firm holiday is on
  // everyone's answer to "what is on my calendar".
  memberId: identifierField("user").optional(),
  kind: z.union([z.string(), z.array(z.string())]).optional(),
  // Which side of the calendar to read: matter-anchored sources, firm-anchored sources, or both.
  // Narrows the registry before any statement is built, exactly as kind does.
  scope: z.enum(CALENDAR_SCOPES).optional(),
});

const deadlineQuery = cursorQuery.extend({
  matterId: identifierField("matter").optional(),
  state: z.enum(MATTER_DEADLINE_STATES).optional(),
  from: z.string().regex(CIVIL_DATE).optional(),
  through: z.string().regex(CIVIL_DATE).optional(),
  // Narrows to the deadlines that are genuinely overdue IN THEIR OWN ZONES — the same comparison the
  // per-row `overdue` flag reports, composed into the SQL before the LIMIT rather than applied to the
  // rows afterwards. Implies `state=open`; `through` is ignored alongside it, since the narrowing
  // carries its own upper bound.
  overdue: z.enum(["true", "false"]).optional(),
});

// ---- shared error responses ----

export const authErrors = {
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
    description: "The firm is unreachable, the member is deactivated, or the resource is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "A request with this Idempotency-Key is still in progress, or the record is settled",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, or the Idempotency-Key was reused with a different payload",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

// Maps a calendar refusal to its problem. Codes — never messages — drive it.
function calendarErrorResponse(
  c: Context,
  caught: CalendarValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  switch (caught.code) {
    case "calendar-unknown-event":
    case "calendar-unknown-event-type":
    case "calendar-unknown-deadline":
    case "calendar-unknown-firm-event":
    case "calendar-unknown-resource":
    case "calendar-unknown-booking":
    case "calendar-unknown-link":
      return problemJson(c, {
        type: "not-found",
        title: "Not found",
        status: 404,
        detail: caught.message,
      });
    case "calendar-deadline-not-open":
      return problemJson(c, {
        type: "calendar-deadline-settled",
        title: "Deadline already settled",
        status: 409,
        detail: caught.message,
      });
    case "calendar-event-not-continuable":
      return problemJson(c, {
        type: "calendar-event-not-continuable",
        title: "Setting cannot be continued",
        status: 409,
        detail: caught.message,
      });
    case "calendar-resource-inactive":
      return problemJson(c, {
        type: "calendar-resource-inactive",
        title: "Resource deactivated",
        status: 422,
        detail: caught.message,
      });
    case "calendar-resource-name-taken":
      return problemJson(c, {
        type: "calendar-resource-name-taken",
        title: "Resource name taken",
        status: 422,
        detail: caught.message,
      });
    case "calendar-duplicate-link":
      return problemJson(c, {
        type: "calendar-duplicate-link",
        title: "Already related",
        status: 422,
        detail: caught.message,
      });
    case "calendar-continuance-link-immutable":
      return problemJson(c, {
        type: "calendar-continuance-link-immutable",
        title: "Continuance link is history",
        status: 422,
        detail: caught.message,
      });
    case "calendar-continuance-chain-too-deep":
      return problemJson(c, {
        type: "calendar-continuance-chain-too-deep",
        title: "Continuance chain too deep",
        status: 422,
        detail: caught.message,
      });
    case "calendar-window-too-wide":
      return problemJson(c, {
        type: "calendar-window-too-wide",
        title: "Window too wide",
        status: 422,
        detail: caught.message,
      });
    case "calendar-deadline-catalog-unavailable":
      return problemJson(c, {
        type: "calendar-deadline-catalog-unavailable",
        title: "No deadline catalog is encoded",
        status: 422,
        detail: caught.message,
      });
    case "calendar-platform-type-immutable":
      return problemJson(c, {
        type: "calendar-platform-type-immutable",
        title: "Platform event type",
        status: 422,
        detail: caught.message,
      });
    case "calendar-event-type-category-mismatch":
      return problemJson(c, {
        type: "calendar-event-type-category-mismatch",
        title: "Event type is from another category",
        status: 422,
        detail: caught.message,
      });
    default:
      return problemJson(c, {
        type: "validation",
        title: "Calendar request invalid",
        status: 422,
        detail: caught.message,
      });
  }
}

// A READ can only refuse two ways — the resource is unknown, or the request asks for more than one
// read may return. It is typed narrowly so a read route never has to declare a conflict response it
// cannot produce.
export function calendarReadErrorResponse(
  c: Context,
  caught: CalendarValidationError,
): ProblemResponse<404> | ProblemResponse<422> {
  const response = calendarErrorResponse(c, caught);
  if (response.status === 409) {
    return problemJson(c, {
      type: "validation",
      title: "Calendar request invalid",
      status: 422,
      detail: caught.message,
    });
  }
  return response as ProblemResponse<404> | ProblemResponse<422>;
}

// ---- route metas ----

export function readMeta(action: string, resource: RouteMeta["resource"]): RouteMeta {
  return {
    operationId: `calendar.${action}`,
    surface: "app",
    authenticated: true,
    permission: READ,
    resource,
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

export function mutationMeta(action: string, resource: RouteMeta["resource"]): RouteMeta {
  return {
    operationId: `calendar.${action}`,
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    resource,
    audited: true,
    // Required: a retried request must not put a second hearing on the calendar.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const timelineRoute = defineOpenAPIRoute(readMeta("matterTimeline", "matter"), {
  method: "get",
  path: "/api/v1/matters/{matterId}/timeline",
  description:
    "The matter's timeline, newest first: the events and deadlines recorded here merged with what " +
    "every other part of the platform already recorded about this case — documents filed, mail " +
    "captured, documents assembled, originals moved, client money moved, time and costs booked, " +
    "conflicts checks run, and the matter's own opening and closing. Nothing is copied into a " +
    "timeline table: each entry is read in place from the record its own subsystem keeps, so the " +
    "timeline cannot disagree with the register behind it. An entry carries identifiers, a kind, and " +
    "a non-privileged summary where its source has one. On this matter-scoped read each source " +
    "also NAMES its rows — a title, its own word for what the row is, and its own facts — for the " +
    "sources whose read capability the member holds; the words are absent, never invented, where " +
    "a source has none to give or the member may not read them. `kind` is repeatable and narrows " +
    "which sources are read at all.",
  request: { params: matterIdParam, query: timelineQuery },
  responses: {
    200: {
      description: "One page of the timeline",
      content: {
        "application/json": {
          schema: TimelineEntryPage,
        },
      },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const listEventsRoute = defineOpenAPIRoute(readMeta("listEvents", "matter"), {
  method: "get",
  path: "/api/v1/matters/{matterId}/events",
  description:
    "The matter's recorded events on their own, newest first and without the federation — what an " +
    "editing surface reads. Each event carries its full detail, including its title, its wall-clock " +
    "time, and the time zone that time is read in.",
  request: { params: matterIdParam, query: cursorQuery },
  responses: {
    200: {
      description: "One page of recorded events",
      content: {
        "application/json": { schema: MatterEventPage },
      },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const getEventRoute = defineOpenAPIRoute(readMeta("getEvent", "matter"), {
  method: "get",
  path: "/api/v1/events/{eventId}",
  description:
    "One recorded event with everybody who was, or will be, at it — a firm member, a contact from the " +
    "directory, or somebody external to both, each with the role the firm gave them. This is the read " +
    "an editing surface makes; the timeline deliberately carries none of it.",
  request: { params: eventIdParam },
  responses: {
    200: {
      description: "The event and its participants",
      content: {
        "application/json": {
          schema: MatterEventWithParticipants,
        },
      },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const firmCalendarRoute = defineOpenAPIRoute(readMeta("firmCalendar", "firm"), {
  method: "get",
  path: "/api/v1/calendar/events",
  description:
    `The firm's calendar across every matter a member can see, over a date window that is required ` +
    `and capped at ${MAX_CALENDAR_WINDOW_DAYS} days. A wider window is refused rather than quietly ` +
    `narrowed, so a caller always knows what it was given. Filter by matter, by member (a ` +
    `participant, or the matter's responsible member), and by kind.`,
  request: { query: firmCalendarQuery },
  responses: {
    200: {
      description: "One page of the firm calendar",
      content: {
        "application/json": {
          schema: FirmCalendarPage,
        },
      },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const deadlinesRoute = defineOpenAPIRoute(readMeta("listDeadlines", "firm"), {
  method: "get",
  path: "/api/v1/calendar/deadlines",
  description:
    `Deadlines across every matter a member can see, soonest first, over a horizon capped at ` +
    `${MAX_DEADLINE_HORIZON_DAYS} days. Each deadline reports whether it is overdue, worked out when ` +
    `the page is read by resolving its date and time in its own time zone and comparing against now — ` +
    `there is no stored flag anywhere that says a firm missed something, and no job that would write ` +
    `one. Nothing here calculates a due date: every date is one a person recorded.`,
  request: { query: deadlineQuery },
  responses: {
    200: {
      description: "One page of deadlines",
      content: {
        "application/json": { schema: MatterDeadlinePage },
      },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const listEventTypesRoute = defineOpenAPIRoute(readMeta("listEventTypes", "firm"), {
  method: "get",
  path: "/api/v1/calendar/event-types",
  description:
    "The firm's event-type catalog: the platform vocabulary (hearing, trial, filing, service, " +
    "deposition and the rest) plus whatever the firm has added. A platform type's name and code are " +
    "the shared vocabulary and cannot be redefined; any type can be deactivated.",
  request: { query: z.object({ includeInactive: z.enum(["true", "false"]).optional() }) },
  responses: {
    200: {
      description: "The catalog",
      content: {
        "application/json": {
          schema: MatterEventTypeList,
        },
      },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const getSettingsRoute = defineOpenAPIRoute(readMeta("getSettings", "firm"), {
  method: "get",
  path: "/api/v1/calendar/settings",
  description:
    "The firm's calendar settings: which day its week begins on (0 for Sunday, 1 for Monday). A firm " +
    "setting rather than a personal one, so every member reads the same week; Sunday until the firm " +
    "says otherwise.",
  responses: {
    200: {
      description: "The firm's calendar settings",
      content: { "application/json": { schema: CalendarSettingsResponse } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const updateSettingsRoute = defineOpenAPIRoute(mutationMeta("updateSettings", "firm"), {
  method: "patch",
  path: "/api/v1/calendar/settings",
  description:
    "Updates the firm's calendar settings. Sparse: an absent field is left alone, and an empty " +
    "patch changes nothing and records nothing. Returns the settings after the write.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      content: { "application/json": { schema: PatchCalendarSettingsRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The firm's calendar settings after the write",
      content: { "application/json": { schema: CalendarSettingsResponse } },
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

const createEventRoute = defineOpenAPIRoute(mutationMeta("createEvent", "matter"), {
  method: "post",
  path: "/api/v1/matters/{matterId}/events",
  description:
    "Records something that happened or will happen in the case: a hearing, a filing, service, an " +
    "order, a deposition, a client meeting. A date is a plain calendar date and a time is separate " +
    "and optional, because an all-day event is a real and common answer; the time zone is required " +
    "and is the one the event happens in, which for a hearing is the court's and not the firm's. " +
    "Answering `meeting` schedules a video meeting or an audio call in the same act: the room is " +
    "opened on the event, the colleagues listed on it are invited, and everyone sees Join from now " +
    "rather than from the moment somebody presses Start. Only members are invited — a client or " +
    "another party from the Directory has no way in yet. Opening a room needs the permission to " +
    "host meetings as well as the one to manage the calendar; without it the event can still be " +
    "recorded, and only the `meeting` field is refused.",
  request: {
    headers: idempotencyKeyHeader,
    params: matterIdParam,
    body: { content: { "application/json": { schema: CreateEventRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The recorded event, with its meeting where one was asked for",
      content: { "application/json": { schema: EventRecordedResponse } },
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

const updateEventRoute = defineOpenAPIRoute(mutationMeta("updateEvent", "matter"), {
  method: "patch",
  path: "/api/v1/events/{eventId}",
  description:
    "Edits a recorded event in place. A hearing continued to a new date is the same hearing on a " +
    "new date: the record moves and the audit trail carries the move, rather than leaving two " +
    "hearings on the calendar for every reader to work out which one counts. Supplying participants " +
    "replaces the whole list; omitting them leaves it alone. Moving an event keeps its meeting: a " +
    "meeting carries no time of its own. Supplying `meeting` adds one to an event that has none, " +
    "and needs the permission to host meetings as well as the one to manage the calendar; " +
    "null or absent leaves the event's meeting exactly as it stands, because ending a gathering is " +
    "an act of its own and never a side effect of a correction.",
  request: {
    headers: idempotencyKeyHeader,
    params: eventIdParam,
    body: { content: { "application/json": { schema: UpdateEventRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The event was updated, with its meeting where it has one",
      content: { "application/json": { schema: EventUpdatedResponse } },
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

const cancelEventRoute = defineOpenAPIRoute(mutationMeta("cancelEvent", "matter"), {
  method: "post",
  path: "/api/v1/events/{eventId}/cancel",
  description:
    "Marks an event cancelled, with an optional reason the record keeps. The record stays: a " +
    "hearing that was taken off is a fact about the case, and a firm that has to show it was " +
    "vacated cannot do that from a row that is gone. A hearing the court moved is continued, not " +
    "cancelled — the continue operation records both settings." +
    " A meeting scheduled on the event ends with it, in the same batch. A meeting that is LIVE refuses the cancel: taking a room away from the people in it is not a side effect a calendar edit may have, so the meeting is ended first and the event cancelled after.",
  request: {
    headers: idempotencyKeyHeader,
    params: eventIdParam,
    body: { content: { "application/json": { schema: CancelEventRequest } }, required: false },
  },
  responses: {
    200: {
      description: "The event was cancelled",
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

const createDeadlineRoute = defineOpenAPIRoute(mutationMeta("createDeadline", "matter"), {
  method: "post",
  path: "/api/v1/matters/{matterId}/deadlines",
  description:
    "Records a date the firm must act by, with the authority the firm says it comes from. The " +
    "platform does not calculate deadlines: it does no business-day counting, keeps no court-holiday " +
    "calendar, adds no days for the method of service, and never moves one date because another " +
    "moved. A deadline that was computed wrongly is worse than one that was never computed, because " +
    "it gets trusted. Link the event that started the clock if there is one — the link is a record, " +
    "not a calculation.",
  request: {
    headers: idempotencyKeyHeader,
    params: matterIdParam,
    body: { content: { "application/json": { schema: CreateDeadlineRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The recorded deadline",
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

const updateDeadlineRoute = defineOpenAPIRoute(mutationMeta("updateDeadline", "matter"), {
  method: "patch",
  path: "/api/v1/deadlines/{deadlineId}",
  description:
    "Edits an open deadline. A deadline that has been satisfied, vacated, or superseded is not " +
    "edited: record a new one that supersedes it, so both stay on the record.",
  request: {
    headers: idempotencyKeyHeader,
    params: deadlineIdParam,
    body: { content: { "application/json": { schema: UpdateDeadlineRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The deadline was updated",
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

const satisfyDeadlineRoute = defineOpenAPIRoute(mutationMeta("satisfyDeadline", "matter"), {
  method: "post",
  path: "/api/v1/deadlines/{deadlineId}/satisfy",
  description:
    "Records that a deadline was met: who met it, when, and — where the firm recorded one — the " +
    "filing that discharged it, which is what turns 'we did it' into 'here is the thing we did'.",
  request: {
    headers: idempotencyKeyHeader,
    params: deadlineIdParam,
    body: { content: { "application/json": { schema: SatisfyDeadlineRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The deadline was satisfied",
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

const vacateDeadlineRoute = defineOpenAPIRoute(mutationMeta("vacateDeadline", "matter"), {
  method: "post",
  path: "/api/v1/deadlines/{deadlineId}/vacate",
  description:
    "Records that a deadline is no longer in force, and why. The reason is required and the record " +
    "is kept: 'why is this deadline gone' is the question somebody asks six months later, and the " +
    "only bad answer is silence.",
  request: {
    headers: idempotencyKeyHeader,
    params: deadlineIdParam,
    body: { content: { "application/json": { schema: CloseDeadlineRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The deadline was vacated",
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

const supersedeDeadlineRoute = defineOpenAPIRoute(mutationMeta("supersedeDeadline", "matter"), {
  method: "post",
  path: "/api/v1/deadlines/{deadlineId}/supersede",
  description:
    "Records that a deadline has been replaced by another one, and why. Both stay on the record, and " +
    "the replaced deadline names the one that replaced it.",
  request: {
    headers: idempotencyKeyHeader,
    params: deadlineIdParam,
    body: { content: { "application/json": { schema: CloseDeadlineRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The deadline was superseded",
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

const createEventTypeRoute = defineOpenAPIRoute(mutationMeta("createEventType", "firm"), {
  method: "post",
  path: "/api/v1/calendar/event-types",
  description:
    "Adds an event type of the firm's own. A practice with a proceeding nobody thought of is never " +
    "blocked by the shipped vocabulary.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateEventTypeRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The event type",
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

const updateEventTypeRoute = defineOpenAPIRoute(mutationMeta("updateEventType", "firm"), {
  method: "patch",
  path: "/api/v1/calendar/event-types/{eventTypeId}",
  description:
    "Renames or recategorizes an event type. A type that ships with the platform can be " +
    "recategorized but not renamed or recoded — its name is the shared vocabulary, and a firm that " +
    "wants different words adds its own type and deactivates the shipped one.",
  request: {
    headers: idempotencyKeyHeader,
    params: eventTypeIdParam,
    body: { content: { "application/json": { schema: UpdateEventTypeRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The event type was updated",
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

const deactivateEventTypeRoute = defineOpenAPIRoute(mutationMeta("deactivateEventType", "firm"), {
  method: "post",
  path: "/api/v1/calendar/event-types/{eventTypeId}/deactivate",
  description:
    "Retires an event type. Events already classified under it keep their meaning; it simply stops " +
    "being offered for new ones.",
  request: { headers: idempotencyKeyHeader, params: eventTypeIdParam },
  responses: {
    200: {
      description: "The event type was deactivated",
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

// ---- firm-event routes ----

const listFirmEventsRoute = defineOpenAPIRoute(readMeta("listFirmEvents", "firm"), {
  method: "get",
  path: "/api/v1/firm-events",
  description:
    `The firm's own events — meetings, closures, training, holidays, reservations — over a date ` +
    `window that is required and capped at ${MAX_CALENDAR_WINDOW_DAYS} days, newest first. These ` +
    `belong to the firm rather than to any case: they appear on the firm calendar beside matter ` +
    `events and never on a matter's timeline.`,
  request: { query: firmEventsQuery },
  responses: {
    200: {
      description: "One page of firm events",
      content: {
        "application/json": { schema: FirmEventPage },
      },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const getFirmEventRoute = defineOpenAPIRoute(readMeta("getFirmEvent", "firm"), {
  method: "get",
  path: "/api/v1/firm-events/{firmEventId}",
  description:
    "One firm event with everybody on it. An all-members event lists no participants because it " +
    "needs none: it is on every member's calendar by construction.",
  request: { params: firmEventIdParam },
  responses: {
    200: {
      description: "The firm event and its participants",
      content: {
        "application/json": {
          schema: FirmEventWithParticipants,
        },
      },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const createFirmEventRoute = defineOpenAPIRoute(mutationMeta("createFirmEvent", "firm"), {
  method: "post",
  path: "/api/v1/firm-events",
  description:
    "Records something the firm schedules for itself: a meeting, an office closure, training, a " +
    "firm holiday, a reservation. An all-members audience puts it on everyone's calendar without " +
    "keeping a list that goes stale with every hire; a participants audience puts it on the " +
    "calendars of the people named. Answering `meeting` schedules a video meeting or an audio call " +
    "in the same act, exactly as it does on a matter's event — and needs the permission to host " +
    "meetings as well as the one to manage the calendar.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateFirmEventRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The recorded firm event, with its meeting where one was asked for",
      content: { "application/json": { schema: EventRecordedResponse } },
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

const updateFirmEventRoute = defineOpenAPIRoute(mutationMeta("updateFirmEvent", "firm"), {
  method: "patch",
  path: "/api/v1/firm-events/{firmEventId}",
  description:
    "Edits a firm event in place. A moved staff meeting is not procedural history — firm events " +
    "keep simple edit semantics, and the audit trail carries the move. Supplying participants " +
    "replaces the whole list; omitting them leaves it alone. A meeting on the event survives the " +
    "edit; supplying `meeting` adds one where there is none, and needs the permission to host " +
    "meetings as well as the one to manage the calendar.",
  request: {
    headers: idempotencyKeyHeader,
    params: firmEventIdParam,
    body: { content: { "application/json": { schema: UpdateFirmEventRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The firm event was updated, with its meeting where it has one",
      content: { "application/json": { schema: EventUpdatedResponse } },
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

const cancelFirmEventRoute = defineOpenAPIRoute(mutationMeta("cancelFirmEvent", "firm"), {
  method: "post",
  path: "/api/v1/firm-events/{firmEventId}/cancel",
  description:
    "Marks a firm event cancelled, with an optional reason. The record stays, and any room or " +
    "vehicle booked for it frees itself: a booking blocks a resource only while its event is live, " +
    "so cancelling releases the bookings with nothing further to do. A meeting scheduled on the " +
    "event ends with it; a meeting that is LIVE refuses the cancel until it has been ended.",
  request: {
    headers: idempotencyKeyHeader,
    params: firmEventIdParam,
    body: { content: { "application/json": { schema: CancelEventRequest } }, required: false },
  },
  responses: {
    200: {
      description: "The firm event was cancelled",
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

// ---- resource routes ----

const listResourcesRoute = defineOpenAPIRoute(readMeta("listResources", "firm"), {
  method: "get",
  path: "/api/v1/calendar/resources",
  description:
    "The firm's bookable resources — rooms, vehicles, equipment — for the picker. Capacity is " +
    "shown so a person can decide; nothing refuses a twelve-person meeting in a ten-seat room. The " +
    "whole catalog is returned rather than a page, because a picker missing a room says the room " +
    "does not exist; `capped` is true in the implausible case of a firm holding more bookable " +
    "things than one answer carries, and the kind and office filters are how it is narrowed.",
  request: { query: resourcesQuery },
  responses: {
    200: {
      description: "The resource catalog",
      content: {
        "application/json": {
          schema: FirmResourceList,
        },
      },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const createResourceRoute = defineOpenAPIRoute(mutationMeta("createResource", "firm"), {
  method: "post",
  path: "/api/v1/calendar/resources",
  description:
    "Adds a bookable resource. Curating the resource list is calendar administration, exactly as " +
    "curating the event-type catalog is.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateResourceRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The resource",
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

const updateResourceRoute = defineOpenAPIRoute(mutationMeta("updateResource", "firm"), {
  method: "patch",
  path: "/api/v1/calendar/resources/{firmResourceId}",
  description:
    "Edits a resource, including deactivating it. A deactivated resource keeps its history and its " +
    "existing bookings and simply takes no new ones.",
  request: {
    headers: idempotencyKeyHeader,
    params: firmResourceIdParam,
    body: { content: { "application/json": { schema: UpdateResourceRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The resource was updated",
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

const resourceAvailabilityRoute = defineOpenAPIRoute(readMeta("resourceAvailability", "firm"), {
  method: "get",
  path: "/api/v1/calendar/resources/{firmResourceId}/availability",
  description:
    `A resource's live bookings over a required window capped at ${MAX_CALENDAR_WINDOW_DAYS} days, ` +
    `with overlapping pairs marked in the same response so a grid can paint conflicts without a ` +
    `second request. A booking blocks the resource only while its event is live — cancelled events ` +
    `free their rooms by definition, with no separate release. Entries carry windows and kinds, ` +
    `never titles: the detail lives behind each entry's own access-checked link.`,
  request: { params: firmResourceIdParam, query: availabilityQuery },
  responses: {
    200: {
      description: "The window's bookings",
      content: {
        "application/json": {
          schema: ResourceAvailability,
        },
      },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

// ---- booking routes ----

const listEventBookingsRoute = defineOpenAPIRoute(readMeta("listEventBookings", "matter"), {
  method: "get",
  path: "/api/v1/events/{eventId}/bookings",
  description:
    "The live bookings a matter event holds: which resources it has booked and for what span. Read through the visible-matter predicate like the event itself; an event on an invisible matter is a 404.",
  request: { params: eventIdParam },
  responses: {
    200: {
      description: "The event's bookings",
      content: { "application/json": { schema: EventBookings } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const listFirmEventBookingsRoute = defineOpenAPIRoute(readMeta("listFirmEventBookings", "firm"), {
  method: "get",
  path: "/api/v1/firm-events/{firmEventId}/bookings",
  description:
    "The live bookings a firm event holds: which resources it has booked and for what span.",
  request: { params: firmEventIdParam },
  responses: {
    200: {
      description: "The firm event's bookings",
      content: { "application/json": { schema: EventBookings } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const createBookingRoute = defineOpenAPIRoute(mutationMeta("createBooking", "firm"), {
  method: "post",
  path: "/api/v1/resource-bookings",
  description:
    "Books a resource for exactly one event — a matter event or a firm event, never neither: " +
    "'book the pool car Friday' is a Reservation-type firm event with the booking attached. The " +
    "window defaults from the event and is editable (the room from half past eight for a nine " +
    "o'clock deposition); the zone freezes from the resource's office. A double-booking succeeds " +
    "and the response reports the conflicts it created: rooms are double-booked on purpose, the " +
    "front desk referees them, and a taken room must never be the reason a hearing cannot be " +
    "recorded.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateBookingRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The booking, with any conflicts it created",
      content: { "application/json": { schema: BookingCreatedResponse } },
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

const updateBookingRoute = defineOpenAPIRoute(mutationMeta("updateBooking", "firm"), {
  method: "patch",
  path: "/api/v1/resource-bookings/{firmResourceBookingId}",
  description:
    "Moves a booking's window or zone. The response reports any conflicts the move created, on the " +
    "same warn-and-allow posture as creation.",
  request: {
    headers: idempotencyKeyHeader,
    params: firmResourceBookingIdParam,
    body: { content: { "application/json": { schema: UpdateBookingRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The booking was updated, with any conflicts the move created",
      content: { "application/json": { schema: BookingUpdatedResponse } },
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

const deleteBookingRoute = defineOpenAPIRoute(
  {
    ...mutationMeta("deleteBooking", "firm"),
    reversal: { kind: "inverse", by: "calendar.createBooking" },
  },
  {
    method: "delete",
    path: "/api/v1/resource-bookings/{firmResourceBookingId}",
    description:
      "Removes a booking outright. A booking is a claim on a room, not history — the event it served " +
      "remains the record.",
    request: { headers: idempotencyKeyHeader, params: firmResourceBookingIdParam },
    responses: {
      200: {
        description: "The booking was removed",
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

// ---- event-link and continuance routes ----

const createEventLinkRoute = defineOpenAPIRoute(mutationMeta("createEventLink", "firm"), {
  method: "post",
  path: "/api/v1/event-links",
  description:
    "Relates two events — a prep session to its deposition, a meeting to the closure it plans for. " +
    "Links here are the 'related' kind only: a continuance link is minted by the continue " +
    "operation and by nothing else, because it is procedural history rather than an annotation.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateEventLinkRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The link",
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

const deleteEventLinkRoute = defineOpenAPIRoute(
  {
    ...mutationMeta("deleteEventLink", "firm"),
    reversal: { kind: "inverse", by: "calendar.createEventLink" },
  },
  {
    method: "delete",
    path: "/api/v1/event-links/{calendarEventLinkId}",
    description:
      "Removes a related link — a true delete, because a link is an annotation, not history. A " +
      "continuance link is history and is refused.",
    request: { headers: idempotencyKeyHeader, params: calendarEventLinkIdParam },
    responses: {
      200: {
        description: "The link was removed",
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

const continueEventRoute = defineOpenAPIRoute(mutationMeta("continueEvent", "matter"), {
  method: "post",
  path: "/api/v1/events/{eventId}/continue",
  description:
    "Continues a setting to a new date the way the court did: the old setting stays on the record " +
    "with every historical detail untouched, marked cancelled with the reason; a new setting is " +
    "recorded as it now stands, with the participants carried over; and one continuance link ties " +
    "new to old, so the full history of the hearing is walkable in order. Correcting a typo is a " +
    "different act — edit the event instead. The response lists the open deadlines that referenced " +
    "the continued setting and the bookings the change released, for a person to act on: no " +
    "deadline moves, because what a continuance does to a briefing schedule is a legal judgement.",
  request: {
    headers: idempotencyKeyHeader,
    params: eventIdParam,
    body: { content: { "application/json": { schema: ContinueEventRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The new setting, the vacated one, and what referenced them",
      content: { "application/json": { schema: ContinueEventResponse } },
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

const listEventLinksRoute = defineOpenAPIRoute(readMeta("listEventLinks", "matter"), {
  method: "get",
  path: "/api/v1/events/{eventId}/links",
  description:
    "Every link touching a matter event, from either side: the continuance it is part of and the " +
    "settings it was related to by hand. Ends are identifiers; the other end's record is read on its " +
    "own path, under its own visibility.",
  request: { params: eventIdParam },
  responses: {
    200: {
      description: "The event's links",
      content: { "application/json": { schema: EventLinks } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const listFirmEventLinksRoute = defineOpenAPIRoute(readMeta("listFirmEventLinks", "firm"), {
  method: "get",
  path: "/api/v1/firm-events/{firmEventId}/links",
  description: "Every link touching a firm event, from either side.",
  request: { params: firmEventIdParam },
  responses: {
    200: {
      description: "The firm event's links",
      content: { "application/json": { schema: EventLinks } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const continuanceChainRoute = defineOpenAPIRoute(readMeta("continuanceChain", "matter"), {
  method: "get",
  path: "/api/v1/events/{eventId}/continuance-chain",
  description:
    "The full procedural history of one hearing: every setting in order — dates, statuses, and " +
    "reasons — walked in both directions from any setting in the chain.",
  request: { params: eventIdParam },
  responses: {
    200: {
      description: "The chain, oldest setting first",
      content: {
        "application/json": {
          schema: ContinuanceChain,
        },
      },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

// ---- handler helpers ----

export type CalendarApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function serviceOptions(userId: string) {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: userId as never,
    randomSource: cryptoRandomSource,
    // The same predicate the timeline federates under. Every service read of an event or a deadline
    // composes it, so an id-addressed write path cannot reach a row a matter-scoped read could not.
    visibility: visibleMatterPredicate(),
  };
}

function repeatable(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

// `direction` is a civil-date bound like any other, resolved against today so it composes into the
// same WHERE clause the explicit window does. An explicit bound always wins — a caller that named
// both said what it meant.
function directionBounds(
  direction: (typeof TIMELINE_DIRECTIONS)[number] | undefined,
  from: string | undefined,
  to: string | undefined,
  today: string,
): { fromDate: string | undefined; toDate: string | undefined } {
  if (direction === "past") return { fromDate: from, toDate: to ?? today };
  if (direction === "future") return { fromDate: from ?? today, toDate: to };
  return { fromDate: from, toDate: to };
}

// The continuance neighbors an event read embeds: enough to badge "continued from Mar 14" without
// a chain walk.
interface ContinuanceNeighbors {
  readonly continuedFromEventId: string | null;
  readonly continuedToEventId: string | null;
}

const NO_NEIGHBORS: ContinuanceNeighbors = { continuedFromEventId: null, continuedToEventId: null };

// One bounded query for a whole page of events, never one per row.
async function continuanceNeighborsFor(
  database: SqlDatabase,
  eventIds: readonly MatterEventId[],
): Promise<Map<string, ContinuanceNeighbors>> {
  const links = await readContinuanceLinksForEvents(database, eventIds);
  const neighbors = new Map<string, ContinuanceNeighbors>();
  const entryFor = (id: string): ContinuanceNeighbors =>
    neighbors.get(id) ?? { continuedFromEventId: null, continuedToEventId: null };
  for (const link of links) {
    // A continuance link points new setting -> old setting.
    const newId = link.from_matter_event_id;
    const oldId = link.to_matter_event_id;
    if (newId !== null) {
      neighbors.set(newId, { ...entryFor(newId), continuedFromEventId: oldId });
    }
    if (oldId !== null) {
      neighbors.set(oldId, { ...entryFor(oldId), continuedToEventId: newId });
    }
  }
  return neighbors;
}

function eventDetail(
  row: MatterEventDisplayRow,
  neighbors: ContinuanceNeighbors = NO_NEIGHBORS,
): z.infer<typeof EventDetail> {
  return {
    id: row.id,
    matterId: row.matter_id,
    eventTypeId: row.event_type_id,
    eventTypeName: row.event_type_name,
    title: row.title,
    description: row.description,
    status: row.status,
    statusReason: row.status_reason,
    startsOn: row.starts_on,
    startsAtTime: row.starts_at_time,
    endsOn: row.ends_on,
    endsAtTime: row.ends_at_time,
    timeZone: row.time_zone,
    locationText: row.location_text,
    conferenceUrl: row.conference_url,
    courtReference: row.court_reference,
    recurrenceRule: row.recurrence_rule,
    recordedAt: row.recorded_at,
    recordedBy: row.recorded_by,
    continuedFromEventId: neighbors.continuedFromEventId,
    continuedToEventId: neighbors.continuedToEventId,
  };
}

function firmEventDetail(row: FirmEventRow): z.infer<typeof FirmEventDetail> {
  return {
    id: row.id,
    eventTypeId: row.event_type_id,
    title: row.title,
    description: row.description,
    status: row.status,
    statusReason: row.status_reason,
    startsOn: row.starts_on,
    startsAtTime: row.starts_at_time,
    endsOn: row.ends_on,
    endsAtTime: row.ends_at_time,
    timeZone: row.time_zone,
    audience: row.audience,
    locationId: row.location_id,
    locationText: row.location_text,
    conferenceUrl: row.conference_url,
    recurrenceRule: row.recurrence_rule,
    recordedAt: row.recorded_at,
    recordedBy: row.recorded_by,
  };
}

function resourceDetail(row: FirmResourceRow): z.infer<typeof ResourceDetail> {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    locationId: row.location_id,
    capacity: row.capacity,
    notes: row.notes,
    active: row.active === 1,
  };
}

function bookingConflictDetail(conflict: BookingConflict): z.infer<typeof BookingConflictDetail> {
  return {
    bookingId: conflict.bookingId,
    startsOn: conflict.startsOn,
    startsAtTime: conflict.startsAtTime,
    endsOn: conflict.endsOn,
    endsAtTime: conflict.endsAtTime,
    timeZone: conflict.timeZone,
    eventKind: conflict.eventKind,
    eventId: conflict.eventId,
    link: conflict.link,
  };
}

function deadlineDetail(row: MatterDeadlineRow, now: string): z.infer<typeof DeadlineDetail> {
  return {
    id: row.id,
    matterId: row.matter_id,
    title: row.title,
    dueOn: row.due_on,
    dueAtTime: row.due_at_time,
    timeZone: row.time_zone,
    source: row.source,
    authorityText: row.authority_text,
    triggerEventId: row.trigger_event_id,
    state: row.state,
    satisfiedAt: row.satisfied_at,
    satisfiedBy: row.satisfied_by,
    satisfyingEventId: row.satisfying_event_id,
    stateReason: row.state_reason,
    priority: row.priority,
    // Worked out here, from the row as it stands, every time the page is read.
    overdue: isOverdue(
      {
        dueOn: row.due_on,
        dueAtTime: row.due_at_time,
        timeZone: row.time_zone,
        state: row.state,
      },
      now,
    ),
  };
}

type CalendarEffectOutcome =
  | { ok: true; id: string; replayed: boolean }
  | {
      ok: false;
      problem: ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422>;
    };

// The shared idempotent commit for a calendar mutation, mapping refusals to HTTP.
export async function commitCalendarEffect(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  responseCode: number,
  call: () => Promise<{ id: string; effect: EffectWrite }>,
): Promise<CalendarEffectOutcome> {
  const now = () => new Date().toISOString();
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now,
      effect: async () => {
        const { id, effect } = await call();
        return {
          write: effect,
          responseCode,
          // The stored body IS the wire body: the idempotency gate replays it verbatim, so a shape
          // that differed from what the handler returns would hand a retrying client a different
          // payload than the original request got.
          responseBody: canonicalJsonStringify({ id }),
        };
      },
    });
  } catch (caught) {
    if (caught instanceof CalendarValidationError) {
      return { ok: false, problem: calendarErrorResponse(c, caught) };
    }
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  }
  const body = JSON.parse(result.responseBody ?? "{}") as { id: string };
  return { ok: true, id: body.id, replayed: result.kind === "replayed" };
}

type RichCalendarEffectOutcome<Body> =
  | { ok: true; body: Body; replayed: boolean }
  | {
      ok: false;
      problem: ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422>;
    };

// The same idempotent commit for the mutations whose response is more than an id — a booking's
// conflicts, a continuance's informational lists. The stored body IS the wire body, so a retried
// request replays exactly what the original commit reported (its conflicts as they were then), not
// a recomputation.
async function commitRichCalendarEffect<Body>(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  responseCode: number,
  call: () => Promise<{ body: Body; effect: EffectWrite }>,
): Promise<RichCalendarEffectOutcome<Body>> {
  const now = () => new Date().toISOString();
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now,
      effect: async () => {
        const { body, effect } = await call();
        return {
          write: effect,
          responseCode,
          responseBody: canonicalJsonStringify(body),
        };
      },
    });
  } catch (caught) {
    if (caught instanceof CalendarValidationError) {
      return { ok: false, problem: calendarErrorResponse(c, caught) };
    }
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  }
  return {
    ok: true,
    body: JSON.parse(result.responseBody ?? "{}") as Body,
    replayed: result.kind === "replayed",
  };
}

// ---- scheduling: the meeting an event carries ----

/*
 * SCHEDULING IS RECORDING AN EVENT WITH A MEDIUM ON IT, AND THE TWO COMMIT TOGETHER.
 *
 * One batch rather than two, and the reason is the idempotency gate rather than tidiness: the gate
 * replays a completed request's stored body at the chokepoint, without ever reaching the handler, so
 * a meeting opened AFTER the event committed would be missing from every replayed answer — and the
 * caller that most needs the identifier is precisely the one whose first response never arrived.
 *
 * That ordering forces the one seam in `@magna-carta/meetings`: `createMeeting` reads the event
 * through the visibility predicate before it writes, and at the moment this composes the room the
 * event has been composed and not yet committed, so no read can see it. `openMeetingOnEvent` is the
 * entry point for exactly that case, named rather than hidden behind an optional argument, because
 * skipping that read is an assertion this route is in a position to make and nothing else is: it has
 * just written the event itself, under its own permission check, in the batch the insert is joining.
 *
 * One meeting per event is still held underneath by a partial unique index, so a correction that
 * asks for a meeting on an event that already has one finds the room rather than opening a second.
 */

/** The meeting the event asked for, as the request spells it. */
type MeetingChoice = z.infer<typeof MeetingRequest> | null | undefined;

// OPENING A ROOM IS A MEETING ACT, WHEREVER THE FORM IT IS ASKED FROM LIVES.
//
// The four event mutations ride `calendar:manage`, which is the right key for recording that a
// hearing is happening. It is not the key for convening a gathering: `meetings:host` is what the
// meetings surface demands to start one, and a `meeting` field on an event form reaches exactly the
// same act by another door — a member who may keep the diary would otherwise be able to open rooms
// on the firm's behalf without ever holding the key that says they may.
//
// Asked in the handler rather than on the route, the way the chat's moderation key is: the route's
// own permission is what every caller needs, and this one is needed only by the callers who filled
// that field in.
//
// CLOSING one is deliberately NOT here. A cancellation can only reach a room nobody has walked into
// (`meetingClosingWithEvent`), so what it ends is the diary entry's leftover rather than a
// gathering — and refusing the cancel would leave the diary unable to take a sitting off.
const MEETINGS_HOST = "meetings:host" as const;

function refuseUnhostedMeeting(c: Context, choice: MeetingChoice): ProblemResponse<403> | null {
  if (choice === null || choice === undefined) return null;
  if (requireChokepointPermissions(c).has(assertPermission(MEETINGS_HOST))) return null;
  return problemJson(c, {
    type: "permission-denied",
    title: "Permission denied",
    status: 403,
    detail:
      "Scheduling a meeting on an event opens a room, which needs the permission to host meetings. " +
      "The event itself can be recorded without one.",
    requestAccess: true,
  });
}

/** The room's own writes, and the identifier the response carries. */
interface SchedulingOutcome {
  readonly meetingId: string | null;
  readonly effect: EffectWrite;
}

const NO_SCHEDULING: SchedulingOutcome = {
  meetingId: null,
  effect: { statements: [], outboxMessages: [] },
};

/**
 * The room for an event being recorded in this same batch, and the invitation that announces it.
 *
 * The invited colleagues come from the REQUEST, because the participant rows are being written
 * beside this and cannot be read back yet — which is also the honest answer: the people to tell are
 * the people who were on the event when it was recorded.
 */
function scheduleMeetingOnNewEvent(
  database: SqlDatabase,
  userId: string,
  event: { readonly kind: MeetingEventKind; readonly id: string; readonly matterId: string | null },
  choice: MeetingChoice,
  participants: readonly z.infer<typeof ParticipantRequest>[] | undefined,
  // Whether this deployment opens meetings end-to-end encrypted, as Start does.
  encrypted: boolean,
): SchedulingOutcome {
  if (choice === null || choice === undefined) return NO_SCHEDULING;
  const opened = openMeetingOnEvent(
    database,
    {
      eventKind: event.kind,
      eventId: event.id,
      matterId: event.matterId,
      medium: choice.medium,
      lobby: choice.lobby,
      encrypted,
    },
    serviceOptions(userId),
  );
  return {
    meetingId: opened.meetingId,
    effect: {
      statements: opened.effect.statements,
      // The invitation rides the SAME atomic batch as the room it announces, which is the whole
      // difference between a durable announcement and a best-effort one: a batch that rolls back
      // leaves no message, and a message that exists is proof the room was opened.
      outboxMessages: [
        ...opened.effect.outboxMessages,
        ...meetingInvitations(
          event,
          opened.meetingId,
          choice.medium,
          invitedMembers(participants ?? [], userId),
        ),
      ],
    },
  };
}

/**
 * The room for an event that is already recorded — a correction that adds one.
 *
 * Here `createMeeting` is the entry point, because the event exists and the walled-matter question
 * is its to answer. An event that already has a room keeps it: the medium is chosen once, since the
 * people already in a room agreed to one thing.
 */
async function scheduleMeetingOnExistingEvent(
  database: SqlDatabase,
  userId: string,
  event: { readonly kind: MeetingEventKind; readonly id: string },
  choice: MeetingChoice,
  encrypted: boolean,
): Promise<SchedulingOutcome> {
  const existing = await readMeetingForEvent(
    database,
    event.kind,
    event.id,
    visibleMatterPredicate(),
  );
  // The read is what answers for an event that already has a room, so a correction always reports
  // the meeting as it actually stands rather than as this request happened to ask about it.
  if (existing !== undefined) return { meetingId: existing.id, effect: NO_SCHEDULING.effect };
  if (choice === null || choice === undefined) return NO_SCHEDULING;

  const opened = await createMeeting(
    database,
    { eventKind: event.kind, eventId: event.id, medium: choice.medium, encrypted },
    serviceOptions(userId),
  );
  const invited =
    event.kind === "matter"
      ? invitedMembers(
          (await readMatterEventParticipants(database, event.id as MatterEventId)).map((row) => ({
            participantKind: row.participant_kind,
            memberUserId: row.member_user_id,
          })),
          userId,
        )
      : [];
  return {
    meetingId: opened.meetingId,
    effect: {
      statements: opened.effect.statements,
      outboxMessages: [
        ...opened.effect.outboxMessages,
        ...meetingInvitations(event, opened.meetingId, choice.medium, invited),
      ],
    },
  };
}

/**
 * Two effects as one: the record's own writes and the room's, committed together or not at all.
 *
 * Takes anything carrying an effect rather than a scheduling outcome specifically, because the
 * cancel path joins a CLOSING the same way an edit joins an opening — and two hand-merged spreads
 * doing this by hand is how one of them comes to drop the outbox half.
 */
function withScheduling(effect: EffectWrite, other: { readonly effect: EffectWrite }): EffectWrite {
  return {
    statements: [...effect.statements, ...other.effect.statements],
    outboxMessages: [...effect.outboxMessages, ...other.effect.outboxMessages],
  };
}

const NO_CLOSING: EffectWrite = { statements: [], outboxMessages: [] };

/** The one refusal a cancellation has that is about the room rather than about the event. */
function meetingInProgress(c: Context): ProblemResponse<409> {
  return problemJson(c, {
    type: "meeting-in-progress",
    title: "This meeting is running",
    status: 409,
    detail:
      "People are in this meeting now. End the meeting first, then cancel the event — a " +
      "calendar edit does not close a room somebody is in.",
  });
}

/**
 * The meeting a cancellation has to settle, or a refusal.
 *
 * A SCHEDULED meeting ends with the event, in the same batch as the cancel: a room nobody has walked
 * into, on a setting that is no longer happening, must not stay openable, and committing the two
 * together is what stops the record and the product disagreeing about it.
 *
 * A LIVE meeting refuses the cancel. Ending it as a side effect would take a room away from the
 * people in it on somebody else's click; cancelling the event and leaving the room running would
 * have the record say the setting is off while the product says it is happening. The refusal names
 * the act that fixes it, which costs one gesture in the rare case of cancelling something that is
 * running.
 *
 * THIS READ IS ADVISORY AND THE CLOSING STATEMENT IS NOT. What is decided here is decided a round
 * trip before the commit, and a member can walk into the room in between — so the statement carries
 * `status = 'scheduled'` and "no open stay" in its own WHERE and refuses the whole batch otherwise
 * (`endScheduledMeetingForCancelledEvent`). `cancelWithMeetingClosing` is what turns that refusal
 * back into this same 409.
 *
 * AND THE ROOM IS NEVER TOLD, deliberately. A `MeetingRoom` exists only once somebody has connected
 * to it; a cancel can now only ever close a meeting nobody has walked into, so there is no room
 * object holding sockets, no roster to empty, and nothing to notify. The end ROUTE tells the room
 * because that one ends meetings people are sitting in.
 */
async function meetingClosingWithEvent(
  c: Context,
  database: SqlDatabase,
  userId: string,
  event: { readonly kind: MeetingEventKind; readonly id: string },
): Promise<{ ok: true; effect: EffectWrite } | { ok: false; problem: ProblemResponse<409> }> {
  const meeting = await readMeetingForEvent(
    database,
    event.kind,
    event.id,
    visibleMatterPredicate(),
  );
  if (meeting === undefined || meeting.status === "ended") return { ok: true, effect: NO_CLOSING };
  if (meeting.status === "live") return { ok: false, problem: meetingInProgress(c) };
  const { effect } = await endScheduledMeetingForCancelledEvent(
    database,
    meeting.id,
    serviceOptions(userId),
  );
  return { ok: true, effect };
}

/**
 * One cancellation, with whatever its event's meeting needs doing about it — and the answer to the
 * race the pre-read cannot settle.
 *
 * The meeting is settled BEFORE the idempotency gate, because the refusal is about the world rather
 * than about this request: a room with people in it is not made cancellable by retrying, and a
 * caller who retried under the same key would otherwise be replayed a cancellation that never
 * happened.
 *
 * A GUARD REFUSAL HERE IS THE RACE, AND IT HAS TWO ENDINGS. The whole batch — the cancelled event
 * included — has rolled back, and no idempotency record was written with it, so the same key is free
 * to be used again. Re-reading the meeting is what separates the two: somebody joined, and the
 * cancel is refused exactly as the pre-read refuses it; or the host ended the room in the same
 * window, and there is nothing left to close, so the cancellation stands on its own.
 */
async function cancelWithMeetingClosing(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  userId: string,
  event: { readonly kind: MeetingEventKind; readonly id: string },
  cancel: (closing: {
    readonly effect: EffectWrite;
  }) => Promise<{ id: string; effect: EffectWrite }>,
): Promise<CalendarEffectOutcome> {
  let closing = await meetingClosingWithEvent(c, database, userId, event);
  for (let attempt = 1; ; attempt += 1) {
    if (!closing.ok) return { ok: false, problem: closing.problem };
    const composed = closing;
    try {
      return await commitCalendarEffect(c, database, idempotency, 200, () => cancel(composed));
    } catch (caught) {
      if (!(caught instanceof GuardedWriteRefusedError)) throw caught;
      // A batch with nothing to close carries neither guard below, so a refusal of one is a fault no
      // re-read can explain — and composing it again would refuse again for ever.
      if (composed.effect === NO_CLOSING) throw caught;
      if (caught.guard === STOP_RECORDING_GUARD) {
        // A RECORDING RUNNING IN THE ROOM STOPPED IN THE SAME WINDOW — somebody pressed Stop, or the
        // recorder stopped itself — so the stop this closing composed refused, and the whole batch
        // rolled back with it. The recording is already stopped by a stop the record keeps; the closing
        // is composed again from what is true now, which stops nothing — or, if the room has moved as
        // well, ends in the refusal or the bare cancellation below.
        closing = await meetingClosingWithEvent(c, database, userId, event);
      } else if (caught.guard === CANCEL_CLOSING_GUARD) {
        const settled = await readMeetingForEvent(
          database,
          event.kind,
          event.id,
          visibleMatterPredicate(),
        );
        // Anything but ended means somebody is in there: a live room, or a stay opened against a room
        // the status has not caught up with. Either way this is the pre-read's refusal, arrived at the
        // other way round. Ended means there is nothing left to close.
        closing =
          settled !== undefined && settled.status !== "ended"
            ? { ok: false, problem: meetingInProgress(c) }
            : { ok: true, effect: NO_CLOSING };
      } else {
        throw caught;
      }
      // THE BOUND COUNTS ONLY WHAT CAN BE REFUSED AGAIN. A refusal answer, or a cancellation with
      // nothing to close, cannot meet either guard, so it goes ahead whatever attempt this was: a race
      // that settled on the last attempt is answered as it settled — the 409, or the cancellation
      // standing on its own — and never as a server error. Only a closing composed AGAIN, which the
      // room could move under once more, is held to the bound.
      if (closing.ok && closing.effect !== NO_CLOSING && attempt >= CANCEL_ATTEMPTS) throw caught;
    }
  }
}

// HOW MANY TIMES A CANCELLATION IS COMPOSED when the room moves under it. Each refusal is one race —
// somebody walked in or ended the room, or a recording stopped — and each retry is composed from a
// fresh read, so a third attempt would need the room to move twice more inside one round trip.
const CANCEL_ATTEMPTS = 3;

const DEFAULT_PAGE = 50;

// How many distinct zones the overdue narrowing will compose a clause for. A firm keeps deadlines in
// the zones of the courts it appears in — a handful — and this bound exists so a corrupt or
// adversarially-varied zone column cannot turn one page read into a thousand-clause query. Reached,
// it under-reports rather than over-reports, which is the safe direction for a list that says a firm
// has missed something. The read reports whether the bound bit; this caller DISCARDS that, because a
// list read has nowhere honest to put it — an extra page field would be a wire contract, and a
// refusal would take a whole firm's overdue list away over one corrupt zone column. The nightly
// comparison pass is where the same truncation is counted, on its own operator counter.
const MAX_OVERDUE_ZONES = 64;

// The per-zone cutoffs the overdue narrowing composes: read the zones the page could contain, then
// invert the overdue comparison once per zone. Two statements rather than one, because the inversion
// needs a zone database and SQLite has none.
async function readOverdueCutoffs(
  database: SqlDatabase,
  now: string,
  visibility: { visibilityFragment: string; visibilityBindings: readonly unknown[] },
): Promise<OverdueCutoff[]> {
  // One day past the UTC civil date: the furthest-ahead zone runs about fourteen hours ahead of UTC,
  // so a deadline dated tomorrow in UTC terms can already have fallen due there. Anything later
  // cannot be overdue in any zone, which makes this an index-friendly coarse bound the per-zone
  // clauses then narrow exactly.
  const throughDate = civilDateOf(new Date(Date.parse(now) + 86_400_000));
  const { timeZones } = await readOpenDeadlineTimeZones(database, {
    throughDate,
    limit: MAX_OVERDUE_ZONES,
    ...visibility,
  });
  const cutoffs: OverdueCutoff[] = [];
  for (const timeZone of timeZones) {
    const cutoff = overdueCutoffFor(timeZone, now);
    // A zone the runtime cannot resolve yields no cutoff, and is left out of the narrowing rather
    // than put on an overdue list under a date the platform cannot read.
    if (cutoff !== undefined) cutoffs.push(cutoff);
  }
  return cutoffs;
}

async function readEventsPage(
  database: SqlDatabase,
  matterId: MatterId,
  cursor: string | undefined,
): Promise<{ data: z.infer<typeof EventDetail>[]; nextCursor: string | null }> {
  const decoded = decodeTimelineCursor(cursor);
  const { results } = await selectMatterEventsStatement(database, matterId, {
    cursor: decoded === undefined ? undefined : { sortKey: decoded.sortKey, id: decoded.id },
    limit: DEFAULT_PAGE + 1,
    visibility: visibleMatterPredicate(),
  }).all<MatterEventDisplayRow>();
  const hasMore = results.length > DEFAULT_PAGE;
  const rows = hasMore ? results.slice(0, DEFAULT_PAGE) : results;
  const last = rows.at(-1);
  // The continuance neighbors for the whole page in one bounded query, so a list can badge
  // "continued from" without a per-row walk.
  const neighbors = await continuanceNeighborsFor(
    database,
    rows.map((row) => row.id),
  );
  return {
    data: rows.map((row) => eventDetail(row, neighbors.get(row.id))),
    // The platform's cursor encoding, imported rather than re-spelled: the calendar mints no wire
    // contract of its own, and a hand-rolled copy is a site that will not move when the encoding does.
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.starts_on, last.id) : null,
  };
}

// ---- registration ----

export function registerCalendarRoutes(app: CalendarApp, chokepoint: Chokepoint): void {
  // GET /api/v1/matters/{matterId}/timeline
  app.openapi(
    { ...timelineRoute, middleware: chokepointMiddleware(chokepoint, timelineRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const query = c.req.valid("query");
      const bounds = directionBounds(query.direction, query.from, query.to, todayInUtc());
      try {
        const page = await readTimelinePage({
          database: firm.firmDatabase,
          registry: timelineSourceRegistry(),
          visibility: visibleMatterPredicate(),
          scope: { matterId, fromDate: bounds.fromDate, toDate: bounds.toDate },
          sourceKeys: repeatable(query.kind),
          cursor: decodeTimelineCursor(query.cursor),
          pageSize: DEFAULT_PAGE,
          // The one read that describes: it is scoped to a matter the member is standing in, and
          // the capability set the chokepoint resolved is what each source's own gate reads.
          describe: { permissions: requireChokepointPermissions(c) },
        });
        return c.json({ data: [...page.entries], nextCursor: page.nextCursor }, 200);
      } catch (caught) {
        if (caught instanceof CalendarValidationError) return calendarReadErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // GET /api/v1/matters/{matterId}/events
  app.openapi(
    { ...listEventsRoute, middleware: chokepointMiddleware(chokepoint, listEventsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const { cursor } = c.req.valid("query");
      const page = await readEventsPage(firm.firmDatabase, matterId, cursor);
      return c.json(page, 200);
    },
  );

  // GET /api/v1/events/{eventId}
  app.openapi(
    { ...getEventRoute, middleware: chokepointMiddleware(chokepoint, getEventRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { eventId } = c.req.valid("param");
      // Through the visible-matter predicate, like every other read of this table: an event on an
      // invisible matter is a 404 here and not a title, a description, a court reference, and a
      // participant list.
      const event = await readMatterEventDetail(
        firm.firmDatabase,
        eventId as MatterEventId,
        visibleMatterPredicate(),
      );
      if (event === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such event in this firm.",
        });
      }
      const participants = await readMatterEventParticipants(
        firm.firmDatabase,
        eventId as MatterEventId,
      );
      const neighbors = await continuanceNeighborsFor(firm.firmDatabase, [
        eventId as MatterEventId,
      ]);
      return c.json(
        {
          event: eventDetail(event, neighbors.get(eventId)),
          participants: participants.map((row) => ({
            id: row.id,
            participantKind: row.participant_kind,
            memberUserId: row.member_user_id,
            entityId: row.entity_id,
            participantName: row.participant_name,
            role: row.role,
          })),
        },
        200,
      );
    },
  );

  // GET /api/v1/calendar/events
  app.openapi(
    { ...firmCalendarRoute, middleware: chokepointMiddleware(chokepoint, firmCalendarRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      try {
        // Refused before a single statement is built. A window this wide is a request the platform
        // will not serve, not one it quietly narrows.
        assertCalendarWindow(query.from, query.to);
        const page = await readTimelinePage({
          database: firm.firmDatabase,
          registry: timelineSourceRegistry(),
          visibility: visibleMatterPredicate(),
          scope: {
            matterId: query.matterId,
            fromDate: query.from,
            toDate: query.to,
            memberUserId: query.memberId,
          },
          sourceKeys: repeatable(query.kind),
          anchorScope: query.scope,
          cursor: decodeTimelineCursor(query.cursor),
          pageSize: DEFAULT_PAGE,
        });
        return c.json({ data: [...page.entries], nextCursor: page.nextCursor }, 200);
      } catch (caught) {
        if (caught instanceof CalendarValidationError) return calendarReadErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // GET /api/v1/calendar/deadlines
  app.openapi(
    { ...deadlinesRoute, middleware: chokepointMiddleware(chokepoint, deadlinesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      const now = new Date().toISOString();
      try {
        if (query.from !== undefined && query.through !== undefined) {
          assertDeadlineHorizon(query.from, query.through);
        }
        const visibility = visibleMatterPredicate();
        const visibilityFragment = visibility.fragmentFor("matter_deadline.matter_id");
        const decoded = decodeTimelineCursor(query.cursor);
        const overdueOnly = query.overdue === "true";
        // The overdue narrowing is composed PER ZONE and is exact — the same predicate `isOverdue`
        // applies row by row, not the `due_on <= <UTC today>` approximation, which reports a Nevada
        // firm's live same-day deadlines as already missed for most of the working day. SQLite
        // carries no zone database, so the cutoffs are computed here, one per zone the page could
        // contain, and every one of them goes into the WHERE clause. Nothing is filtered after the
        // rows come back: a post-filter under-fills the page, makes the next cursor mean something
        // different from page to page, and turns the page size into an existence oracle.
        //
        // The zone read is bounded by the widest date any zone could still be inside — one day past
        // the UTC date, since no zone runs more than a day ahead of it.
        const overdueCutoffs = overdueOnly
          ? await readOverdueCutoffs(firm.firmDatabase, now, {
              visibilityFragment,
              visibilityBindings: visibility.bindings,
            })
          : undefined;
        const { results } = await selectMatterDeadlinesStatement(firm.firmDatabase, {
          matterId: query.matterId,
          state: query.state,
          overdueCutoffs,
          fromDate: query.from,
          throughDate: overdueOnly ? undefined : query.through,
          cursor: decoded === undefined ? undefined : { sortKey: decoded.sortKey, id: decoded.id },
          limit: DEFAULT_PAGE + 1,
          visibilityFragment,
          visibilityBindings: visibility.bindings,
        }).all<MatterDeadlineRow>();
        const hasMore = results.length > DEFAULT_PAGE;
        const rows = hasMore ? results.slice(0, DEFAULT_PAGE) : results;
        const last = rows.at(-1);
        return c.json(
          {
            data: rows.map((row) => deadlineDetail(row, now)),
            nextCursor: hasMore && last !== undefined ? encodeCursor(last.due_on, last.id) : null,
          },
          200,
        );
      } catch (caught) {
        if (caught instanceof CalendarValidationError) return calendarReadErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // GET /api/v1/calendar/event-types
  app.openapi(
    { ...listEventTypesRoute, middleware: chokepointMiddleware(chokepoint, listEventTypesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { includeInactive } = c.req.valid("query");
      const rows = await readMatterEventTypes(firm.firmDatabase, includeInactive === "true");
      return c.json(
        {
          data: rows.map((row) => ({
            id: row.id,
            name: row.name,
            code: row.code,
            category: row.category,
            origin: row.origin,
            active: row.active === 1,
          })),
        },
        200,
      );
    },
  );

  // GET /api/v1/calendar/settings
  app.openapi(
    { ...getSettingsRoute, middleware: chokepointMiddleware(chokepoint, getSettingsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      return c.json({ weekStartsOn: await readCalendarWeekStartsOn(firm.firmDatabase) }, 200);
    },
  );

  // PATCH /api/v1/calendar/settings
  app.openapi(
    { ...updateSettingsRoute, middleware: chokepointMiddleware(chokepoint, updateSettingsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const request = c.req.valid("json");
      const weekStartsOn: WeekStartsOn | undefined = request.weekStartsOn;
      if (weekStartsOn === undefined) {
        // An empty patch changes nothing and must not add an audit row: a redelivered no-op would
        // otherwise put a settings change in the log that nobody made.
        return c.json({ weekStartsOn: await readCalendarWeekStartsOn(firm.firmDatabase) }, 200);
      }
      const idempotency = requireChokepointIdempotency(c);
      const options = serviceOptions(userId);
      const outcome = await commitCalendarEffect(
        c,
        firm.firmDatabase,
        idempotency,
        200,
        async () => ({
          id: "calendar.weekStartsOn",
          effect: {
            statements: [
              writeCalendarWeekStartsOnStatement(
                firm.firmDatabase,
                weekStartsOn,
                options.clock.now(),
              ),
              domainAuditStatement(firm.firmDatabase, {
                event: "calendar.settings.updated",
                // The setting's own key is the subject: there is no row identifier to name, and
                // the key is what a later reader of the trail searches for.
                subjectId: "calendar.weekStartsOn",
                actorUserId: options.actorUserId,
                clock: options.clock,
                randomSource: options.randomSource,
                // An integer from a closed vocabulary. Nothing here was typed by a person.
                metadata: { weekStartsOn },
              }),
            ],
            outboxMessages: [],
          },
        }),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ weekStartsOn: await readCalendarWeekStartsOn(firm.firmDatabase) }, 200);
    },
  );

  // POST /api/v1/matters/{matterId}/events
  app.openapi(
    { ...createEventRoute, middleware: chokepointMiddleware(chokepoint, createEventRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { matterId } = c.req.valid("param");
      const request = c.req.valid("json");
      const unhosted = refuseUnhostedMeeting(c, request.meeting);
      if (unhosted !== null) return unhosted;
      // The event and the room it carries commit together, and the stored body carries both — the
      // idempotency gate replays it verbatim without reaching this handler, so a meeting minted
      // outside the effect would be missing from every replayed answer.
      const outcome = await commitRichCalendarEffect<{ id: string; meetingId: string | null }>(
        c,
        firm.firmDatabase,
        idempotency,
        201,
        () => {
          const created = createMatterEvent(
            firm.firmDatabase,
            { ...request, matterId, participants: request.participants },
            serviceOptions(userId),
          );
          const scheduling = scheduleMeetingOnNewEvent(
            firm.firmDatabase,
            userId,
            { kind: "matter", id: created.eventId, matterId },
            request.meeting,
            request.participants,
            endToEndEncryptionEnabled(c.env),
          );
          return Promise.resolve({
            body: { id: created.eventId, meetingId: scheduling.meetingId },
            effect: withScheduling(created.effect, scheduling),
          });
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json(outcome.body, 201);
    },
  );

  // PATCH /api/v1/events/{eventId}
  app.openapi(
    { ...updateEventRoute, middleware: chokepointMiddleware(chokepoint, updateEventRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { eventId } = c.req.valid("param");
      const request = c.req.valid("json");
      const unhosted = refuseUnhostedMeeting(c, request.meeting);
      if (unhosted !== null) return unhosted;
      // Moving an event keeps its meeting: a meeting carries no time of its own. Supplying one adds
      // a room to an event that has none, in the same batch as the correction.
      const outcome = await commitRichCalendarEffect<{ ok: true; meetingId: string | null }>(
        c,
        firm.firmDatabase,
        idempotency,
        200,
        async () => {
          const { effect } = await updateMatterEvent(
            firm.firmDatabase,
            eventId as MatterEventId,
            request,
            serviceOptions(userId),
          );
          const scheduling = await scheduleMeetingOnExistingEvent(
            firm.firmDatabase,
            userId,
            { kind: "matter", id: eventId },
            request.meeting,
            endToEndEncryptionEnabled(c.env),
          );
          return {
            body: { ok: true, meetingId: scheduling.meetingId },
            effect: withScheduling(effect, scheduling),
          };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json(outcome.body, 200);
    },
  );

  // POST /api/v1/events/{eventId}/cancel
  app.openapi(
    { ...cancelEventRoute, middleware: chokepointMiddleware(chokepoint, cancelEventRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { eventId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await cancelWithMeetingClosing(
        c,
        firm.firmDatabase,
        idempotency,
        userId,
        { kind: "matter", id: eventId },
        async (closing) => {
          const { effect } = await cancelMatterEvent(
            firm.firmDatabase,
            eventId as MatterEventId,
            serviceOptions(userId),
            request?.statusReason ?? null,
          );
          // One batch for both: the setting is off and the room nobody entered is closed, and a
          // crash between the two would leave a calendar entry cancelled with a room still open on
          // it.
          return { id: eventId, effect: withScheduling(effect, closing) };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // POST /api/v1/matters/{matterId}/deadlines
  app.openapi(
    { ...createDeadlineRoute, middleware: chokepointMiddleware(chokepoint, createDeadlineRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { matterId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitCalendarEffect(
        c,
        firm.firmDatabase,
        idempotency,
        201,
        async () => {
          const created = await createMatterDeadline(
            firm.firmDatabase,
            { ...request, matterId },
            serviceOptions(userId),
          );
          return { id: created.deadlineId, effect: created.effect };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id }, 201);
    },
  );

  // PATCH /api/v1/deadlines/{deadlineId}
  app.openapi(
    { ...updateDeadlineRoute, middleware: chokepointMiddleware(chokepoint, updateDeadlineRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { deadlineId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitCalendarEffect(
        c,
        firm.firmDatabase,
        idempotency,
        200,
        async () => {
          const { effect } = await updateMatterDeadline(
            firm.firmDatabase,
            deadlineId as MatterDeadlineId,
            request,
            serviceOptions(userId),
          );
          return { id: deadlineId, effect };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // POST /api/v1/deadlines/{deadlineId}/satisfy
  app.openapi(
    { ...satisfyDeadlineRoute, middleware: chokepointMiddleware(chokepoint, satisfyDeadlineRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { deadlineId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitCalendarEffect(
        c,
        firm.firmDatabase,
        idempotency,
        200,
        async () => {
          const { effect } = await satisfyMatterDeadline(
            firm.firmDatabase,
            deadlineId as MatterDeadlineId,
            {
              // The acting member, never a value the caller supplies: who met a deadline is a fact
              // about the session, not a field in a request body.
              satisfiedBy: userId as never,
              satisfyingEventId: request.satisfyingEventId,
              satisfactionNote: request.satisfactionNote,
            },
            serviceOptions(userId),
          );
          return { id: deadlineId, effect };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // POST /api/v1/deadlines/{deadlineId}/vacate
  app.openapi(
    { ...vacateDeadlineRoute, middleware: chokepointMiddleware(chokepoint, vacateDeadlineRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { deadlineId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitCalendarEffect(
        c,
        firm.firmDatabase,
        idempotency,
        200,
        async () => {
          const { effect } = await closeMatterDeadline(
            firm.firmDatabase,
            deadlineId as MatterDeadlineId,
            "vacated",
            { stateReason: request.stateReason },
            serviceOptions(userId),
          );
          return { id: deadlineId, effect };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // POST /api/v1/deadlines/{deadlineId}/supersede
  app.openapi(
    {
      ...supersedeDeadlineRoute,
      middleware: chokepointMiddleware(chokepoint, supersedeDeadlineRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { deadlineId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitCalendarEffect(
        c,
        firm.firmDatabase,
        idempotency,
        200,
        async () => {
          const { effect } = await closeMatterDeadline(
            firm.firmDatabase,
            deadlineId as MatterDeadlineId,
            "superseded",
            {
              stateReason: request.stateReason,
              supersededByDeadlineId: request.supersededByDeadlineId,
            },
            serviceOptions(userId),
          );
          return { id: deadlineId, effect };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // POST /api/v1/calendar/event-types
  app.openapi(
    { ...createEventTypeRoute, middleware: chokepointMiddleware(chokepoint, createEventTypeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      const outcome = await commitCalendarEffect(
        c,
        firm.firmDatabase,
        idempotency,
        201,
        async () => {
          const created = await createMatterEventType(
            firm.firmDatabase,
            request,
            serviceOptions(userId),
          );
          return { id: created.eventTypeId, effect: created.effect };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id }, 201);
    },
  );

  // PATCH /api/v1/calendar/event-types/{eventTypeId}
  app.openapi(
    { ...updateEventTypeRoute, middleware: chokepointMiddleware(chokepoint, updateEventTypeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { eventTypeId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitCalendarEffect(
        c,
        firm.firmDatabase,
        idempotency,
        200,
        async () => {
          const { effect } = await updateMatterEventType(
            firm.firmDatabase,
            eventTypeId,
            request,
            serviceOptions(userId),
          );
          return { id: eventTypeId, effect };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // POST /api/v1/calendar/event-types/{eventTypeId}/deactivate
  app.openapi(
    {
      ...deactivateEventTypeRoute,
      middleware: chokepointMiddleware(chokepoint, deactivateEventTypeRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { eventTypeId } = c.req.valid("param");
      const outcome = await commitCalendarEffect(
        c,
        firm.firmDatabase,
        idempotency,
        200,
        async () => {
          const { effect } = await deactivateMatterEventType(
            firm.firmDatabase,
            eventTypeId,
            serviceOptions(userId),
          );
          return { id: eventTypeId, effect };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // GET /api/v1/firm-events
  app.openapi(
    { ...listFirmEventsRoute, middleware: chokepointMiddleware(chokepoint, listFirmEventsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      try {
        assertCalendarWindow(query.from, query.to);
        const decoded = decodeTimelineCursor(query.cursor);
        const { results } = await selectFirmEventsStatement(firm.firmDatabase, {
          fromDate: query.from,
          toDate: query.to,
          status: query.status,
          eventTypeId: query.eventTypeId as never,
          cursor: decoded === undefined ? undefined : { sortKey: decoded.sortKey, id: decoded.id },
          limit: DEFAULT_PAGE + 1,
        }).all<FirmEventRow>();
        const hasMore = results.length > DEFAULT_PAGE;
        const rows = hasMore ? results.slice(0, DEFAULT_PAGE) : results;
        const last = rows.at(-1);
        return c.json(
          {
            data: rows.map(firmEventDetail),
            nextCursor:
              hasMore && last !== undefined ? encodeCursor(last.starts_on, last.id) : null,
          },
          200,
        );
      } catch (caught) {
        if (caught instanceof CalendarValidationError) return calendarReadErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // GET /api/v1/firm-events/{firmEventId}
  app.openapi(
    { ...getFirmEventRoute, middleware: chokepointMiddleware(chokepoint, getFirmEventRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { firmEventId } = c.req.valid("param");
      const event = await readFirmEvent(firm.firmDatabase, firmEventId as FirmEventId);
      if (event === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such firm event in this firm.",
        });
      }
      const participants = await readFirmEventParticipants(
        firm.firmDatabase,
        firmEventId as FirmEventId,
      );
      return c.json(
        {
          event: firmEventDetail(event),
          participants: participants.map((row) => ({
            id: row.id,
            participantKind: row.participant_kind,
            memberUserId: row.member_user_id,
            entityId: row.entity_id,
            participantName: row.participant_name,
            role: row.role,
          })),
        },
        200,
      );
    },
  );

  // POST /api/v1/firm-events
  app.openapi(
    { ...createFirmEventRoute, middleware: chokepointMiddleware(chokepoint, createFirmEventRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      const unhosted = refuseUnhostedMeeting(c, request.meeting);
      if (unhosted !== null) return unhosted;
      const outcome = await commitRichCalendarEffect<{ id: string; meetingId: string | null }>(
        c,
        firm.firmDatabase,
        idempotency,
        201,
        async () => {
          const created = await createFirmEvent(
            firm.firmDatabase,
            { ...request, locationId: request.locationId as never },
            serviceOptions(userId),
          );
          const scheduling = scheduleMeetingOnNewEvent(
            firm.firmDatabase,
            userId,
            // A firm event has no matter, which is also why it raises no invitation yet.
            { kind: "firm", id: created.firmEventId, matterId: null },
            request.meeting,
            request.participants,
            endToEndEncryptionEnabled(c.env),
          );
          return {
            body: { id: created.firmEventId, meetingId: scheduling.meetingId },
            effect: withScheduling(created.effect, scheduling),
          };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json(outcome.body, 201);
    },
  );

  // PATCH /api/v1/firm-events/{firmEventId}
  app.openapi(
    { ...updateFirmEventRoute, middleware: chokepointMiddleware(chokepoint, updateFirmEventRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { firmEventId } = c.req.valid("param");
      const request = c.req.valid("json");
      const unhosted = refuseUnhostedMeeting(c, request.meeting);
      if (unhosted !== null) return unhosted;
      const outcome = await commitRichCalendarEffect<{ ok: true; meetingId: string | null }>(
        c,
        firm.firmDatabase,
        idempotency,
        200,
        async () => {
          const { effect } = await updateFirmEvent(
            firm.firmDatabase,
            firmEventId as FirmEventId,
            { ...request, locationId: request.locationId as never },
            serviceOptions(userId),
          );
          const scheduling = await scheduleMeetingOnExistingEvent(
            firm.firmDatabase,
            userId,
            { kind: "firm", id: firmEventId },
            request.meeting,
            endToEndEncryptionEnabled(c.env),
          );
          return {
            body: { ok: true, meetingId: scheduling.meetingId },
            effect: withScheduling(effect, scheduling),
          };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json(outcome.body, 200);
    },
  );

  // POST /api/v1/firm-events/{firmEventId}/cancel
  app.openapi(
    { ...cancelFirmEventRoute, middleware: chokepointMiddleware(chokepoint, cancelFirmEventRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { firmEventId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await cancelWithMeetingClosing(
        c,
        firm.firmDatabase,
        idempotency,
        userId,
        { kind: "firm", id: firmEventId },
        async (closing) => {
          const { effect } = await cancelFirmEvent(
            firm.firmDatabase,
            firmEventId as FirmEventId,
            serviceOptions(userId),
            request?.statusReason ?? null,
          );
          return { id: firmEventId, effect: withScheduling(effect, closing) };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // GET /api/v1/calendar/resources
  app.openapi(
    { ...listResourcesRoute, middleware: chokepointMiddleware(chokepoint, listResourcesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      const page = await readFirmResources(firm.firmDatabase, {
        kind: query.kind,
        locationId: query.locationId as never,
        includeInactive: query.includeInactive === "true",
      });
      return c.json({ data: page.rows.map(resourceDetail), capped: page.capped }, 200);
    },
  );

  // POST /api/v1/calendar/resources
  app.openapi(
    { ...createResourceRoute, middleware: chokepointMiddleware(chokepoint, createResourceRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      const outcome = await commitCalendarEffect(
        c,
        firm.firmDatabase,
        idempotency,
        201,
        async () => {
          const created = await createFirmResource(
            firm.firmDatabase,
            { ...request, locationId: request.locationId as never },
            serviceOptions(userId),
          );
          return { id: created.firmResourceId, effect: created.effect };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id }, 201);
    },
  );

  // PATCH /api/v1/calendar/resources/{firmResourceId}
  app.openapi(
    { ...updateResourceRoute, middleware: chokepointMiddleware(chokepoint, updateResourceRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { firmResourceId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitCalendarEffect(
        c,
        firm.firmDatabase,
        idempotency,
        200,
        async () => {
          const { effect } = await updateFirmResource(
            firm.firmDatabase,
            firmResourceId as FirmResourceId,
            { ...request, locationId: request.locationId as never },
            serviceOptions(userId),
          );
          return { id: firmResourceId, effect };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // GET /api/v1/calendar/resources/{firmResourceId}/availability
  app.openapi(
    {
      ...resourceAvailabilityRoute,
      middleware: chokepointMiddleware(chokepoint, resourceAvailabilityRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { firmResourceId } = c.req.valid("param");
      const query = c.req.valid("query");
      try {
        assertCalendarWindow(query.from, query.to);
        const resource = await readFirmResource(
          firm.firmDatabase,
          firmResourceId as FirmResourceId,
        );
        if (resource === undefined) {
          return problemJson(c, {
            type: "not-found",
            title: "Not found",
            status: 404,
            detail: "No such resource in this firm.",
          });
        }
        const entries = await readResourceAvailability(firm.firmDatabase, {
          resourceId: firmResourceId as FirmResourceId,
          fromDate: query.from,
          toDate: query.to,
        });
        return c.json(
          {
            data: entries.map((entry) => ({
              bookingId: entry.bookingId,
              startsOn: entry.startsOn,
              startsAtTime: entry.startsAtTime,
              endsOn: entry.endsOn,
              endsAtTime: entry.endsAtTime,
              timeZone: entry.timeZone,
              eventKind: entry.eventKind,
              eventId: entry.eventId,
              eventTypeName: entry.eventTypeName,
              link: entry.link,
              overlappingBookingIds: [...entry.overlappingBookingIds],
            })),
          },
          200,
        );
      } catch (caught) {
        if (caught instanceof CalendarValidationError) return calendarReadErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // GET /api/v1/events/{eventId}/bookings
  app.openapi(
    {
      ...listEventBookingsRoute,
      middleware: chokepointMiddleware(chokepoint, listEventBookingsRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { eventId } = c.req.valid("param");
      const event = await readMatterEventDetail(
        firm.firmDatabase,
        eventId as MatterEventId,
        visibleMatterPredicate(),
      );
      if (event === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such event in this firm.",
        });
      }
      const rows = await readBookingsForEvent(firm.firmDatabase, {
        matterEventId: eventId as MatterEventId,
      });
      return c.json({ data: rows.map(eventBooking) }, 200);
    },
  );

  // GET /api/v1/firm-events/{firmEventId}/bookings
  app.openapi(
    {
      ...listFirmEventBookingsRoute,
      middleware: chokepointMiddleware(chokepoint, listFirmEventBookingsRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { firmEventId } = c.req.valid("param");
      const event = await readFirmEvent(firm.firmDatabase, firmEventId as FirmEventId);
      if (event === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such firm event in this firm.",
        });
      }
      const rows = await readBookingsForEvent(firm.firmDatabase, {
        firmEventId: firmEventId as FirmEventId,
      });
      return c.json({ data: rows.map(eventBooking) }, 200);
    },
  );

  // POST /api/v1/resource-bookings
  app.openapi(
    { ...createBookingRoute, middleware: chokepointMiddleware(chokepoint, createBookingRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      const outcome = await commitRichCalendarEffect(
        c,
        firm.firmDatabase,
        idempotency,
        201,
        async () => {
          const created = await createFirmResourceBooking(
            firm.firmDatabase,
            {
              resourceId: request.resourceId as FirmResourceId,
              matterEventId: request.matterEventId as never,
              firmEventId: request.firmEventId as never,
              startsOn: request.startsOn,
              startsAtTime: request.startsAtTime,
              endsOn: request.endsOn,
              endsAtTime: request.endsAtTime,
              timeZone: request.timeZone,
            },
            serviceOptions(userId),
          );
          return {
            body: {
              id: created.firmResourceBookingId as string,
              conflicts: created.conflicts.map(bookingConflictDetail),
            },
            effect: created.effect,
          };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json(outcome.body, 201);
    },
  );

  // PATCH /api/v1/resource-bookings/{firmResourceBookingId}
  app.openapi(
    { ...updateBookingRoute, middleware: chokepointMiddleware(chokepoint, updateBookingRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { firmResourceBookingId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitRichCalendarEffect(
        c,
        firm.firmDatabase,
        idempotency,
        200,
        async () => {
          const updated = await updateFirmResourceBooking(
            firm.firmDatabase,
            firmResourceBookingId as FirmResourceBookingId,
            request,
            serviceOptions(userId),
          );
          return {
            body: { ok: true as const, conflicts: updated.conflicts.map(bookingConflictDetail) },
            effect: updated.effect,
          };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json(outcome.body, 200);
    },
  );

  // DELETE /api/v1/resource-bookings/{firmResourceBookingId}
  app.openapi(
    { ...deleteBookingRoute, middleware: chokepointMiddleware(chokepoint, deleteBookingRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { firmResourceBookingId } = c.req.valid("param");
      const outcome = await commitCalendarEffect(
        c,
        firm.firmDatabase,
        idempotency,
        200,
        async () => {
          const { effect } = await deleteFirmResourceBooking(
            firm.firmDatabase,
            firmResourceBookingId as FirmResourceBookingId,
            serviceOptions(userId),
          );
          return { id: firmResourceBookingId, effect };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // POST /api/v1/event-links
  app.openapi(
    { ...createEventLinkRoute, middleware: chokepointMiddleware(chokepoint, createEventLinkRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      const from = linkEndFrom(request.fromMatterEventId, request.fromFirmEventId);
      const to = linkEndFrom(request.toMatterEventId, request.toFirmEventId);
      if (from === undefined || to === undefined) {
        return problemJson(c, {
          type: "validation",
          title: "Calendar request invalid",
          status: 422,
          detail:
            "each end of a link names exactly one event: a matter event or a firm event, never both and never neither",
        });
      }
      const outcome = await commitCalendarEffect(
        c,
        firm.firmDatabase,
        idempotency,
        201,
        async () => {
          const created = await createRelatedLink(
            firm.firmDatabase,
            { from, to, note: request.note },
            serviceOptions(userId),
          );
          return { id: created.calendarEventLinkId, effect: created.effect };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id }, 201);
    },
  );

  // DELETE /api/v1/event-links/{calendarEventLinkId}
  app.openapi(
    { ...deleteEventLinkRoute, middleware: chokepointMiddleware(chokepoint, deleteEventLinkRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { calendarEventLinkId } = c.req.valid("param");
      const outcome = await commitCalendarEffect(
        c,
        firm.firmDatabase,
        idempotency,
        200,
        async () => {
          const { effect } = await deleteRelatedLink(
            firm.firmDatabase,
            calendarEventLinkId as CalendarEventLinkId,
            serviceOptions(userId),
          );
          return { id: calendarEventLinkId, effect };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // POST /api/v1/events/{eventId}/continue
  app.openapi(
    { ...continueEventRoute, middleware: chokepointMiddleware(chokepoint, continueEventRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { eventId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitRichCalendarEffect(
        c,
        firm.firmDatabase,
        idempotency,
        201,
        async () => {
          const continued = await continueMatterEvent(
            firm.firmDatabase,
            eventId as MatterEventId,
            request,
            serviceOptions(userId),
          );
          return {
            body: {
              newEventId: continued.newEventId as string,
              oldEventId: continued.oldEventId as string,
              triggerLinkedOpenDeadlines: continued.triggerLinkedOpenDeadlines.map((row) => ({
                id: row.id as string,
                title: row.title,
                dueOn: row.due_on,
                dueAtTime: row.due_at_time,
                timeZone: row.time_zone,
                state: row.state,
              })),
              releasedBookings: continued.releasedBookings.map((row) =>
                bookingConflictDetail({
                  bookingId: row.id,
                  startsOn: row.starts_on,
                  startsAtTime: row.starts_at_time,
                  endsOn: row.ends_on,
                  endsAtTime: row.ends_at_time,
                  timeZone: row.time_zone,
                  eventKind: row.event_kind,
                  eventId: (row.matter_event_id ?? row.firm_event_id ?? "") as string,
                  link:
                    row.event_kind === "matterEvent"
                      ? `/events/${row.matter_event_id ?? ""}`
                      : `/firm-events/${row.firm_event_id ?? ""}`,
                }),
              ),
            },
            effect: continued.effect,
          };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json(outcome.body, 201);
    },
  );

  // GET /api/v1/events/{eventId}/links
  app.openapi(
    { ...listEventLinksRoute, middleware: chokepointMiddleware(chokepoint, listEventLinksRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { eventId } = c.req.valid("param");
      // Through the visible-matter predicate, as the event's own read is: a link is a fact about an
      // event, and an event on an invisible matter has no facts here.
      const event = await readMatterEventDetail(
        firm.firmDatabase,
        eventId as MatterEventId,
        visibleMatterPredicate(),
      );
      if (event === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such event in this firm.",
        });
      }
      const links = await readLinksTouchingEvent(firm.firmDatabase, {
        matterEventId: eventId as MatterEventId,
      });
      return c.json({ data: links.map(eventLinkDetail) }, 200);
    },
  );

  // GET /api/v1/firm-events/{firmEventId}/links
  app.openapi(
    {
      ...listFirmEventLinksRoute,
      middleware: chokepointMiddleware(chokepoint, listFirmEventLinksRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { firmEventId } = c.req.valid("param");
      const event = await readFirmEvent(firm.firmDatabase, firmEventId as FirmEventId);
      if (event === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such firm event in this firm.",
        });
      }
      const links = await readLinksTouchingEvent(firm.firmDatabase, {
        firmEventId: firmEventId as FirmEventId,
      });
      return c.json({ data: links.map(eventLinkDetail) }, 200);
    },
  );

  // GET /api/v1/events/{eventId}/continuance-chain
  app.openapi(
    {
      ...continuanceChainRoute,
      middleware: chokepointMiddleware(chokepoint, continuanceChainRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { eventId } = c.req.valid("param");
      try {
        const chain = await readContinuanceChain(
          firm.firmDatabase,
          eventId as MatterEventId,
          serviceOptions(requireChokepointUserId(c)),
        );
        return c.json(
          {
            data: chain.map((node) => ({
              eventId: node.eventId as string,
              startsOn: node.startsOn,
              startsAtTime: node.startsAtTime,
              timeZone: node.timeZone,
              status: node.status,
              statusReason: node.statusReason,
            })),
          },
          200,
        );
      } catch (caught) {
        if (caught instanceof CalendarValidationError) return calendarReadErrorResponse(c, caught);
        throw caught;
      }
    },
  );
}

// A link row on the wire: both ends as the two optional identifiers the schema holds.
function eventLinkDetail(row: {
  readonly id: string;
  readonly kind: (typeof CALENDAR_EVENT_LINK_KINDS)[number];
  readonly from_matter_event_id: string | null;
  readonly from_firm_event_id: string | null;
  readonly to_matter_event_id: string | null;
  readonly to_firm_event_id: string | null;
  readonly note: string | null;
  readonly created_at: string;
}) {
  return {
    id: row.id,
    kind: row.kind,
    from: { matterEventId: row.from_matter_event_id, firmEventId: row.from_firm_event_id },
    to: { matterEventId: row.to_matter_event_id, firmEventId: row.to_firm_event_id },
    note: row.note,
    createdAt: row.created_at,
  };
}

// One end of a link from the wire's two optional columns: exactly one, or nothing.
function linkEndFrom(
  matterEventId: string | null | undefined,
  firmEventId: string | null | undefined,
): LinkEnd | undefined {
  const matter = matterEventId ?? null;
  const firm = firmEventId ?? null;
  if ((matter === null) === (firm === null)) return undefined;
  if (matter !== null) return { matterEventId: matter as MatterEventId };
  return { firmEventId: firm as FirmEventId };
}
