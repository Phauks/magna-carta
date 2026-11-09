import { z } from "zod";
import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { WALL_CLOCK_TIME_PATTERN } from "@magna-carta/civil-time/wall-clock";
import { capped, paginated } from "@magna-carta/data-access/pagination-contract";
import { identifierField } from "@magna-carta/identifiers/field";
import { WEEK_STARTS_ON_VALUES } from "./settings.ts";
import {
  CALENDAR_EVENT_LINK_KINDS,
  FIRM_EVENT_AUDIENCES,
  FIRM_RESOURCE_KINDS,
  MATTER_DEADLINE_STATES,
  MATTER_EVENT_CATEGORIES,
  MATTER_EVENT_PARTICIPANT_KINDS,
  MATTER_EVENT_STATUSES,
} from "./types.ts";

// The calendar's contract: what its API accepts in a request body and returns in a response, as
// plain zod. Each component is named with zod's own metadata (`.meta({ id })`), which the contract
// emitter reads as the component's name — so the shape and its name live together here, and the route
// module in apps/api-worker declares routes over these without restating one field. Path and query
// parameters stay with the routes: they are addressing, not domain shape. The rule and its reasoning
// are in docs/conventions/api.md (_Where a contract shape lives_).
//
// Two things this surface never does, and they are the subsystem's whole position. It never computes
// a deadline date from a court rule — every date here is one a person supplied. And it never writes
// "missed": whether a deadline is overdue is a comparison against now, made when a page is read.

const CIVIL_DATE = CIVIL_DATE_PATTERN;
const WALL_CLOCK_TIME = WALL_CLOCK_TIME_PATTERN;

export const ParticipantRequest = z
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
  .meta({ id: "MatterEventParticipantInput" });

// What a matter event is recorded with. A FIELD SET rather than a named shape because the two event
// writes carry one more field this package cannot describe: the meeting a member may open on the
// event, whose vocabularies belong to @magna-carta/meetings, which already depends on this package.
// The route composes the request at the one place both packages are in scope, so every field the
// calendar owns is still defined here and nowhere else.
export const matterEventRequestFields = {
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
};

export const EventDetail = z
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
  .meta({ id: "MatterEventDetail" });

export const ParticipantDetail = z
  .object({
    id: z.string(),
    participantKind: z.enum(MATTER_EVENT_PARTICIPANT_KINDS),
    memberUserId: z.string().nullable(),
    entityId: z.string().nullable(),
    participantName: z.string().nullable(),
    role: z.string().nullable(),
  })
  .meta({ id: "MatterEventParticipantDetail" });

export const CreateDeadlineRequest = z
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
  .meta({ id: "CreateMatterDeadlineRequest" });

export const UpdateDeadlineRequest = CreateDeadlineRequest.omit({ source: true })
  .partial()
  .meta({ id: "UpdateMatterDeadlineRequest" });

export const SatisfyDeadlineRequest = z
  .object({
    satisfyingEventId: identifierField("matterEvent").nullable().optional(),
    satisfactionNote: z.string().max(2000).nullable().optional(),
  })
  .meta({ id: "SatisfyMatterDeadlineRequest" });

export const CloseDeadlineRequest = z
  .object({
    // Required: "why is this deadline no longer in force" is the question a person asks six months
    // later, and the only bad answer is silence.
    stateReason: z.string().min(1).max(2000),
    supersededByDeadlineId: identifierField("matterDeadline").nullable().optional(),
  })
  .meta({ id: "CloseMatterDeadlineRequest" });

export const DeadlineDetail = z
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
  .meta({ id: "MatterDeadlineDetail" });

export const TimelineEntryResponse = z
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
  .meta({ id: "TimelineEntry" });

export const EventTypeDetail = z
  .object({
    id: z.string(),
    name: z.string(),
    code: z.string().nullable(),
    category: z.enum(MATTER_EVENT_CATEGORIES),
    origin: z.enum(["platform", "firm"]),
    active: z.boolean(),
  })
  .meta({ id: "MatterEventTypeDetail" });

// 0 is Sunday and 1 is Monday: the two starts practice actually uses, and a closed vocabulary so a
// grid never has to draw a week that begins on a Wednesday. The value is a firm setting rather than a
// personal preference, because two members of one firm looking at the same week must see the same
// seven days.
export const WeekStartsOnValue = z
  .union([z.literal(WEEK_STARTS_ON_VALUES[0]), z.literal(WEEK_STARTS_ON_VALUES[1])])
  .meta({ id: "CalendarWeekStartsOn" });

