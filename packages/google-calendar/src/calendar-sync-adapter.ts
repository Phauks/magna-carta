import { z } from "zod";
import {
  CALENDAR_SYNC_CATEGORY,
  type CalendarSyncPort,
  type ProviderCalendar,
  type ProviderCalendarEvent,
  type ProviderCalendarEvents,
  type ProviderChangeWatch,
  type ProviderChangeWatchRequest,
  type ProviderEventPresence,
  type ProviderEventReceipt,
  type ProviderEventSnapshot,
  type ProviderEventWindow,
  type ProviderEventWrite,
  type ProviderSeriesChangedDay,
  type ProviderWrittenEvents,
} from "@magna-carta/calendar/sync-port";
import { addCalendarDays, civilDateParts, isCivilDate } from "@magna-carta/civil-time/civil-date";
import { WEEKDAY_CODES, weekdayOf, weekdayPositionOf } from "@magna-carta/civil-time/recurrence";
import { endOfCivilDayInstant } from "@magna-carta/civil-time/time-zone";
import { adapterError, ok, type Dispatch } from "@magna-carta/integrations/dispatch";
import type { HttpClient, HttpResponse } from "@magna-carta/integrations/http";
import type { Adapter, AdapterContext, CapabilityDescriptor } from "@magna-carta/integrations/port";
import { integrationProblem, type IntegrationProblem } from "@magna-carta/integrations/problem";

// The calendar sync port over the Google Calendar API, with plain requests and no vendor library.

export const GOOGLE_CALENDAR_ADAPTER_ID = "google-calendar";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

const descriptor: CapabilityDescriptor = {
  adapterId: GOOGLE_CALENDAR_ADAPTER_ID,
  category: CALENDAR_SYNC_CATEGORY,
  credential: { kind: "oauth", scope: "user" },
  operations: {
    listCalendars: { supported: true },
    createEvent: { supported: true },
    updateEvent: { supported: true },
    deleteEvent: { supported: true },
    listWrittenEvents: { supported: true },
    readEvent: { supported: true },
    listCalendarEvents: { supported: true },
    listSeriesChangedDays: { supported: true },
    updateSeriesDay: { supported: true },
    watchChanges: { supported: true },
    renewWatch: { supported: true },
    stopWatch: { supported: true },
  },
  passthroughAvailable: false,
};

// AN EVENT'S IDENTIFIER HERE NAMES ITS CALENDAR TOO. Google identifies an event only inside a
// calendar, and the port hands back one identifier, so the two travel together: the event's own
// identifier, a slash, the calendar's. The event's half is percent-encoded so the first slash is
// always the join. A copy the member moves to another calendar is therefore a copy this adapter no
// longer finds, which the caller reads as a copy that was deleted.
export function googleEventReference(eventId: string, calendarId: string): string {
  return `${encodeURIComponent(eventId)}/${calendarId}`;
}

function partsOfReference(
  remoteId: string,
): { readonly eventId: string; readonly calendarId: string } | undefined {
  const join = remoteId.indexOf("/");
  if (join <= 0 || join === remoteId.length - 1) return undefined;
  try {
    return {
      eventId: decodeURIComponent(remoteId.slice(0, join)),
      calendarId: remoteId.slice(join + 1),
    };
  } catch {
    return undefined;
  }
}

function eventsUrl(calendarId: string): string {
  return `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`;
}

// The mark every copy carries, so the copies can be asked for by themselves. A private extended
// property: the member never sees it and it is not copied to anybody else's calendar. Reading back
// only what carries it is what keeps a pass from ever being handed an event the member made
// themselves. Changing the name orphans every copy already written.
export const WRITTEN_COPY_PROPERTY_NAME = "magnaCartaCopy";
const WRITTEN_COPY_PROPERTY_VALUE = "1";

