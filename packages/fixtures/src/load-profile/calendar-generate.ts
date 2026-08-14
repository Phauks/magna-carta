import { createFirmResourceBooking } from "@magna-carta/calendar/booking-service";
import { continueMatterEvent } from "@magna-carta/calendar/continuance-service";
import { closeMatterDeadline, createMatterDeadline } from "@magna-carta/calendar/deadline-service";
import { createMatterEvent } from "@magna-carta/calendar/event-service";
import { createFirmEvent } from "@magna-carta/calendar/firm-event-service";
import { createFirmResource } from "@magna-carta/calendar/resource-service";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type {
  FirmEventId,
  FirmResourceId,
  LocationId,
  MatterDeadlineId,
  MatterEventId,
  MatterEventTypeId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { FixtureContext } from "../context.ts";
import { assertSeedingAllowed, type SeedingOptions } from "../guard.ts";
import type { CalendarVolume } from "./profile.ts";

// The calendar volume laid over everything the other generators produced. Every row rides a REAL
// write path — createMatterEvent, createMatterDeadline, createFirmEvent, createFirmResource,
// createFirmResourceBooking, continueMatterEvent — so the corpus obeys the rules the subsystem
// enforces: no date is computed from another, a booking hangs off exactly one event, a continued
// hearing keeps its old row byte-untouched behind one `continuance_of` link, and every deadline's
// state is a state a person put it in.
//
// What this generator is really building is a FEDERATED read's worst case. A matter timeline unions
// the calendar's own two tables with a dozen sources other generators already filled, so the depth
// that matters is concentrated on ONE probe matter — the matter the practice, timekeeping, costs, and
// document generators already made busiest — which is what the design means by "one matter
// deliberately deep in every federated source at once".

const MILLISECONDS_PER_DAY = 86_400_000;

// The seeded platform catalogue rows, by category. A litigation event takes a litigation type and a
// firm event takes a firm-category one; the write path refuses the cross, which is the whole reason
// the two lists are separate here rather than one pool.
const LITIGATION_EVENT_TYPE_IDS = [
  "matterEventType_hearing00000000000000",
  "matterEventType_deposition00000000000",
  "matterEventType_statusConference00000",
  "matterEventType_settlementConference0",
  "matterEventType_filing000000000000000",
  "matterEventType_mediation000000000000",
] as unknown as readonly MatterEventTypeId[];

const FIRM_EVENT_TYPE_IDS = [
  "matterEventType_clientMeeting00000000",
  "matterEventType_siteVisit000000000000",
  "matterEventType_call00000000000000000",
] as unknown as readonly MatterEventTypeId[];

// One zone for the whole fixture firm. The zone is a per-row fact in production precisely because a
// firm appears in courts outside its own, but varying it here would only vary the arithmetic in
// time-zone.ts, which is not what these measurements are about.
const FIXTURE_TIME_ZONE = "America/Los_Angeles";

const RESOURCE_KINDS = ["room", "vehicle", "equipment", "other"] as const;

export interface CalendarProbes {
  // The matter whose timeline is deep in every source at once — the page-1-versus-page-20 target.
  readonly deepTimelineMatterId: MatterId;
  // A second matter with an ordinary timeline, so a shallow read is measured beside the deep one.
  readonly shallowTimelineMatterId: MatterId;
  // The member the participant-filtered reads resolve through.
  readonly memberUserId: UserId;
  // The resource carrying the most bookings — the availability read's hot case.
  readonly busiestResourceId: FirmResourceId;
  // The window the availability and overlap reads are taken over (a month at the dense recent end).
  readonly availabilityFromDate: string;
  readonly availabilityToDate: string;
  // The firm-wide 31-day window the federated read's weakest case is measured over.
  readonly firmWindowFromDate: string;
  readonly firmWindowToDate: string;
  // Any node of the continuance chain — the chain read walks both directions from wherever it starts,
  // so the middle is the honest probe.
  readonly continuanceChainEventId: MatterEventId;
  // An open deadline already past its due date, so the read-time overdue comparison has a subject.
  readonly overdueDeadlineId: MatterDeadlineId;
  // The zone every booking in this corpus was frozen with. The overlap check resolves a candidate
  // window through a zone, so the candidate has to carry the same one the stored rows do or the
  // intersection would be measured against windows an hour off.
  readonly bookingTimeZone: string;
  // The instant the chain read is taken at. Recorded rather than read from a clock in the measurement
  // layer, so the plan probes and the timings bind the same moment.
  readonly chainReadAt: string;
}

export interface CalendarGenerationResult {
  readonly matterEventCount: number;
  readonly matterEventParticipantCount: number;
  readonly matterDeadlineCount: number;
  readonly firmEventCount: number;
  readonly firmResourceCount: number;
  readonly firmResourceBookingCount: number;
  readonly probes: CalendarProbes;
}

export interface CalendarAttachPoints {
  // Every matter the calendar may hang an event or a deadline off.
  readonly matterIds: readonly MatterId[];
  // The matter the other generators already made busiest — the deep-timeline probe.
  readonly deepTimelineMatterId: MatterId;
  readonly memberUserId: UserId;
  // Firm offices a resource may belong to. A resource's booking freezes its office's zone, so a
  // resource with no office is a real shape too.
  readonly firmLocationIds: readonly LocationId[];
}

function civilDateDaysBefore(baseDate: string, days: number): string {
  return new Date(Date.parse(`${baseDate}T00:00:00.000Z`) - days * MILLISECONDS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

export async function generateCalendarVolume(
  database: BatchDatabase,
  context: FixtureContext,
  volume: CalendarVolume,
  attach: CalendarAttachPoints,
  options: SeedingOptions,
): Promise<CalendarGenerationResult> {
  assertSeedingAllowed(options);
  const { faker, clock, randomSource } = context;
  const serviceOptions = {
    clock,
    actorUserId: attach.memberUserId,
    randomSource,
    // The seam every matter-anchored read composes. Generation uses the same predicate the product
    // does, so a row this generator writes onto an invisible matter would be invisible here too.
    visibility: visibleMatterPredicate(),
  };
  const commit = (effect: Parameters<typeof commitEffectBatch>[1]) =>
    commitEffectBatch(database, effect, { now: () => clock.now() });

  if (attach.matterIds.length === 0) {
    throw new Error("load-profile: calendar volume needs at least one matter to hang events off");
  }

  const today = clock.today();
  // The dense recent window: the most recent quarter of the span, plus six months ahead of today for
  // the settings a firm has already been given. Events spread unevenly across it and the long tail
  // behind it, because a calendar whose density is flat over a decade is not one any firm has.
  const recentWindowDays = Math.max(1, Math.round(volume.spanDays / 4));
  const dateInSpan = (): string => {
    const recent = faker.number.float({ min: 0, max: 1 }) < volume.recentWindowFraction;
    return civilDateDaysBefore(
      today,
      recent
        ? faker.number.int({ min: -180, max: recentWindowDays })
        : faker.number.int({ min: recentWindowDays, max: volume.spanDays }),
    );
  };

  let matterEventCount = 0;
  let participantCount = 0;
  const eventIdsByMatter = new Map<MatterId, MatterEventId[]>();

  const recordEvent = async (matterId: MatterId, startsOn: string): Promise<MatterEventId> => {
    const participantTarget = faker.number.int({
      min: volume.participantsPerEvent.min,
      max: volume.participantsPerEvent.max,
    });
    // Whether the firm's own member is on this one. The member-filtered read pays a correlated
    // participant lookup per candidate row whose cost tracks how many events that member is on, so
    // this share is what that read is measured against — putting the member on everything would make
    // the number describe a diary nobody keeps.
    const memberAttends =
      faker.number.float({ min: 0, max: 1 }) < volume.probeMemberParticipationFraction;
    const created = createMatterEvent(
      database,
      {
        matterId,
        eventTypeId: faker.helpers.arrayElement(LITIGATION_EVENT_TYPE_IDS),
        title: `${faker.word.adjective()} ${faker.word.noun()} setting`,
        startsOn,
        startsAtTime: faker.helpers.arrayElement(["09:00", "10:30", "13:15", "15:00", null]),
        timeZone: FIXTURE_TIME_ZONE,
        participants: Array.from({ length: participantTarget }, (_, index) =>
          index === 0 && memberAttends
            ? { participantKind: "member" as const, memberUserId: attach.memberUserId }
            : { participantKind: "external" as const, participantName: faker.person.fullName() },
        ),
      },
      serviceOptions,
    );
    await commit(created.effect);
    matterEventCount += 1;
    participantCount += participantTarget;
    const existing = eventIdsByMatter.get(matterId);
    if (existing === undefined) eventIdsByMatter.set(matterId, [created.eventId]);
    else existing.push(created.eventId);
    return created.eventId;
  };

  // ---- the litigation events ----
  for (const matterId of attach.matterIds) {
    const target = faker.number.int({
      min: volume.eventsPerMatter.min,
      max: volume.eventsPerMatter.max,
    });
    for (let index = 0; index < target; index += 1) {
      await recordEvent(matterId, dateInSpan());
    }
  }
  // The probe matter's own depth, on top of whatever the loop above gave it.
  for (let index = 0; index < volume.probeMatterEventCount; index += 1) {
    await recordEvent(attach.deepTimelineMatterId, dateInSpan());
  }

  // ---- the deadlines ----
  //
  // Open ones first, a slice of them already past due. Overdue is a comparison made where the reader
  // is and never a stored fact, so the only thing generation can do about it is put dates on both
  // sides of the line.
  let deadlineCount = 0;
  let overdueDeadlineId: MatterDeadlineId | null = null;
  const openDeadlineIds: MatterDeadlineId[] = [];
  const recordDeadline = async (
    matterId: MatterId,
    dueOn: string,
    triggerEventId: MatterEventId | null,
  ): Promise<MatterDeadlineId> => {
    const created = await createMatterDeadline(
      database,
      {
        matterId,
        title: `${faker.word.verb()} ${faker.word.noun()}`,
        dueOn,
        timeZone: FIXTURE_TIME_ZONE,
        authorityText: faker.lorem.sentence(),
        triggerEventId,
      },
      serviceOptions,
    );
    await commit(created.effect);
    deadlineCount += 1;
    return created.deadlineId;
  };

  for (let index = 0; index < volume.openDeadlineCount; index += 1) {
    const matterId =
      attach.matterIds[faker.number.int({ min: 0, max: attach.matterIds.length - 1 })]!;
    const overdue = faker.number.float({ min: 0, max: 1 }) < volume.overdueDeadlineFraction;
    const events = eventIdsByMatter.get(matterId) ?? [];
    const deadlineId = await recordDeadline(
      matterId,
      overdue
        ? civilDateDaysBefore(today, faker.number.int({ min: 1, max: 120 }))
        : civilDateDaysBefore(today, -faker.number.int({ min: 1, max: 365 })),
      // A trigger is a LINK to the event that started the clock and never an input to a calculation.
      events.length > 0 ? faker.helpers.arrayElement(events) : null,
    );
    openDeadlineIds.push(deadlineId);
    if (overdue) overdueDeadlineId ??= deadlineId;
  }

  // Discharged deadlines, so the `state` filter is selective rather than decorative. Closed through
  // the real vacate path — a state nobody put a deadline in is a state the read should never see.
  for (let index = 0; index < volume.closedDeadlineCount; index += 1) {
    const matterId =
      attach.matterIds[faker.number.int({ min: 0, max: attach.matterIds.length - 1 })]!;
    // A discharged deadline is a PAST one: its date sits behind the recent window, since a firm
    // vacates or satisfies an obligation it has already reached rather than one still ahead of it.
    const deadlineId = await recordDeadline(
      matterId,
      civilDateDaysBefore(today, faker.number.int({ min: recentWindowDays, max: volume.spanDays })),
      null,
    );
    const closed = await closeMatterDeadline(
      database,
      deadlineId,
      "vacated",
      { stateReason: faker.lorem.sentence() },
      serviceOptions,
    );
    await commit(closed.effect);
  }

  // ---- the firm's own scope ----
  //
  // A weekly staff meeting entered as individual rows, because recurrence is not built and a firm
  // types one row per week until it is. The all-members entries are the closures and holidays that
  // land on everybody's calendar — the audience branch the member-filtered read takes.
  let firmEventCount = 0;
  const firmEventIds: FirmEventId[] = [];
  for (let week = 0; week < volume.weeklyFirmEventWeeks; week += 1) {
    const created = await createFirmEvent(
      database,
      {
        eventTypeId: faker.helpers.arrayElement(FIRM_EVENT_TYPE_IDS),
        title: "Weekly case review",
        startsOn: civilDateDaysBefore(today, volume.weeklyFirmEventWeeks * 7 - week * 7),
        startsAtTime: "08:30",
        endsAtTime: "09:30",
        timeZone: FIXTURE_TIME_ZONE,
        audience: "participants",
        participants: [{ participantKind: "member", memberUserId: attach.memberUserId }],
      },
      serviceOptions,
    );
    await commit(created.effect);
    firmEventIds.push(created.firmEventId);
    firmEventCount += 1;
  }
  for (let index = 0; index < volume.allMembersFirmEventCount; index += 1) {
    const created = await createFirmEvent(
      database,
      {
        title: `Office closed — ${faker.word.noun()}`,
        startsOn: civilDateDaysBefore(today, faker.number.int({ min: -300, max: 300 })),
        timeZone: FIXTURE_TIME_ZONE,
        audience: "all_members",
      },
      serviceOptions,
    );
    await commit(created.effect);
    firmEventIds.push(created.firmEventId);
    firmEventCount += 1;
  }

  // ---- resources and bookings ----
  const resourceIds: FirmResourceId[] = [];
  for (let index = 0; index < volume.resourceCount; index += 1) {
    const created = await createFirmResource(
      database,
      {
        name: `Resource ${index + 1}`,
        kind: RESOURCE_KINDS[index % RESOURCE_KINDS.length]!,
        locationId:
          attach.firmLocationIds[index % Math.max(1, attach.firmLocationIds.length)] ?? null,
        capacity: index % 2 === 0 ? faker.number.int({ min: 4, max: 16 }) : null,
      },
      serviceOptions,
    );
    await commit(created.effect);
    resourceIds.push(created.firmResourceId);
  }

  let bookingCount = 0;
  const bookingsPerResource = new Map<FirmResourceId, number>();
  let previousBookingDate: string | null = null;
  for (let index = 0; index < volume.bookingCount && resourceIds.length > 0; index += 1) {
    // Every booking hangs off exactly one event; the firm events are the ones a room reservation
    // naturally attaches to, so they carry the booking load.
    const firmEventId = firmEventIds[index % firmEventIds.length];
    if (firmEventId === undefined) break;
    // The busiest resource is resource zero by construction — the availability read's hot case needs
    // one calendar that is genuinely fuller than the rest, not eight identical ones.
    const resourceId =
      index % 2 === 0
        ? resourceIds[0]!
        : resourceIds[faker.number.int({ min: 0, max: resourceIds.length - 1 })]!;
    // A deliberate overlap fraction: the availability read pre-pairs overlapping bookings, and with
    // no overlaps that pass would be measured doing nothing.
    const overlapping: boolean =
      previousBookingDate !== null &&
      faker.number.float({ min: 0, max: 1 }) < volume.overlappingBookingFraction;
    const startsOn: string =
      overlapping && previousBookingDate !== null
        ? previousBookingDate
        : civilDateDaysBefore(today, faker.number.int({ min: -180, max: 365 }));
    const created = await createFirmResourceBooking(
      database,
      {
        resourceId,
        firmEventId,
        startsOn,
        startsAtTime: overlapping
          ? "09:00"
          : faker.helpers.arrayElement(["09:00", "11:00", "14:00"]),
        endsAtTime: overlapping ? "12:00" : faker.helpers.arrayElement(["10:00", "12:00", "16:00"]),
      },
      serviceOptions,
    );
    await commit(created.effect);
    bookingCount += 1;
    bookingsPerResource.set(resourceId, (bookingsPerResource.get(resourceId) ?? 0) + 1);
    previousBookingDate = startsOn;
  }

  // ---- the continued hearing ----
  //
  // A five-node chain with deadlines hanging off the intermediate settings: the shape the chain read
  // has to walk, and the shape that proves a continuance is a new row plus one link rather than an
  // edit that loses the history.
  let chainEventId = await recordEvent(
    attach.deepTimelineMatterId,
    civilDateDaysBefore(today, 400),
  );
  const chainAnchorId = chainEventId;
  for (let step = 1; step < volume.continuanceChainLength; step += 1) {
    await recordDeadline(
      attach.deepTimelineMatterId,
      civilDateDaysBefore(today, 400 - step * 60),
      chainEventId,
    );
    const continued = await continueMatterEvent(
      database,
      chainEventId,
      {
        startsOn: civilDateDaysBefore(today, 400 - step * 90),
        statusReason: "Continued on the court's own motion",
      },
      serviceOptions,
    );
    await commit(continued.effect);
    chainEventId = continued.newEventId;
    matterEventCount += 1;
  }

  let busiestResourceId = resourceIds[0];
  let mostBookings = -1;
  for (const [resourceId, count] of bookingsPerResource) {
    if (count > mostBookings) {
      mostBookings = count;
      busiestResourceId = resourceId;
    }
  }
  if (busiestResourceId === undefined) {
    throw new Error("load-profile: calendar volume generated no bookable resources");
  }

  const shallowTimelineMatterId =
    attach.matterIds.find((matterId) => matterId !== attach.deepTimelineMatterId) ??
    attach.deepTimelineMatterId;
  const fallbackDeadlineId = openDeadlineIds[0];
  if (fallbackDeadlineId === undefined) {
    throw new Error("load-profile: calendar volume generated no open deadlines");
  }

  return {
    matterEventCount,
    matterEventParticipantCount: participantCount,
    matterDeadlineCount: deadlineCount,
    firmEventCount,
    firmResourceCount: resourceIds.length,
    firmResourceBookingCount: bookingCount,
    probes: {
      deepTimelineMatterId: attach.deepTimelineMatterId,
      shallowTimelineMatterId,
      memberUserId: attach.memberUserId,
      busiestResourceId,
      availabilityFromDate: civilDateDaysBefore(today, 15),
      availabilityToDate: civilDateDaysBefore(today, -15),
      // Exactly the 31-day window the design names, ending today: federation's weakest read is the
      // one that spans every matter, and it is measured at the window a month grid asks for.
      firmWindowFromDate: civilDateDaysBefore(today, 30),
      firmWindowToDate: today,
      // The chain's ANCHOR, not its live end: the read walks both directions, and starting at the
      // middle is what proves it does.
      continuanceChainEventId: chainAnchorId,
      overdueDeadlineId: overdueDeadlineId ?? fallbackDeadlineId,
      bookingTimeZone: FIXTURE_TIME_ZONE,
      chainReadAt: clock.now(),
    },
  };
}