export const CalendarSettingsResponse = z
  .object({ weekStartsOn: WeekStartsOnValue })
  .meta({ id: "CalendarSettingsResponse" });

export const PatchCalendarSettingsRequest = z
  .object({
    // Sparse: a field absent is unchanged, and an empty patch writes nothing and audits nothing.
    weekStartsOn: WeekStartsOnValue.optional(),
  })
  .meta({ id: "PatchCalendarSettingsRequest" });

export const CreateEventTypeRequest = z
  .object({
    name: z.string().min(1).max(120),
    code: z.string().min(1).max(40).nullable().optional(),
    category: z.enum(MATTER_EVENT_CATEGORIES).optional(),
  })
  .meta({ id: "CreateMatterEventTypeRequest" });

export const UpdateEventTypeRequest = CreateEventTypeRequest.partial().meta({
  id: "UpdateMatterEventTypeRequest",
});

export const CreatedResponse = z.object({ id: z.string() }).meta({ id: "CalendarCreatedResponse" });

export const AcknowledgedResponse = z
  .object({ ok: z.literal(true) })
  .meta({ id: "CalendarAckResponse" });

// The two event creates answer with the meeting as well, because the caller that asked for one has
// to be able to open it without a second round trip to find out what it got. Null where the event
// carries no meeting, which is almost every event — an absent field would make "no meeting" and "an
// older server" the same answer.
export const EventRecordedResponse = z
  .object({ id: z.string(), meetingId: z.string().nullable() })
  .meta({ id: "CalendarEventRecordedResponse" });

export const EventUpdatedResponse = z
  .object({ ok: z.literal(true), meetingId: z.string().nullable() })
  .meta({ id: "CalendarEventUpdatedResponse" });

// What a firm event is recorded with — a field set for the reason the matter event's is.
export const firmEventRequestFields = {
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
};

export const CancelEventRequest = z
  .object({
    // Optional on a firm event (a cancelled staff meeting does not always deserve a paragraph) and
    // on a matter event alike; the continuance path sets its own.
    statusReason: z.string().max(2000).nullable().optional(),
  })
  .meta({ id: "CancelEventRequest" });

export const FirmEventDetail = z
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
  .meta({ id: "FirmEventDetail" });

export const CreateResourceRequest = z
  .object({
    name: z.string().min(1).max(200),
    kind: z.enum(FIRM_RESOURCE_KINDS),
    locationId: identifierField("location").nullable().optional(),
    // Rendered on the picker so a person can decide; nothing enforces it — the platform does not
    // refuse a twelve-person meeting in a ten-seat room.
    capacity: z.number().int().positive().max(100000).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .meta({ id: "CreateFirmResourceRequest" });

export const UpdateResourceRequest = CreateResourceRequest.partial()
  .extend({
    // Soft-deactivate: a retired room keeps its history and takes no new bookings.
    active: z.boolean().optional(),
  })
  .meta({ id: "UpdateFirmResourceRequest" });

export const ResourceDetail = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(FIRM_RESOURCE_KINDS),
    locationId: z.string().nullable(),
    capacity: z.number().int().nullable(),
    notes: z.string().nullable(),
    active: z.boolean(),
  })
  .meta({ id: "FirmResourceDetail" });

export const BookingConflictDetail = z
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
  .meta({ id: "BookingConflict" });

export const CreateBookingRequest = z
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
  .meta({ id: "CreateBookingRequest" });

export const UpdateBookingRequest = z
  .object({
    startsOn: z.string().regex(CIVIL_DATE).optional(),
    startsAtTime: z.string().regex(WALL_CLOCK_TIME).nullable().optional(),
    endsOn: z.string().regex(CIVIL_DATE).nullable().optional(),
    endsAtTime: z.string().regex(WALL_CLOCK_TIME).nullable().optional(),
    timeZone: z.string().min(1).max(120).optional(),
  })
  .meta({ id: "UpdateBookingRequest" });

export const BookingCreatedResponse = z
  .object({ id: z.string(), conflicts: z.array(BookingConflictDetail) })
  .meta({ id: "BookingCreatedResponse" });

export const BookingUpdatedResponse = z
  .object({ ok: z.literal(true), conflicts: z.array(BookingConflictDetail) })
  .meta({ id: "BookingUpdatedResponse" });