// A member with more calendars than this has a list no settings page can usefully show.
const CALENDAR_PAGE_LIMIT = 4;
const CALENDAR_PAGE_SIZE = 250;
// A calendar holding more copies than this many pages is past what one pass will read; the list
// says it stopped short, and the caller then concludes nothing from a copy being absent.
const WRITTEN_EVENT_PAGE_LIMIT = 10;
const EVENT_PAGE_SIZE = 250;
// A calendar's events inside a window, a series already laid out as its days.
const CALENDAR_VIEW_PAGE_LIMIT = 20;
// The days of one series looked at for a change the member made: from a month back to a little
// over a year on, which is as far as this platform lays a series out.
const SERIES_DAY_PAGE_LIMIT = 4;
const SERIES_LOOK_BACK_DAYS = 31;
const SERIES_LOOK_AHEAD_DAYS = 400;
// Google watches one calendar at a time. A member with more calendars than this has the first of
// them watched, their own first, and the rest are found by the pass that runs anyway.
const WATCHED_CALENDAR_LIMIT = 20;
const MILLISECONDS_PER_DAY = 86_400_000;

const calendarListSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        summary: z.string().optional(),
        summaryOverride: z.string().optional(),
        primary: z.boolean().optional(),
        accessRole: z.string().optional(),
        deleted: z.boolean().optional(),
      }),
    )
    .optional(),
  nextPageToken: z.string().optional(),
});

const CALENDAR_LIST_FIELDS =
  "nextPageToken,items(id,summary,summaryOverride,primary,accessRole,deleted)";

const googleMomentSchema = z.object({
  date: z.string().optional(),
  dateTime: z.string().optional(),
  timeZone: z.string().optional(),
});

const eventSchema = z.object({
  id: z.string().min(1),
  etag: z.string().optional(),
  status: z.string().optional(),
  summary: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  start: googleMomentSchema.optional(),
  end: googleMomentSchema.optional(),
  recurringEventId: z.string().optional(),
  originalStartTime: googleMomentSchema.optional(),
  eventType: z.string().optional(),
});
type GoogleEvent = z.infer<typeof eventSchema>;

const EVENT_FIELDS =
  "id,etag,status,summary,location,start,end,recurringEventId,originalStartTime,eventType";
const EVENT_PAGE_FIELDS = `nextPageToken,items(${EVENT_FIELDS})`;

const eventPageSchema = z.object({
  items: z.array(eventSchema).optional(),
  nextPageToken: z.string().optional(),
});

const channelSchema = z.object({
  id: z.string().min(1),
  resourceId: z.string().min(1),
  expiration: z.union([z.string(), z.number()]).optional(),
});

// What Google says is wrong, read only as far as the one word that tells a limit from a refusal.
const errorSchema = z.object({
  error: z.object({
    errors: z.array(z.object({ reason: z.string().optional() })).optional(),
  }),
});

const LIMIT_REASONS: ReadonlySet<string> = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "quotaExceeded",
]);

// An event as Google answers it, in the calendar's terms, or undefined when the answer is not one
// this adapter can place.
//
// A whole-day event ends on the day AFTER its last day, so the last day is the day before. A timed
// one is answered with its own offset, which says exactly which instant it is.
export function snapshotOfGoogleEvent(
  event: GoogleEvent,
  calendarId: string,
): ProviderEventSnapshot | undefined {
  if (event.start === undefined || event.end === undefined) return undefined;
  const location = event.location ?? null;
  const base = {
    remoteId: googleEventReference(event.id, calendarId),
    versionTag: event.etag ?? null,
    title: event.summary ?? "",
    location: location === null || location.trim() === "" ? null : location,
  };
  const startDay = event.start.date;
  const endDay = event.end.date;
  if (startDay !== undefined && endDay !== undefined) {
    if (!isCivilDate(startDay) || !isCivilDate(endDay)) return undefined;
    const lastDay = endDay > startDay ? addCalendarDays(endDay, -1) : startDay;
    return { ...base, when: { kind: "days", startsOn: startDay, endsOn: lastDay } };
  }
  const startsAtMilliseconds = Date.parse(event.start.dateTime ?? "");
  const endsAtMilliseconds = Date.parse(event.end.dateTime ?? "");
  if (Number.isNaN(startsAtMilliseconds) || Number.isNaN(endsAtMilliseconds)) return undefined;
  return { ...base, when: { kind: "instants", startsAtMilliseconds, endsAtMilliseconds } };
}

function compact(civilDate: string): string {
  return civilDate.replaceAll("-", "");
}

function compactUtc(instantMilliseconds: number): string {
  // 2026-11-13T07:59:59.999Z becomes 20261113T075959Z.
  return `${new Date(instantMilliseconds).toISOString().slice(0, 19).replaceAll(/[-:]/g, "")}Z`;
}

