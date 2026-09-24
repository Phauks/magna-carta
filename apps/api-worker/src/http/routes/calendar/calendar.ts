import { CIVIL_DATE_PATTERN, civilDateOf, todayInUtc } from "@magna-carta/civil-time/civil-date";
import { WALL_CLOCK_TIME_PATTERN } from "@magna-carta/civil-time/wall-clock";
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
  WEEK_STARTS_ON_VALUES,
  readCalendarWeekStartsOn,
  writeCalendarWeekStartsOnStatement,
  type WeekStartsOn,
} from "@magna-carta/calendar/settings";
import { readMatterEventTypes } from "@magna-carta/calendar/event-type-statements";
import { encodeCursor } from "@magna-carta/data-access/cursor-pagination";
import { decodeTimelineCursor } from "@magna-carta/calendar/merge";
import { isOverdue, overdueCutoffFor, type OverdueCutoff } from "@magna-carta/calendar/overdue";
import { timelineSourceRegistry } from "@magna-carta/calendar/sources/all";
import { readTimelinePage } from "@magna-carta/calendar/timeline";
import {
  CALENDAR_SCOPES,
  FIRM_EVENT_AUDIENCES,
  FIRM_RESOURCE_KINDS,
  MATTER_DEADLINE_STATES,
  CALENDAR_EVENT_LINK_KINDS,
  MATTER_EVENT_CATEGORIES,
  MATTER_EVENT_PARTICIPANT_KINDS,
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
import {
  idempotencyKeyHeader,
  identifierField,
  identifierPathParam,
} from "../../contracts/common.ts";
import { capped, cursorQuery, paginated } from "../../contracts/pagination.ts";
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
const WALL_CLOCK_TIME = WALL_CLOCK_TIME_PATTERN;

// ---- request/response contracts ----

const ParticipantRequest = z
  .object({
    participantKind: z.enum(MATTER_EVENT_PARTICIPANT_KINDS),
    memberUserId: identifierField("user").nullable().optional(),
    // A directoryPerson_/directoryOrganization_ handle, carried by value.
    entityId: z.string().min(1).max(128).nullable().optional(),
    participantName: z.string().min(1).max(200).nullable().optional(),
    // A short label the firm supplies (appearing counsel, judge, court reporter). Free text and not
    // a platform vocabulary: what a participant is called varies by jurisdiction and nothing here
    // consumes it.
    role: z.string().max(120).nullable().optional(),
  })
  .openapi("MatterEventParticipantInput");

const CreateEventRequest = z
  .object({
    eventTypeId: identifierField("matterEventType").nullable().optional(),
    title: z.string().min(1).max(300),
    description: z.string().max(4000).nullable().optional(),
    status: z.enum(MATTER_EVENT_STATUSES).optional(),
    startsOn: z.string().regex(CIVIL_DATE),
    // Null or omitted means all day, which is what a filing is.
    startsAtTime: z.string().regex(WALL_CLOCK_TIME).nullable().optional(),
    endsOn: z.string().regex(CIVIL_DATE).nullable().optional(),
    endsAtTime: z.string().regex(WALL_CLOCK_TIME).nullable().optional(),
    // An IANA identifier — the zone the COURT sits in, which is frequently not the firm's own.
    timeZone: z.string().min(1).max(120),
    locationText: z.string().max(300).nullable().optional(),
    // Where an online setting is JOINED, whoever hosts it. Held as a URL rather than a provider and
    // a room number, because every conferencing service a firm might use expresses a meeting as a
    // link, and a schema naming providers would be a list this platform maintained on somebody
    // else's release schedule. A different fact from where it is HELD: a deposition can be in a
    // conference room AND on a call.
    conferenceUrl: z.string().url().max(2000).nullable().optional(),
    courtReference: z.string().max(120).nullable().optional(),
    /**
     * The RFC 5545 rule a repeating setting runs on — "FREQ=WEEKLY;BYDAY=TU;COUNT=12". Null or
     * absent for a setting that happens once. ONE record carries the whole series: a reader asking
     * for a window gets an entry per occurrence in it, rather than the platform writing a row per
     * date. The standard is stored rather than a private shape because it is what every calendar
     * product reads and writes, and a firm exporting its calendar should not find a dialect in it.
     * Only the rules the record form can present are accepted, so a rule that saves is one that can
     * be edited again.
     */
    recurrenceRule: z.string().max(400).nullable().optional(),
    participants: z.array(ParticipantRequest).max(50).optional(),
  })
  .openapi("CreateMatterEventRequest");

const UpdateEventRequest = CreateEventRequest.partial().openapi("UpdateMatterEventRequest");

const EventDetail = z
  .object({
    id: z.string(),
    matterId: z.string(),
    eventTypeId: z.string().nullable(),
    // The type's name beside its identifier, resolved by the read. Null when the event is
    // classified under nothing, or under a type row that has since gone.
    eventTypeName: z.string().nullable(),
    title: z.string(),
    description: z.string().nullable(),
    status: z.enum(MATTER_EVENT_STATUSES),
    // Why this setting is no longer happening, when it is not — set by cancellation and by a
    // continuance, null otherwise.
    statusReason: z.string().nullable(),
    startsOn: z.string(),
    startsAtTime: z.string().nullable(),
    endsOn: z.string().nullable(),
    endsAtTime: z.string().nullable(),
    timeZone: z.string(),
    locationText: z.string().nullable(),
    conferenceUrl: z.string().nullable(),
    courtReference: z.string().nullable(),
    /** The repeat rule as an RFC 5545 RRULE, null on a setting that happens once. */
    recurrenceRule: z.string().nullable(),
    recordedAt: z.string(),
    recordedBy: z.string().nullable(),
    // The immediate continuance neighbors, resolved from the link table in the same page's bounded
    // join — enough to badge "continued from Mar 14" without walking the chain.
    continuedFromEventId: z.string().nullable(),
    continuedToEventId: z.string().nullable(),
  })
  .openapi("MatterEventDetail");

const ParticipantDetail = z
  .object({
    id: z.string(),
    participantKind: z.enum(MATTER_EVENT_PARTICIPANT_KINDS),
    memberUserId: z.string().nullable(),
    entityId: z.string().nullable(),
    participantName: z.string().nullable(),
    role: z.string().nullable(),
  })
  .openapi("MatterEventParticipantDetail");

const CreateDeadlineRequest = z
  .object({
    title: z.string().min(1).max(300),
    dueOn: z.string().regex(CIVIL_DATE),
    // Real and load-bearing: many filing deadlines are five in the afternoon, and one whose hour
    // nobody recorded must not be rendered as midnight.
    dueAtTime: z.string().regex(WALL_CLOCK_TIME).nullable().optional(),
    timeZone: z.string().min(1).max(120),
    // `statutory_catalog` is refused: no verified jurisdiction-keyed catalog is encoded, and a
    // deadline claiming a catalog authority when none was consulted is the false confidence this
    // subsystem exists to avoid.
    source: z.enum(["member", "court_order"]).optional(),
    // The rule, statute, or order the firm says this comes from. Recorded, never parsed and never
    // resolved against anything.
    authorityText: z.string().max(2000).nullable().optional(),
    // The event that started the clock. A LINK and never an input to a calculation: moving it does
    // not move the deadline.
    triggerEventId: identifierField("matterEvent").nullable().optional(),
    priority: z.number().int().positive().max(9).nullable().optional(),
  })
  .openapi("CreateMatterDeadlineRequest");

const UpdateDeadlineRequest = CreateDeadlineRequest.omit({ source: true })
  .partial()
  .openapi("UpdateMatterDeadlineRequest");

const SatisfyDeadlineRequest = z
  .object({
    satisfyingEventId: identifierField("matterEvent").nullable().optional(),
    satisfactionNote: z.string().max(2000).nullable().optional(),
  })
  .openapi("SatisfyMatterDeadlineRequest");

const CloseDeadlineRequest = z
  .object({
    // Required: "why is this deadline no longer in force" is the question a person asks six months
    // later, and the only bad answer is silence.
    stateReason: z.string().min(1).max(2000),
    supersededByDeadlineId: identifierField("matterDeadline").nullable().optional(),
  })
  .openapi("CloseMatterDeadlineRequest");

const DeadlineDetail = z
  .object({
    id: z.string(),
    matterId: z.string(),
    title: z.string(),
    dueOn: z.string(),
    dueAtTime: z.string().nullable(),
    timeZone: z.string(),
    source: z.string(),
    authorityText: z.string().nullable(),
    triggerEventId: z.string().nullable(),
    state: z.enum(MATTER_DEADLINE_STATES),
    satisfiedAt: z.string().nullable(),
    satisfiedBy: z.string().nullable(),
    satisfyingEventId: z.string().nullable(),
    stateReason: z.string().nullable(),
    priority: z.number().int().nullable(),
    // DERIVED at read time by resolving the due date and time in the deadline's own zone and
    // comparing against now. There is no such column: nothing in this platform writes that a firm
    // missed something.
    overdue: z.boolean(),
  })
  .openapi("MatterDeadlineDetail");

const TimelineEntryResponse = z
  .object({
    sourceKey: z.string(),
    kind: z.string(),
    sortKey: z.string(),
    rowId: z.string(),
    matterId: z.string().nullable(),
    actorUserId: z.string().nullable(),
    // The source's DECLARED non-privileged summary, or null where the source declares it has none.
    // Never a title, a subject line, a narrative, or a person's name — detail comes from following
    // the link into the owning subsystem's own access-gated read.
    label: z.string().nullable(),
    link: z.string(),
    // THE HOUR, where the row has one: `HH:MM` read in `timeZone`, the zone the record itself
    // names, never converted. It is the same class of fact as `sortKey` — when a thing happens,
    // said in the record's own terms — and carries nothing about a case, which is what lets a day
    // grid place a hearing at ten o'clock without the projection ever naming it. Null where the
    // row has no hour, which is what a filing due on a day is.
    timeOfDay: z.string().nullable(),
    timeZone: z.string().nullable(),
    // THE DESCRIPTION, on the matter's own timeline only. Each source names its rows for the one
    // matter in scope through its own describe statement, behind its own read capability: the
    // title a reader recognises the row by, the subsystem's own word for what it is, and that
    // subsystem's own facts as an object its own presentation reads. Null on any entry whose
    // source declares no describe, whose permission the member lacks, or on a read that is not
    // scoped to one matter — the firm-wide calendar is never described.
    title: z.string().nullable(),
    typeText: z.string().nullable(),
    facts: z.record(z.string(), z.unknown()).nullable(),
  })
  .openapi("TimelineEntry");

const EventTypeDetail = z
  .object({
    id: z.string(),
    name: z.string(),
    code: z.string().nullable(),
    category: z.enum(MATTER_EVENT_CATEGORIES),
    origin: z.enum(["platform", "firm"]),
    active: z.boolean(),
  })
  .openapi("MatterEventTypeDetail");

// ---- the firm's calendar settings ----

// 0 is Sunday and 1 is Monday: the two starts practice actually uses, and a closed vocabulary so a
// grid never has to draw a week that begins on a Wednesday. The value is a firm setting rather than a
// personal preference, because two members of one firm looking at the same week must see the same
// seven days.
const WeekStartsOnValue = z
  .union([z.literal(WEEK_STARTS_ON_VALUES[0]), z.literal(WEEK_STARTS_ON_VALUES[1])])
  .openapi("CalendarWeekStartsOn");

const CalendarSettingsResponse = z
  .object({ weekStartsOn: WeekStartsOnValue })
  .openapi("CalendarSettingsResponse");

const PatchCalendarSettingsRequest = z
  .object({
    // Sparse: a field absent is unchanged, and an empty patch writes nothing and audits nothing.
    weekStartsOn: WeekStartsOnValue.optional(),
  })
  .openapi("PatchCalendarSettingsRequest");

const CreateEventTypeRequest = z
  .object({
    name: z.string().min(1).max(120),
    code: z.string().min(1).max(40).nullable().optional(),
    category: z.enum(MATTER_EVENT_CATEGORIES).optional(),
  })
  .openapi("CreateMatterEventTypeRequest");

const UpdateEventTypeRequest = CreateEventTypeRequest.partial().openapi(
  "UpdateMatterEventTypeRequest",
);

const CreatedResponse = z.object({ id: z.string() }).openapi("CalendarCreatedResponse");
const AcknowledgedResponse = z.object({ ok: z.literal(true) }).openapi("CalendarAckResponse");

// ---- firm events ----

const CreateFirmEventRequest = z
  .object({
    eventTypeId: identifierField("matterEventType").nullable().optional(),
    title: z.string().min(1).max(300),
    description: z.string().max(4000).nullable().optional(),
    status: z.enum(MATTER_EVENT_STATUSES).optional(),
    startsOn: z.string().regex(CIVIL_DATE),
    startsAtTime: z.string().regex(WALL_CLOCK_TIME).nullable().optional(),
    endsOn: z.string().regex(CIVIL_DATE).nullable().optional(),
    endsAtTime: z.string().regex(WALL_CLOCK_TIME).nullable().optional(),
    timeZone: z.string().min(1).max(120),
    // all_members puts the entry on every member's calendar without enumerating anybody; a
    // participants event is on the calendars of the people listed. Defaults to participants.
    audience: z.enum(FIRM_EVENT_AUDIENCES).optional(),
    locationId: identifierField("location").nullable().optional(),
    locationText: z.string().max(300).nullable().optional(),
    // Where an online setting is JOINED, whoever hosts it. Held as a URL rather than a provider and
    // a room number, because every conferencing service a firm might use expresses a meeting as a
    // link, and a schema naming providers would be a list this platform maintained on somebody
    // else's release schedule. A different fact from where it is HELD: a deposition can be in a
    // conference room AND on a call.
    conferenceUrl: z.string().url().max(2000).nullable().optional(),
    /**
     * The RFC 5545 rule a repeating event runs on, null or absent for one that happens once. One
     * record carries the whole series; only the rules the record form can present are accepted.
     */
    recurrenceRule: z.string().max(400).nullable().optional(),
    participants: z.array(ParticipantRequest).max(50).optional(),
  })
  .openapi("CreateFirmEventRequest");

const UpdateFirmEventRequest = CreateFirmEventRequest.partial().openapi("UpdateFirmEventRequest");

const CancelEventRequest = z
  .object({
    // Optional on a firm event (a cancelled staff meeting does not always deserve a paragraph) and
    // on a matter event alike; the continuance path sets its own.
    statusReason: z.string().max(2000).nullable().optional(),
  })
  .openapi("CancelEventRequest");

const FirmEventDetail = z
  .object({
    id: z.string(),
    eventTypeId: z.string().nullable(),
    title: z.string(),
    description: z.string().nullable(),
    status: z.enum(MATTER_EVENT_STATUSES),
    statusReason: z.string().nullable(),
    startsOn: z.string(),
    startsAtTime: z.string().nullable(),
    endsOn: z.string().nullable(),
    endsAtTime: z.string().nullable(),
    timeZone: z.string(),
    audience: z.enum(FIRM_EVENT_AUDIENCES),
    locationId: z.string().nullable(),
    locationText: z.string().nullable(),
    conferenceUrl: z.string().nullable(),
    /** The repeat rule as an RFC 5545 RRULE, null on an event that happens once. */
    recurrenceRule: z.string().nullable(),
    recordedAt: z.string(),
    recordedBy: z.string().nullable(),
  })
  .openapi("FirmEventDetail");

const firmEventsQuery = cursorQuery.extend({
  // Required and capped, exactly as the firm calendar's window is: a wider window is refused, never
  // silently narrowed.
  from: z.string().regex(CIVIL_DATE),
  to: z.string().regex(CIVIL_DATE),
  status: z.enum(MATTER_EVENT_STATUSES).optional(),
  eventTypeId: identifierField("matterEventType").optional(),
});

// ---- resources and bookings ----

const CreateResourceRequest = z
  .object({
    name: z.string().min(1).max(200),
    kind: z.enum(FIRM_RESOURCE_KINDS),
    locationId: identifierField("location").nullable().optional(),
    // Rendered on the picker so a person can decide; nothing enforces it — the platform does not
    // refuse a twelve-person meeting in a ten-seat room.
    capacity: z.number().int().positive().max(100000).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .openapi("CreateFirmResourceRequest");

const UpdateResourceRequest = CreateResourceRequest.partial()
  .extend({
    // Soft-deactivate: a retired room keeps its history and takes no new bookings.
    active: z.boolean().optional(),
  })
  .openapi("UpdateFirmResourceRequest");

const ResourceDetail = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(FIRM_RESOURCE_KINDS),
    locationId: z.string().nullable(),
    capacity: z.number().int().nullable(),
    notes: z.string().nullable(),
    active: z.boolean(),
  })
  .openapi("FirmResourceDetail");

const resourcesQuery = z.object({
  kind: z.enum(FIRM_RESOURCE_KINDS).optional(),
  locationId: identifierField("location").optional(),
  includeInactive: z.enum(["true", "false"]).optional(),
});

const BookingConflictDetail = z
  .object({
    bookingId: z.string(),
    startsOn: z.string(),
    startsAtTime: z.string().nullable(),
    endsOn: z.string().nullable(),
    endsAtTime: z.string().nullable(),
    timeZone: z.string(),
    eventKind: z.enum(["matterEvent", "firmEvent"]),
    eventId: z.string(),
    // The deep link into the owning read, behind its own access gate; a filtered target is a 404.
    link: z.string(),
  })
  .openapi("BookingConflict");

const CreateBookingRequest = z
  .object({
    resourceId: identifierField("firmResource"),
    // Exactly one of the two: a booking is never freestanding — "book the pool car Friday" is a
    // Reservation-type firm event with the booking attached.
    matterEventId: identifierField("matterEvent").nullable().optional(),
    firmEventId: identifierField("firmEvent").nullable().optional(),
    // Defaulted from the event where omitted; editable per booking, because the room is booked from
    // half past eight for a nine o'clock deposition.
    startsOn: z.string().regex(CIVIL_DATE).optional(),
    startsAtTime: z.string().regex(WALL_CLOCK_TIME).nullable().optional(),
    endsOn: z.string().regex(CIVIL_DATE).nullable().optional(),
    endsAtTime: z.string().regex(WALL_CLOCK_TIME).nullable().optional(),
    // The explicit-override path; where omitted, the zone freezes from the resource's office.
    timeZone: z.string().min(1).max(120).optional(),
  })
  .openapi("CreateBookingRequest");

const UpdateBookingRequest = z
  .object({
    startsOn: z.string().regex(CIVIL_DATE).optional(),
    startsAtTime: z.string().regex(WALL_CLOCK_TIME).nullable().optional(),
    endsOn: z.string().regex(CIVIL_DATE).nullable().optional(),
    endsAtTime: z.string().regex(WALL_CLOCK_TIME).nullable().optional(),
    timeZone: z.string().min(1).max(120).optional(),
  })
  .openapi("UpdateBookingRequest");

const BookingCreatedResponse = z
  .object({ id: z.string(), conflicts: z.array(BookingConflictDetail) })
  .openapi("BookingCreatedResponse");

const BookingUpdatedResponse = z
  .object({ ok: z.literal(true), conflicts: z.array(BookingConflictDetail) })
  .openapi("BookingUpdatedResponse");

const AvailabilityEntryDetail = z
  .object({
    bookingId: z.string(),
    startsOn: z.string(),
    startsAtTime: z.string().nullable(),
    endsOn: z.string().nullable(),
    endsAtTime: z.string().nullable(),
    timeZone: z.string(),
    eventKind: z.enum(["matterEvent", "firmEvent"]),
    eventId: z.string(),
    // The catalog term ("Deposition"), never the event's title — a room's schedule spans every
    // matter, so the grid renders windows and kinds and the detail lives behind the deep link.
    eventTypeName: z.string().nullable(),
    link: z.string(),
    // Pre-paired overlaps, so the grid paints conflicts without a second request.
    overlappingBookingIds: z.array(z.string()),
  })
  .openapi("ResourceAvailabilityEntry");

const availabilityQuery = z.object({
  from: z.string().regex(CIVIL_DATE),
  to: z.string().regex(CIVIL_DATE),
});

// The bookings ONE event holds, as its window lists them: the resource and the booked span. A
// handful by construction (a room, a car, a projector), so un-paged. The resource's name is the
// catalog's to give, and the surface already holds the catalog.
const EventBooking = z
  .object({
    id: z.string(),
    resourceId: z.string(),
    startsOn: z.string(),
    startsAtTime: z.string().nullable(),
    endsOn: z.string().nullable(),
    endsAtTime: z.string().nullable(),
    timeZone: z.string(),
  })
  .openapi("EventBooking");

const EventBookings = z.object({ data: z.array(EventBooking) }).openapi("EventBookings");

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

// ---- event links and continuance ----

const CreateEventLinkRequest = z
  .object({
    // Exactly one column per end, the schema's shape restated on the wire.
    fromMatterEventId: identifierField("matterEvent").nullable().optional(),
    fromFirmEventId: identifierField("firmEvent").nullable().optional(),
    toMatterEventId: identifierField("matterEvent").nullable().optional(),
    toFirmEventId: identifierField("firmEvent").nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .openapi("CreateEventLinkRequest");

const ContinueEventRequest = z
  .object({
    // The new setting, as the court made it. Every date here is one a person supplied: nothing
    // computes a date from another date.
    startsOn: z.string().regex(CIVIL_DATE),
    startsAtTime: z.string().regex(WALL_CLOCK_TIME).nullable().optional(),
    endsOn: z.string().regex(CIVIL_DATE).nullable().optional(),
    endsAtTime: z.string().regex(WALL_CLOCK_TIME).nullable().optional(),
    timeZone: z.string().min(1).max(120).optional(),
    locationText: z.string().max(300).nullable().optional(),
    conferenceUrl: z.string().url().max(2000).nullable().optional(),
    courtReference: z.string().max(120).nullable().optional(),
    // Why the old setting is not happening ("Continued on defendant's motion").
    statusReason: z.string().max(2000).nullable().optional(),
  })
  .openapi("ContinueMatterEventRequest");

const ContinuanceDeadlineReference = z
  .object({
    id: z.string(),
    title: z.string(),
    dueOn: z.string(),
    dueAtTime: z.string().nullable(),
    timeZone: z.string(),
    state: z.enum(MATTER_DEADLINE_STATES),
  })
  .openapi("ContinuanceDeadlineReference");

const ContinueEventResponse = z
  .object({
    newEventId: z.string(),
    oldEventId: z.string(),
    // Purely informational, in the person's hand while they hold the order: the open deadlines
    // whose trigger named the continued setting (a lookup — nothing moved, because what a
    // continuance does to a briefing schedule is a legal judgement), and the bookings the status
    // change just released by derivation.
    triggerLinkedOpenDeadlines: z.array(ContinuanceDeadlineReference),
    releasedBookings: z.array(BookingConflictDetail),
  })
  .openapi("ContinueMatterEventResponse");

const ContinuanceChainNodeDetail = z
  .object({
    eventId: z.string(),
    startsOn: z.string(),
    startsAtTime: z.string().nullable(),
    timeZone: z.string(),
    status: z.string(),
    statusReason: z.string().nullable(),
  })
  .openapi("ContinuanceChainNode");

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
function calendarReadErrorResponse(
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

function readMeta(action: string, resource: RouteMeta["resource"]): RouteMeta {
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

function mutationMeta(action: string, resource: RouteMeta["resource"]): RouteMeta {
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
          schema: paginated(TimelineEntryResponse).openapi("TimelineEntryPage"),
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
        "application/json": { schema: paginated(EventDetail).openapi("MatterEventPage") },
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
          schema: z
            .object({ event: EventDetail, participants: z.array(ParticipantDetail) })
            .openapi("MatterEventWithParticipants"),
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
          schema: paginated(TimelineEntryResponse).openapi("FirmCalendarPage"),
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
        "application/json": { schema: paginated(DeadlineDetail).openapi("MatterDeadlinePage") },
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
          schema: z.object({ data: z.array(EventTypeDetail) }).openapi("MatterEventTypeList"),
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
    "and is the one the event happens in, which for a hearing is the court's and not the firm's.",
  request: {
    headers: idempotencyKeyHeader,
    params: matterIdParam,
    body: { content: { "application/json": { schema: CreateEventRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The recorded event",
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

const updateEventRoute = defineOpenAPIRoute(mutationMeta("updateEvent", "matter"), {
  method: "patch",
  path: "/api/v1/events/{eventId}",
  description:
    "Edits a recorded event in place. A hearing continued to a new date is the same hearing on a " +
    "new date: the record moves and the audit trail carries the move, rather than leaving two " +
    "hearings on the calendar for every reader to work out which one counts. Supplying participants " +
    "replaces the whole list; omitting them leaves it alone.",
  request: {
    headers: idempotencyKeyHeader,
    params: eventIdParam,
    body: { content: { "application/json": { schema: UpdateEventRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The event was updated",
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

const cancelEventRoute = defineOpenAPIRoute(mutationMeta("cancelEvent", "matter"), {
  method: "post",
  path: "/api/v1/events/{eventId}/cancel",
  description:
    "Marks an event cancelled, with an optional reason the record keeps. The record stays: a " +
    "hearing that was taken off is a fact about the case, and a firm that has to show it was " +
    "vacated cannot do that from a row that is gone. A hearing the court moved is continued, not " +
    "cancelled — the continue operation records both settings.",
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
        "application/json": { schema: paginated(FirmEventDetail).openapi("FirmEventPage") },
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
          schema: z
            .object({ event: FirmEventDetail, participants: z.array(ParticipantDetail) })
            .openapi("FirmEventWithParticipants"),
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
    "calendars of the people named.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateFirmEventRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The recorded firm event",
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

const updateFirmEventRoute = defineOpenAPIRoute(mutationMeta("updateFirmEvent", "firm"), {
  method: "patch",
  path: "/api/v1/firm-events/{firmEventId}",
  description:
    "Edits a firm event in place. A moved staff meeting is not procedural history — firm events " +
    "keep simple edit semantics, and the audit trail carries the move. Supplying participants " +
    "replaces the whole list; omitting them leaves it alone.",
  request: {
    headers: idempotencyKeyHeader,
    params: firmEventIdParam,
    body: { content: { "application/json": { schema: UpdateFirmEventRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The firm event was updated",
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

const cancelFirmEventRoute = defineOpenAPIRoute(mutationMeta("cancelFirmEvent", "firm"), {
  method: "post",
  path: "/api/v1/firm-events/{firmEventId}/cancel",
  description:
    "Marks a firm event cancelled, with an optional reason. The record stays, and any room or " +
    "vehicle booked for it frees itself: a booking blocks a resource only while its event is live, " +
    "so cancelling releases the bookings with nothing further to do.",
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
          schema: capped(ResourceDetail).openapi("FirmResourceList"),
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
          schema: z
            .object({ data: z.array(AvailabilityEntryDetail) })
            .openapi("ResourceAvailability"),
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

// One end of a link on the wire: exactly one of the two, the schema's own shape restated.
const EventLinkEnd = z
  .object({
    matterEventId: z.string().nullable(),
    firmEventId: z.string().nullable(),
  })
  .openapi("CalendarEventLinkEnd");

const EventLinkDetail = z
  .object({
    id: z.string(),
    kind: z.enum(CALENDAR_EVENT_LINK_KINDS),
    from: EventLinkEnd,
    to: EventLinkEnd,
    note: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("CalendarEventLinkDetail");

const EventLinks = z.object({ data: z.array(EventLinkDetail) }).openapi("CalendarEventLinks");

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
          schema: z
            .object({ data: z.array(ContinuanceChainNodeDetail) })
            .openapi("ContinuanceChain"),
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

type CalendarApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

function serviceOptions(userId: string) {
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
async function commitCalendarEffect(
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
      const outcome = await commitCalendarEffect(c, firm.firmDatabase, idempotency, 201, () => {
        const created = createMatterEvent(
          firm.firmDatabase,
          { ...request, matterId, participants: request.participants },
          serviceOptions(userId),
        );
        return Promise.resolve({ id: created.eventId, effect: created.effect });
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id }, 201);
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
      const outcome = await commitCalendarEffect(
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
          return { id: eventId, effect };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
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
      const outcome = await commitCalendarEffect(
        c,
        firm.firmDatabase,
        idempotency,
        200,
        async () => {
          const { effect } = await cancelMatterEvent(
            firm.firmDatabase,
            eventId as MatterEventId,
            serviceOptions(userId),
            request?.statusReason ?? null,
          );
          return { id: eventId, effect };
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
      const outcome = await commitCalendarEffect(
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
          return { id: created.firmEventId, effect: created.effect };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id }, 201);
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
      const outcome = await commitCalendarEffect(
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
          return { id: firmEventId, effect };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
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
      const outcome = await commitCalendarEffect(
        c,
        firm.firmDatabase,
        idempotency,
        200,
        async () => {
          const { effect } = await cancelFirmEvent(
            firm.firmDatabase,
            firmEventId as FirmEventId,
            serviceOptions(userId),
            request?.statusReason ?? null,
          );
          return { id: firmEventId, effect };
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