export const AvailabilityEntryDetail = z
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
  .meta({ id: "ResourceAvailabilityEntry" });

// The bookings ONE event holds, as its window lists them: the resource and the booked span. A
// handful by construction (a room, a car, a projector), so un-paged. The resource's name is the
// catalog's to give, and the surface already holds the catalog.
export const EventBooking = z
  .object({
    id: z.string(),
    resourceId: z.string(),
    startsOn: z.string(),
    startsAtTime: z.string().nullable(),
    endsOn: z.string().nullable(),
    endsAtTime: z.string().nullable(),
    timeZone: z.string(),
  })
  .meta({ id: "EventBooking" });

export const EventBookings = z
  .object({ data: z.array(EventBooking) })
  .meta({ id: "EventBookings" });

export const CreateEventLinkRequest = z
  .object({
    // Exactly one column per end, the schema's shape restated on the wire.
    fromMatterEventId: identifierField("matterEvent").nullable().optional(),
    fromFirmEventId: identifierField("firmEvent").nullable().optional(),
    toMatterEventId: identifierField("matterEvent").nullable().optional(),
    toFirmEventId: identifierField("firmEvent").nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .meta({ id: "CreateEventLinkRequest" });

export const ContinueEventRequest = z
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
  .meta({ id: "ContinueMatterEventRequest" });

export const ContinuanceDeadlineReference = z
  .object({
    id: z.string(),
    title: z.string(),
    dueOn: z.string(),
    dueAtTime: z.string().nullable(),
    timeZone: z.string(),
    state: z.enum(MATTER_DEADLINE_STATES),
  })
  .meta({ id: "ContinuanceDeadlineReference" });

export const ContinueEventResponse = z
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
  .meta({ id: "ContinueMatterEventResponse" });

export const ContinuanceChainNodeDetail = z
  .object({
    eventId: z.string(),
    startsOn: z.string(),
    startsAtTime: z.string().nullable(),
    timeZone: z.string(),
    status: z.string(),
    statusReason: z.string().nullable(),
  })
  .meta({ id: "ContinuanceChainNode" });

// One end of a link on the wire: exactly one of the two, the schema's own shape restated.
export const EventLinkEnd = z
  .object({
    matterEventId: z.string().nullable(),
    firmEventId: z.string().nullable(),
  })
  .meta({ id: "CalendarEventLinkEnd" });

export const EventLinkDetail = z
  .object({
    id: z.string(),
    kind: z.enum(CALENDAR_EVENT_LINK_KINDS),
    from: EventLinkEnd,
    to: EventLinkEnd,
    note: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: "CalendarEventLinkDetail" });

export const EventLinks = z
  .object({ data: z.array(EventLinkDetail) })
  .meta({ id: "CalendarEventLinks" });

// ---- the envelopes the routes answer with, named here so the route declares a name, not a shape ----

export const TimelineEntryPage = paginated(TimelineEntryResponse).meta({ id: "TimelineEntryPage" });
export const MatterEventPage = paginated(EventDetail).meta({ id: "MatterEventPage" });
export const MatterEventWithParticipants = z
  .object({ event: EventDetail, participants: z.array(ParticipantDetail) })
  .meta({ id: "MatterEventWithParticipants" });
export const FirmCalendarPage = paginated(TimelineEntryResponse).meta({ id: "FirmCalendarPage" });
export const MatterDeadlinePage = paginated(DeadlineDetail).meta({ id: "MatterDeadlinePage" });
export const MatterEventTypeList = z
  .object({ data: z.array(EventTypeDetail) })
  .meta({ id: "MatterEventTypeList" });
export const FirmEventPage = paginated(FirmEventDetail).meta({ id: "FirmEventPage" });
export const FirmEventWithParticipants = z
  .object({ event: FirmEventDetail, participants: z.array(ParticipantDetail) })
  .meta({ id: "FirmEventWithParticipants" });
export const FirmResourceList = capped(ResourceDetail).meta({ id: "FirmResourceList" });
export const ResourceAvailability = z
  .object({ data: z.array(AvailabilityEntryDetail) })
  .meta({ id: "ResourceAvailability" });
export const ContinuanceChain = z
  .object({ data: z.array(ContinuanceChainNodeDetail) })
  .meta({ id: "ContinuanceChain" });