// A series as Google repeats it: the lines of the calendar standard Google takes as they are. Null
// where Google cannot be relied on to put the series on exactly the days this platform does, and
// undefined for an event that happens once.
//
// THE ONE CASE REFUSED is a weekly series whose first day is not one of its weekdays. This platform
// counts that first day as part of the series; the standard leaves it to each calendar, and a
// series that has one more day here than there is worse than one plainly not sent. Everything else
// reads the same in both: a month with no 31st or no fifth Tuesday is skipped by both, weeks begin
// on Sunday in both (stated here, because the standard's own default is Monday), and a day taken
// out of the series still counts toward its number of occurrences in both.
//
// The rule is built from the rule as read and never from the stored line, which spells a monthly
// weekday rule in a way of this platform's own.
export function googleRecurrenceOf(
  event: ProviderEventWrite,
): readonly string[] | null | undefined {
  const repeats = event.repeats;
  if (repeats === null || repeats === undefined) return undefined;
  const rule = repeats.rule;
  if (rule === null) return null;
  const start = civilDateParts(event.startsOn);
  const startWeekday = weekdayOf(event.startsOn);
  const allDay = event.startsAtTime === null;

  const parts: string[] = [`FREQ=${rule.frequency.toUpperCase()}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.frequency === "weekly") {
    const weekdays = rule.weekdays.length > 0 ? rule.weekdays : [startWeekday];
    if (!weekdays.includes(startWeekday)) return null;
    parts.push("WKST=SU");
    parts.push(`BYDAY=${WEEKDAY_CODES.filter((code) => weekdays.includes(code)).join(",")}`);
  } else if (rule.frequency === "monthly" && rule.monthly === "byWeekday") {
    parts.push(`BYDAY=${weekdayPositionOf(event.startsOn)}${startWeekday}`);
  } else if (rule.frequency === "monthly") {
    parts.push(`BYMONTHDAY=${start.day}`);
  } else if (rule.frequency === "yearly") {
    parts.push(`BYMONTH=${start.month}`, `BYMONTHDAY=${start.day}`);
  }
  if (rule.end.kind === "after") parts.push(`COUNT=${rule.end.count}`);
  if (rule.end.kind === "on") {
    // The last day the series may fall on. A timed series says so as an instant, which is the end
    // of that day where the event is; a whole-day one says the day itself.
    parts.push(
      allDay
        ? `UNTIL=${compact(rule.end.date)}`
        : `UNTIL=${compactUtc(endOfCivilDayInstant(rule.end.date, event.timeZone))}`,
    );
  }

  const lines = [`RRULE:${parts.join(";")}`];
  if (repeats.skippedDays.length > 0) {
    // The days the series does not fall on travel with the rule, so they are taken out by the same
    // write that sends it and stay out when the rule changes.
    lines.push(
      allDay
        ? `EXDATE;VALUE=DATE:${repeats.skippedDays.map(compact).join(",")}`
        : `EXDATE;TZID=${event.timeZone}:${repeats.skippedDays
            .map((day) => `${compact(day)}T${(event.startsAtTime ?? "").replace(":", "")}00`)
            .join(",")}`,
    );
  }
  return lines;
}

const UNREPEATABLE = "Google Calendar cannot repeat this event on exactly the same days";

// When the event is, as Google takes it. Both forms name every field and set the ones that do not
// apply to null: a change is merged into what Google holds, so a copy that was timed and is now a
// whole day would otherwise keep its old time beside its new date and be refused.
function googleMoments(event: ProviderEventWrite): {
  readonly start: Record<string, string | null>;
  readonly end: Record<string, string | null>;
} {
  const lastDay = event.endsOn ?? event.startsOn;
  if (event.startsAtTime === null) {
    return {
      start: { date: event.startsOn, dateTime: null, timeZone: null },
      end: { date: addCalendarDays(lastDay, 1), dateTime: null, timeZone: null },
    };
  }
  return {
    start: {
      date: null,
      dateTime: `${event.startsOn}T${event.startsAtTime}:00`,
      timeZone: event.timeZone,
    },
    end: {
      date: null,
      dateTime: `${lastDay}T${event.endsAtTime ?? event.startsAtTime}:00`,
      timeZone: event.timeZone,
    },
  };
}

// The event as Google takes it.
//
// A whole-day event ends on the day AFTER its last day. Magna Carta holds the last day itself, so
// the end moves one day on. A timed event with no end is sent ending when it starts: that is what
// was recorded, and inventing an hour would put a duration in a calendar that nobody decided on.
//
// No attendees are ever sent. An event with attendees is an invitation, which emails them.
//
// A series carries its rule; a caller checks `googleRecurrenceOf` first and never sends one whose
// rule came back null. An event that happens once says so with an empty list, because the copy may
// have been a series when it was last written.
export function googleEventBody(event: ProviderEventWrite): Record<string, unknown> {
  const recurrence = googleRecurrenceOf(event);
  return {
    summary: event.title,
    description: event.notes ?? "",
    location: event.location ?? "",
    ...googleMoments(event),
    extendedProperties: { private: { [WRITTEN_COPY_PROPERTY_NAME]: WRITTEN_COPY_PROPERTY_VALUE } },
    recurrence: recurrence ?? [],
  };
}

const EVENT_ID_ALPHABET = /[^a-v0-9]/g;

// The identifier a new copy is given, made from the caller's own transaction identifier. Google
// lets the creator choose an event's identifier and refuses a second event with the same one, so
// a create whose answer was lost and is tried again makes one copy and not two. Undefined where
// the transaction identifier leaves too little to make one, and Google then chooses.
export function googleEventIdFor(transactionId: string): string | undefined {
  const usable = transactionId.toLowerCase().replaceAll(EVENT_ID_ALPHABET, "");
  return usable.length >= 16 ? usable.slice(0, 64) : undefined;
}

export interface GoogleCalendarAdapterDependencies {
  readonly http: HttpClient;
  readonly now: () => Date;
  // A new identifier for one watch on one calendar. Random, and never reused.
  readonly newChannelId: () => string;
}

interface WatchedChannel {
  readonly id: string;
  readonly resourceId: string;
}

// A watch on an account is one channel per calendar, and the caller holds one identifier, so the
// channels travel in it.
function watchIdOf(channels: readonly WatchedChannel[]): string {
  return JSON.stringify(channels.map((channel) => [channel.id, channel.resourceId]));
}

const watchIdSchema = z.array(z.tuple([z.string().min(1), z.string().min(1)])).max(100);

function channelsOf(watchId: string): readonly WatchedChannel[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(watchId);
  } catch {
    return [];
  }
  const read = watchIdSchema.safeParse(parsed);
  return read.success ? read.data.map(([id, resourceId]) => ({ id, resourceId })) : [];
}

export function createGoogleCalendarAdapter(
  dependencies: GoogleCalendarAdapterDependencies,
): Adapter<CalendarSyncPort> {
  return {
    descriptor,
    create(context: AdapterContext): CalendarSyncPort {
      const credential = context.credential;
      if (credential?.kind !== "oauth" || credential.accessToken === undefined) {
        throw new Error("The Google calendar adapter requires a signed-in account's access token");
      }
      const headers = { Authorization: `Bearer ${credential.accessToken}` };

      const unreachable = (): Dispatch<never> =>
        adapterError(integrationProblem("network", 503, "Google could not be reached"));
      const unreadable = (what: string): Dispatch<never> =>
        adapterError(integrationProblem("validation", 502, `${what} could not be read`));

      async function readJson(response: HttpResponse): Promise<unknown> {
        try {
          return await response.json();
        } catch {
          return undefined;
        }
      }

      // Google answers 403 both for "you are asking too fast" and for "you may not do this", and
      // only the first is worth trying again.
      async function problemFor(response: HttpResponse): Promise<IntegrationProblem> {
        const status = response.status;
        if (status === 401)
          return integrationProblem("auth", 401, "Google refused the access token");
        if (status === 429)
          return integrationProblem("rate_limit", 429, "Google is limiting requests");
        if (status === 403) {
          const parsed = errorSchema.safeParse(await readJson(response));
          const limited =
            parsed.success &&
            (parsed.data.error.errors ?? []).some(
              (entry) => entry.reason !== undefined && LIMIT_REASONS.has(entry.reason),
            );
          if (limited) return integrationProblem("rate_limit", 429, "Google is limiting requests");
        }
        if (status >= 500) return integrationProblem("upstream", 502, `Google responded ${status}`);
        return integrationProblem("validation", status, `Google responded ${status}`);
      }

      async function refused(response: HttpResponse): Promise<Dispatch<never>> {
        return adapterError(await problemFor(response));
      }

      async function get(url: string): Promise<Dispatch<HttpResponse>> {
        try {
          return ok(await dependencies.http.request({ method: "GET", url, headers }));
        } catch {
          return unreachable();
        }
      }

      async function send(
        method: "POST" | "PATCH" | "DELETE",
        url: string,
        body: Record<string, unknown> | undefined,
      ): Promise<Dispatch<HttpResponse>> {
        try {
          return ok(
            await dependencies.http.request({
              method,
              url,
              headers:
                body === undefined ? headers : { ...headers, "Content-Type": "application/json" },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            }),
          );
        } catch {
          return unreachable();
        }
      }

      // Gone is 404 for an event Google has forgotten and 410 for one it remembers deleting.
      const gone = (status: number): boolean => status === 404 || status === 410;

      async function readEventResponse(response: HttpResponse): Promise<GoogleEvent | undefined> {
        const parsed = eventSchema.safeParse(await readJson(response));
        return parsed.success ? parsed.data : undefined;
      }

      interface ListedCalendar extends ProviderCalendar {
        readonly canReadEvents: boolean;
      }

      async function calendarList(): Promise<Dispatch<readonly ListedCalendar[]>> {
        const calendars: ListedCalendar[] = [];
        let pageToken: string | undefined;
        for (let page = 0; page < CALENDAR_PAGE_LIMIT; page += 1) {
          const answered = await get(
            `${CALENDAR_API}/users/me/calendarList?maxResults=${CALENDAR_PAGE_SIZE}` +
              `&fields=${encodeURIComponent(CALENDAR_LIST_FIELDS)}` +
              (pageToken === undefined ? "" : `&pageToken=${encodeURIComponent(pageToken)}`),
          );
          if (!answered.ok) return answered;
          if (answered.value.status >= 400) return refused(answered.value);
          const parsed = calendarListSchema.safeParse(await readJson(answered.value));
          if (!parsed.success) return unreadable("Google's calendar list");
          for (const calendar of parsed.data.items ?? []) {
            if (calendar.deleted === true) continue;
            const role = calendar.accessRole;
            calendars.push({
              remoteId: calendar.id,
              name: calendar.summaryOverride ?? calendar.summary ?? calendar.id,
              isDefault: calendar.primary === true,
              canWrite: role === "owner" || role === "writer",
              // A calendar shared as free and busy times only has no events to read.
              canReadEvents: role === "owner" || role === "writer" || role === "reader",
            });
          }
          pageToken = parsed.data.nextPageToken;
          if (pageToken === undefined) break;
        }
        return ok(calendars);
      }

      // One calendar's events, page by page, each handed to `take`. Answers whether every page was
      // read, or null when the account no longer has the calendar.
      async function eachEvent(
        calendarId: string,
        query: string,
        pageLimit: number,
        take: (event: GoogleEvent) => void,
        path = "",
      ): Promise<Dispatch<boolean | null>> {
        let pageToken: string | undefined;
        for (let page = 0; page < pageLimit; page += 1) {
          const answered = await get(
            `${eventsUrl(calendarId)}${path}?${query}&maxResults=${EVENT_PAGE_SIZE}` +
              `&fields=${encodeURIComponent(EVENT_PAGE_FIELDS)}` +
              (pageToken === undefined ? "" : `&pageToken=${encodeURIComponent(pageToken)}`),
          );
          if (!answered.ok) return answered;
          if (gone(answered.value.status)) return ok(null);
          if (answered.value.status >= 400) return refused(answered.value);
          const parsed = eventPageSchema.safeParse(await readJson(answered.value));
          if (!parsed.success) return unreadable("Google's list of events");
          for (const event of parsed.data.items ?? []) take(event);
          pageToken = parsed.data.nextPageToken;
          if (pageToken === undefined) return ok(true);
        }
        return ok(false);
      }

      async function stopChannels(channels: readonly WatchedChannel[]): Promise<Dispatch<null>> {
        for (const channel of channels) {
          const sent = await send("POST", `${CALENDAR_API}/channels/stop`, {
            id: channel.id,
            resourceId: channel.resourceId,
          });
          if (!sent.ok) return sent;
          if (sent.value.status === 401) return refused(sent.value);
          // Any other refusal is a channel that is already gone or was never this account's, and
          // either way there is nothing left to stop.
        }
        return ok(null);
      }

      return {
        async listCalendars(): Promise<Dispatch<readonly ProviderCalendar[]>> {
          const listed = await calendarList();
          if (!listed.ok) return listed;
          return ok(
            listed.value
              .filter((calendar) => calendar.canReadEvents)
              .map(({ remoteId, name, isDefault, canWrite }) => ({
                remoteId,
                name,
                isDefault,
                canWrite,
              })),
          );
        },

        async createEvent(
          calendarRemoteId: string,
          event: ProviderEventWrite,
          transactionId: string,
        ): Promise<Dispatch<ProviderEventReceipt>> {
          if (googleRecurrenceOf(event) === null) {
            return adapterError(integrationProblem("validation", 422, UNREPEATABLE));
          }
          const eventId = googleEventIdFor(transactionId);
          const sent = await send("POST", eventsUrl(calendarRemoteId), {
            ...googleEventBody(event),
            ...(eventId === undefined ? {} : { id: eventId }),
          });
          if (!sent.ok) return sent;
          let answered = sent.value;
          if (answered.status === 409 && eventId !== undefined) {
            // The identifier is taken, which is what a second try of a create that worked looks
            // like. The copy the first try made is the answer.
            const existing = await get(
              `${eventsUrl(calendarRemoteId)}/${encodeURIComponent(eventId)}?fields=${encodeURIComponent(EVENT_FIELDS)}`,
            );
            if (!existing.ok) return existing;
            answered = existing.value;
          }
          if (answered.status >= 400) return refused(answered);
          const created = await readEventResponse(answered);
          if (created === undefined || created.status === "cancelled") {
            return unreadable("Google's answer to a new event");
          }
          return ok({
            remoteId: googleEventReference(created.id, calendarRemoteId),
            versionTag: created.etag ?? null,
          });
        },

        async updateEvent(
          remoteId: string,
          event: ProviderEventWrite,
        ): Promise<Dispatch<ProviderEventPresence>> {
          if (googleRecurrenceOf(event) === null) {
            return adapterError(integrationProblem("validation", 422, UNREPEATABLE));
          }
          const reference = partsOfReference(remoteId);
          if (reference === undefined) return ok({ found: false });
          const sent = await send(
            "PATCH",
            `${eventsUrl(reference.calendarId)}/${encodeURIComponent(reference.eventId)}`,
            googleEventBody(event),
          );
          if (!sent.ok) return sent;
          if (gone(sent.value.status)) return ok({ found: false });
          if (sent.value.status >= 400) return refused(sent.value);
          const updated = await readEventResponse(sent.value);
          // A copy the member deleted is still answered for a while, marked as called off.
          if (updated?.status === "cancelled") return ok({ found: false });
          return ok({ found: true, versionTag: updated?.etag ?? null });
        },

        async deleteEvent(remoteId: string): Promise<Dispatch<null>> {
          const reference = partsOfReference(remoteId);
          if (reference === undefined) return ok(null);
          const sent = await send(
            "DELETE",
            `${eventsUrl(reference.calendarId)}/${encodeURIComponent(reference.eventId)}`,
            undefined,
          );
          if (!sent.ok) return sent;
          // Already gone is what the caller asked for.
          if (gone(sent.value.status)) return ok(null);
          if (sent.value.status >= 400) return refused(sent.value);
          return ok(null);
        },

        // Google has no question that spans calendars, so each calendar a copy could be in is asked
        // for the events carrying the mark. A copy can only be in a calendar the member can write.
        async listWrittenEvents(): Promise<Dispatch<ProviderWrittenEvents>> {
          const listed = await calendarList();
          if (!listed.ok) return listed;
          const events: ProviderEventSnapshot[] = [];
          let complete = true;
          const query = `privateExtendedProperty=${encodeURIComponent(
            `${WRITTEN_COPY_PROPERTY_NAME}=${WRITTEN_COPY_PROPERTY_VALUE}`,
          )}&singleEvents=false&showDeleted=false`;
          for (const calendar of listed.value) {
            if (!calendar.canWrite) continue;
            let unplaced = false;
            const read = await eachEvent(
              calendar.remoteId,
              query,
              WRITTEN_EVENT_PAGE_LIMIT,
              (event) => {
                // A day of a series the member changed is listed beside the series and is not a
                // copy of its own, and a day they deleted is listed as called off.
                if (event.recurringEventId !== undefined || event.status === "cancelled") return;
                const snapshot = snapshotOfGoogleEvent(event, calendar.remoteId);
                if (snapshot === undefined) unplaced = true;
                else events.push(snapshot);
              },
            );
            if (!read.ok) return read;
            if (unplaced) return unreadable("An event in Google's list");
            // A calendar that went away between the two requests holds no copies to list.
            if (read.value === false) complete = false;
          }
          return ok({ events, complete });
        },

        async readEvent(remoteId: string): Promise<Dispatch<ProviderEventSnapshot | null>> {
          const reference = partsOfReference(remoteId);
          if (reference === undefined) return ok(null);
          const answered = await get(
            `${eventsUrl(reference.calendarId)}/${encodeURIComponent(reference.eventId)}` +
              `?fields=${encodeURIComponent(EVENT_FIELDS)}`,
          );
          if (!answered.ok) return answered;
          if (gone(answered.value.status)) return ok(null);
          if (answered.value.status >= 400) return refused(answered.value);
          const event = await readEventResponse(answered.value);
          if (event?.status === "cancelled") return ok(null);
          const snapshot =
            event === undefined ? undefined : snapshotOfGoogleEvent(event, reference.calendarId);
          if (snapshot === undefined) return unreadable("Google's answer for an event");
          return ok(snapshot);
        },

        async listCalendarEvents(
          calendarRemoteId: string,
          window: ProviderEventWindow,
        ): Promise<Dispatch<ProviderCalendarEvents | null>> {
          const events: ProviderCalendarEvent[] = [];
          const read = await eachEvent(
            calendarRemoteId,
            `singleEvents=true&orderBy=startTime&showDeleted=false` +
              `&timeMin=${encodeURIComponent(window.fromInstant)}` +
              `&timeMax=${encodeURIComponent(window.toInstant)}`,
            CALENDAR_VIEW_PAGE_LIMIT,
            (event) => {
              if (event.status === "cancelled") return;
              // Where the member is working that day is a setting Google keeps as an event, and
              // not something that happens.
              if (event.eventType === "workingLocation") return;
              // These are the member's own events and come in every shape a calendar has ever
              // held. One this adapter cannot place is left out; it does not cost them the rest.
              const snapshot = snapshotOfGoogleEvent(event, calendarRemoteId);
              if (snapshot === undefined) return;
              events.push({
                ...snapshot,
                seriesRemoteId:
                  event.recurringEventId === undefined
                    ? null
                    : googleEventReference(event.recurringEventId, calendarRemoteId),
              });
            },
          );
          if (!read.ok) return read;
          if (read.value === null) return ok(null);
          return ok({ events, complete: read.value });
        },

        // Google does not say which days of a series were changed, so the days near now are all
        // answered and the caller, which knows what the series was sent as, keeps the ones that
        // differ. A day deleted from the series is not listed at all.
        async listSeriesChangedDays(
          seriesRemoteId: string,
        ): Promise<Dispatch<readonly ProviderSeriesChangedDay[] | null>> {
          const reference = partsOfReference(seriesRemoteId);
          if (reference === undefined) return ok(null);
          const nowMs = dependencies.now().getTime();
          const from = new Date(nowMs - SERIES_LOOK_BACK_DAYS * MILLISECONDS_PER_DAY);
          const to = new Date(nowMs + SERIES_LOOK_AHEAD_DAYS * MILLISECONDS_PER_DAY);
          const days: ProviderSeriesChangedDay[] = [];
          const read = await eachEvent(
            reference.calendarId,
            `showDeleted=false&timeMin=${encodeURIComponent(from.toISOString())}` +
              `&timeMax=${encodeURIComponent(to.toISOString())}`,
            SERIES_DAY_PAGE_LIMIT,
            (event) => {
              if (event.status === "cancelled") return;
              const snapshot = snapshotOfGoogleEvent(event, reference.calendarId);
              const original = event.originalStartTime;
              // A whole day is named by its date. Noon in UTC is that same date everywhere a
              // calendar's zone is less than twelve hours from UTC, which is where the caller
              // reads it back.
              const originalStartsAtMilliseconds =
                original?.date !== undefined && isCivilDate(original.date)
                  ? Date.parse(`${original.date}T12:00:00.000Z`)
                  : Date.parse(original?.dateTime ?? "");
              // A day that cannot be placed, or does not say which day it was, is left as the
              // member made it. Guessing which day of a series a moved event used to be would
              // change the wrong one.
              if (snapshot === undefined || Number.isNaN(originalStartsAtMilliseconds)) return;
              days.push({ ...snapshot, originalStartsAtMilliseconds });
            },
            `/${encodeURIComponent(reference.eventId)}/instances`,
          );
          if (!read.ok) return read;
          if (read.value === null) return ok(null);
          return ok(days);
        },

        async updateSeriesDay(
          dayRemoteId: string,
          event: ProviderEventWrite,
        ): Promise<Dispatch<ProviderEventPresence>> {
          const reference = partsOfReference(dayRemoteId);
          if (reference === undefined) return ok({ found: false });
          const sent = await send(
            "PATCH",
            `${eventsUrl(reference.calendarId)}/${encodeURIComponent(reference.eventId)}`,
            // Only what a member can see. The day keeps the series' notes and its mark, and a
            // day of a series is never given a rule of its own.
            { summary: event.title, location: event.location ?? "", ...googleMoments(event) },
          );
          if (!sent.ok) return sent;
          if (gone(sent.value.status)) return ok({ found: false });
          if (sent.value.status >= 400) return refused(sent.value);
          const updated = await readEventResponse(sent.value);
          if (updated?.status === "cancelled") return ok({ found: false });
          return ok({ found: true, versionTag: updated?.etag ?? null });
        },

        // One channel per calendar, the member's own calendar first. A calendar Google will not
        // watch (a public holiday calendar is one) is left out and costs the others nothing; the
        // watch has begun when any calendar is being watched.
        async watchChanges(
          request: ProviderChangeWatchRequest,
        ): Promise<Dispatch<ProviderChangeWatch>> {
          const listed = await calendarList();
          if (!listed.ok) return listed;
          const calendars = listed.value
            .filter((calendar) => calendar.canReadEvents)
            .toSorted((left, right) => Number(right.isDefault) - Number(left.isDefault))
            .slice(0, WATCHED_CALENDAR_LIMIT);
          const channels: WatchedChannel[] = [];
          let soonest = Date.parse(request.expiresAt);
          let lastRefusal: HttpResponse | undefined;
          for (const calendar of calendars) {
            const sent = await send("POST", `${eventsUrl(calendar.remoteId)}/watch`, {
              id: dependencies.newChannelId(),
              type: "web_hook",
              address: request.address,
              token: request.secret,
              expiration: String(Date.parse(request.expiresAt)),
            });
            if (!sent.ok) {
              await stopChannels(channels);
              return sent;
            }
            if (sent.value.status === 401) {
              await stopChannels(channels);
              return refused(sent.value);
            }
            if (sent.value.status >= 400) {
              lastRefusal = sent.value;
              continue;
            }
            const parsed = channelSchema.safeParse(await readJson(sent.value));
            if (!parsed.success) continue;
            channels.push({ id: parsed.data.id, resourceId: parsed.data.resourceId });
            const expiration = Number(parsed.data.expiration);
            if (Number.isFinite(expiration) && expiration > 0 && expiration < soonest) {
              soonest = expiration;
            }
          }
          if (channels.length === 0) {
            if (lastRefusal !== undefined) return refused(lastRefusal);
            return unreadable("Google's answer to a new watch");
          }
          if (Number.isNaN(soonest)) return unreadable("When the watch was asked to last until");
          return ok({ watchId: watchIdOf(channels), expiresAt: new Date(soonest).toISOString() });
        },

        // Google has no way to keep a channel going past its time. The channels are ended here and
        // the caller, told the watch is gone, begins a new one in the same pass.
        async renewWatch(watchId: string): Promise<Dispatch<ProviderChangeWatch | null>> {
          const stopped = await stopChannels(channelsOf(watchId));
          if (!stopped.ok) return stopped;
          return ok(null);
        },

        async stopWatch(watchId: string): Promise<Dispatch<null>> {
          return stopChannels(channelsOf(watchId));
        },
      };
    },
  };
}
