import { z } from "zod";
import {
  CALENDAR_SYNC_CATEGORY,
  type CalendarSyncPort,
  type ProviderCalendar,
  type ProviderChangeWatch,
  type ProviderChangeWatchRequest,
  type ProviderEventPresence,
  type ProviderEventReceipt,
  type ProviderEventSnapshot,
  type ProviderEventWrite,
  type ProviderWrittenEvents,
} from "@magna-carta/calendar/sync-port";
import {
  addCalendarDays,
  civilDateParts,
  type CivilDate,
} from "@magna-carta/civil-time/civil-date";
import { weekdayOf, weekdayPositionOf, type WeekdayCode } from "@magna-carta/civil-time/recurrence";
import { zonedReading } from "@magna-carta/civil-time/time-zone";
import { adapterError, ok, type Dispatch } from "@magna-carta/integrations/dispatch";
import type { HttpClient, HttpResponse } from "@magna-carta/integrations/http";
import type { Adapter, AdapterContext, CapabilityDescriptor } from "@magna-carta/integrations/port";
import { integrationProblem, type IntegrationProblem } from "@magna-carta/integrations/problem";

// The calendar sync port over Microsoft Graph, with plain requests and no vendor library.

export const MICROSOFT_CALENDAR_ADAPTER_ID = "microsoft-graph";

const GRAPH_ORIGIN = "https://graph.microsoft.com";

// A member with more calendars than this has a list no settings page can usefully show, and a
// provider that keeps handing out next links must not hold a request open for ever.
const CALENDAR_PAGE_LIMIT = 10;

const descriptor: CapabilityDescriptor = {
  adapterId: MICROSOFT_CALENDAR_ADAPTER_ID,
  category: CALENDAR_SYNC_CATEGORY,
  credential: { kind: "oauth", scope: "user" },
  operations: {
    listCalendars: { supported: true },
    createEvent: { supported: true },
    updateEvent: { supported: true },
    deleteEvent: { supported: true },
    listWrittenEvents: { supported: true },
    readEvent: { supported: true },
    watchChanges: { supported: true },
    renewWatch: { supported: true },
    stopWatch: { supported: true },
  },
  passthroughAvailable: false,
};

const calendarPageSchema = z.object({
  value: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      canEdit: z.boolean().optional(),
      isDefaultCalendar: z.boolean().optional(),
    }),
  ),
  "@odata.nextLink": z.string().optional(),
});

const eventReceiptSchema = z.object({
  id: z.string().min(1),
  changeKey: z.string().optional(),
});

const subscriptionSchema = z.object({
  id: z.string().min(1),
  expirationDateTime: z.string().min(1),
});

// The mark every copy carries, so the copies can be asked for by themselves. It is a named property
// in a property set of this platform's own; the member never sees it. Reading back only what
// carries it is what keeps a pass from ever being handed an event the member made themselves.
export const WRITTEN_COPY_PROPERTY_ID =
  "String {a163d651-92cc-44f8-ba32-76f5625f9f82} Name MagnaCartaCopy";
const WRITTEN_COPY_PROPERTY_VALUE = "1";

// A member with more copies than this is past what one pass will read; the list says it stopped
// short, and the caller then concludes nothing from a copy being absent.
const WRITTEN_EVENT_PAGE_LIMIT = 30;

const SNAPSHOT_FIELDS = "id,changeKey,subject,location,isAllDay,start,end";

const graphMomentSchema = z.object({ dateTime: z.string(), timeZone: z.string().optional() });

const eventSnapshotSchema = z.object({
  id: z.string().min(1),
  changeKey: z.string().optional(),
  subject: z.string().nullable().optional(),
  location: z.object({ displayName: z.string().nullable().optional() }).nullable().optional(),
  isAllDay: z.boolean().optional(),
  start: graphMomentSchema,
  end: graphMomentSchema,
});

const eventSnapshotPageSchema = z.object({
  value: z.array(eventSnapshotSchema),
  "@odata.nextLink": z.string().optional(),
});

const GRAPH_MOMENT_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/;

// A copy as Graph answers it, in the calendar's terms, or undefined when the answer is not one this
// adapter can read. Graph answers in UTC unless a request asks otherwise, and no request here does;
// a moment in any other zone is refused instead of being read as if it were UTC.
//
// A whole-day event ends at the midnight AFTER its last day, so the last day is the day before.
export function snapshotOfGraphEvent(
  event: z.infer<typeof eventSnapshotSchema>,
): ProviderEventSnapshot | undefined {
  const start = GRAPH_MOMENT_PATTERN.exec(event.start.dateTime);
  const end = GRAPH_MOMENT_PATTERN.exec(event.end.dateTime);
  if (start === null || end === null) return undefined;
  const [, startDay, startClock] = start;
  const [, endDay, endClock] = end;
  if (
    startDay === undefined ||
    startClock === undefined ||
    endDay === undefined ||
    endClock === undefined
  ) {
    return undefined;
  }
  const location = event.location?.displayName ?? null;
  const base = {
    remoteId: event.id,
    versionTag: event.changeKey ?? null,
    title: event.subject ?? "",
    location: location === null || location.trim() === "" ? null : location,
  };
  if (event.isAllDay === true) {
    const lastDay = endDay > startDay ? addCalendarDays(endDay as CivilDate, -1) : startDay;
    return { ...base, when: { kind: "days", startsOn: startDay, endsOn: lastDay } };
  }
  const inUtc = (zone: string | undefined): boolean => zone === undefined || zone === "UTC";
  if (!inUtc(event.start.timeZone) || !inUtc(event.end.timeZone)) return undefined;
  const startsAtMilliseconds = Date.parse(`${startDay}T${startClock}.000Z`);
  const endsAtMilliseconds = Date.parse(`${endDay}T${endClock}.000Z`);
  if (Number.isNaN(startsAtMilliseconds) || Number.isNaN(endsAtMilliseconds)) return undefined;
  return { ...base, when: { kind: "instants", startsAtMilliseconds, endsAtMilliseconds } };
}

const GRAPH_WEEKDAYS: Record<WeekdayCode, string> = {
  SU: "sunday",
  MO: "monday",
  TU: "tuesday",
  WE: "wednesday",
  TH: "thursday",
  FR: "friday",
  SA: "saturday",
};
const GRAPH_WEEK_INDEXES = ["first", "second", "third", "fourth"] as const;

// The last day of the month every month has. A rule on a later day is one where two calendars
// disagree about February.
const LAST_DAY_EVERY_MONTH_HAS = 28;

// A series as Microsoft Graph repeats it, or null where Graph cannot be relied on to put it on
// exactly the days this platform does. Undefined for an event that happens once.
//
// THE CASES REFUSED ARE THE ONES WHERE THE TWO READINGS OF A RULE PART WAYS. This platform skips a
// month that has no 31st and no fifth Tuesday, and counts the first day of a weekly series even
// when it is not one of the rule's weekdays. Graph's documentation promises neither, so a series
// like that is refused here and the member is told it was not sent. Everything else maps one to
// one: the same interval, the same weekdays in a week that begins on Sunday (as the expansion in
// @magna-carta/civil-time/recurrence counts it), the same end.
export function graphRecurrenceOf(
  event: ProviderEventWrite,
): Record<string, unknown> | null | undefined {
  const repeats = event.repeats;
  if (repeats === null || repeats === undefined) return undefined;
  const rule = repeats.rule;
  if (rule === null) return null;
  const start = civilDateParts(event.startsOn);
  const startWeekday = weekdayOf(event.startsOn);

  let pattern: Record<string, unknown>;
  if (rule.frequency === "daily") {
    pattern = { type: "daily", interval: rule.interval };
  } else if (rule.frequency === "weekly") {
    const weekdays = rule.weekdays.length > 0 ? rule.weekdays : [startWeekday];
    if (!weekdays.includes(startWeekday)) return null;
    pattern = {
      type: "weekly",
      interval: rule.interval,
      daysOfWeek: weekdays.map((code) => GRAPH_WEEKDAYS[code]),
      firstDayOfWeek: "sunday",
    };
  } else if (rule.frequency === "monthly" && rule.monthly === "byWeekday") {
    const index = GRAPH_WEEK_INDEXES[weekdayPositionOf(event.startsOn) - 1];
    if (index === undefined) return null;
    pattern = {
      type: "relativeMonthly",
      interval: rule.interval,
      daysOfWeek: [GRAPH_WEEKDAYS[startWeekday]],
      index,
    };
  } else {
    if (start.day > LAST_DAY_EVERY_MONTH_HAS) return null;
    pattern =
      rule.frequency === "monthly"
        ? { type: "absoluteMonthly", interval: rule.interval, dayOfMonth: start.day }
        : {
            type: "absoluteYearly",
            interval: rule.interval,
            dayOfMonth: start.day,
            month: start.month,
          };
  }

  const range =
    rule.end.kind === "after"
      ? { type: "numbered", startDate: event.startsOn, numberOfOccurrences: rule.end.count }
      : rule.end.kind === "on"
        ? { type: "endDate", startDate: event.startsOn, endDate: rule.end.date }
        : { type: "noEnd", startDate: event.startsOn };
  return { pattern, range: { ...range, recurrenceTimeZone: event.timeZone } };
}

const UNREPEATABLE = "Outlook cannot repeat this event on exactly the same days";

// The event as Microsoft Graph takes it.
//
// Graph requires an event that takes the whole day to start and end at midnight in one zone, with
// the end being the midnight AFTER the last day. Magna Carta holds the last day itself, so the end
// moves one day on. A timed event with no end is sent ending when it starts: that is what was
// recorded, and inventing an hour would put a duration in a calendar that nobody decided on.
//
// No attendees are ever sent. An event with attendees is a meeting request, which emails them.
//
// A series carries its rule; a caller checks `graphRecurrenceOf` first and never sends one whose
// rule came back null.
export function graphEventBody(event: ProviderEventWrite): Record<string, unknown> {
  const recurrence = graphRecurrenceOf(event);
  const lastDay = event.endsOn ?? event.startsOn;
  const allDay = event.startsAtTime === null;
  const start = allDay
    ? `${event.startsOn}T00:00:00`
    : `${event.startsOn}T${event.startsAtTime}:00`;
  const end = allDay
    ? `${addCalendarDays(lastDay as CivilDate, 1)}T00:00:00`
    : `${lastDay}T${event.endsAtTime ?? event.startsAtTime}:00`;
  return {
    subject: event.title,
    body: { contentType: "text", content: event.notes ?? "" },
    location: { displayName: event.location ?? "" },
    isAllDay: allDay,
    start: { dateTime: start, timeZone: event.timeZone },
    end: { dateTime: end, timeZone: event.timeZone },
    singleValueExtendedProperties: [
      { id: WRITTEN_COPY_PROPERTY_ID, value: WRITTEN_COPY_PROPERTY_VALUE },
    ],
    ...(recurrence === undefined || recurrence === null ? {} : { recurrence }),
  };
}

function problemFor(status: number): IntegrationProblem {
  if (status === 401) return integrationProblem("auth", 401, "Microsoft refused the access token");
  if (status === 429)
    return integrationProblem("rate_limit", 429, "Microsoft is limiting requests");
  if (status >= 500) return integrationProblem("upstream", 502, `Microsoft responded ${status}`);
  return integrationProblem("validation", status, `Microsoft responded ${status}`);
}

export interface MicrosoftCalendarAdapterDependencies {
  readonly http: HttpClient;
}

export function createMicrosoftCalendarAdapter(
  dependencies: MicrosoftCalendarAdapterDependencies,
): Adapter<CalendarSyncPort> {
  return {
    descriptor,
    create(context: AdapterContext): CalendarSyncPort {
      const credential = context.credential;
      if (credential?.kind !== "oauth" || credential.accessToken === undefined) {
        throw new Error(
          "The Microsoft calendar adapter requires a signed-in account's access token",
        );
      }
      const headers = {
        Authorization: `Bearer ${credential.accessToken}`,
        // An Outlook item's ordinary identifier changes when the item moves between folders. The
        // immutable form does not, and a link row has to keep pointing at the same thing.
        Prefer: 'IdType="ImmutableId"',
      };

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
          return adapterError(integrationProblem("network", 503, "Microsoft could not be reached"));
        }
      }

      const unreachable = (): Dispatch<never> =>
        adapterError(integrationProblem("network", 503, "Microsoft could not be reached"));
      const unreadable = (what: string): Dispatch<never> =>
        adapterError(integrationProblem("validation", 502, `${what} could not be read`));

      async function readJson(response: HttpResponse): Promise<unknown> {
        try {
          return await response.json();
        } catch {
          return undefined;
        }
      }

      // Takes the days a series must not fall on out of the provider's series, one occurrence at a
      // time. A provider's series has no list of skipped days to send; an occurrence is removed by
      // deleting it. Asked for with a day either side, because the provider is not documented to
      // read an unzoned range in any particular zone, and each occurrence found is placed on its
      // own day in the event's zone before it is touched. Removing one already removed finds
      // nothing and does nothing, so this is safe to repeat after every write.
      async function removeSkippedDays(
        remoteId: string,
        event: ProviderEventWrite,
      ): Promise<Dispatch<null>> {
        for (const day of event.repeats?.skippedDays ?? []) {
          const from = addCalendarDays(day as CivilDate, -1);
          const to = addCalendarDays(day as CivilDate, 2);
          let response;
          try {
            response = await dependencies.http.request({
              method: "GET",
              url:
                `${GRAPH_ORIGIN}/v1.0/me/events/${encodeURIComponent(remoteId)}/instances` +
                `?startDateTime=${from}T00:00:00&endDateTime=${to}T00:00:00` +
                `&$select=${SNAPSHOT_FIELDS}&$top=50`,
              headers,
            });
          } catch {
            return unreachable();
          }
          if (response.status === 404) return ok(null);
          if (response.status >= 400) return adapterError(problemFor(response.status));
          const parsed = eventSnapshotPageSchema.safeParse(await readJson(response));
          if (!parsed.success) return unreadable("Microsoft's list of a series' days");
          for (const occurrence of parsed.data.value) {
            const snapshot = snapshotOfGraphEvent(occurrence);
            if (snapshot === undefined) return unreadable("A day of a series");
            const fallsOn =
              snapshot.when.kind === "days"
                ? snapshot.when.startsOn
                : zonedReading(snapshot.when.startsAtMilliseconds, event.timeZone).civilDate;
            if (fallsOn !== day) continue;
            const removed = await send(
              "DELETE",
              `${GRAPH_ORIGIN}/v1.0/me/events/${encodeURIComponent(snapshot.remoteId)}`,
              undefined,
            );
            if (!removed.ok) return removed;
            if (removed.value.status >= 400 && removed.value.status !== 404) {
              return adapterError(problemFor(removed.value.status));
            }
          }
        }
        return ok(null);
      }

      async function readReceipt(
        response: HttpResponse,
      ): Promise<z.infer<typeof eventReceiptSchema> | undefined> {
        try {
          const parsed = eventReceiptSchema.safeParse(await response.json());
          return parsed.success ? parsed.data : undefined;
        } catch {
          return undefined;
        }
      }

      return {
        async listCalendars(): Promise<Dispatch<readonly ProviderCalendar[]>> {
          const calendars: ProviderCalendar[] = [];
          let url: string | undefined = `${GRAPH_ORIGIN}/v1.0/me/calendars?$top=100`;
          for (let page = 0; page < CALENDAR_PAGE_LIMIT && url !== undefined; page += 1) {
            let response;
            try {
              response = await dependencies.http.request({ method: "GET", url, headers });
            } catch {
              return adapterError(
                integrationProblem("network", 503, "Microsoft could not be reached"),
              );
            }
            if (response.status >= 400) return adapterError(problemFor(response.status));
            let parsed;
            try {
              parsed = calendarPageSchema.safeParse(await response.json());
            } catch {
              parsed = undefined;
            }
            if (parsed === undefined || !parsed.success) {
              return adapterError(
                integrationProblem(
                  "validation",
                  502,
                  "Microsoft's calendar list could not be read",
                ),
              );
            }
            for (const calendar of parsed.data.value) {
              calendars.push({
                remoteId: calendar.id,
                name: calendar.name,
                isDefault: calendar.isDefaultCalendar === true,
                canWrite: calendar.canEdit === true,
              });
            }
            // The access token goes wherever this address points, so a next link is followed only
            // back to the service that issued it.
            const next = parsed.data["@odata.nextLink"];
            url = next !== undefined && next.startsWith(`${GRAPH_ORIGIN}/`) ? next : undefined;
          }
          return ok(calendars);
        },

        async createEvent(
          calendarRemoteId: string,
          event: ProviderEventWrite,
          transactionId: string,
        ): Promise<Dispatch<ProviderEventReceipt>> {
          if (graphRecurrenceOf(event) === null) {
            return adapterError(integrationProblem("validation", 422, UNREPEATABLE));
          }
          const sent = await send(
            "POST",
            `${GRAPH_ORIGIN}/v1.0/me/calendars/${encodeURIComponent(calendarRemoteId)}/events`,
            { ...graphEventBody(event), transactionId },
          );
          if (!sent.ok) return sent;
          if (sent.value.status >= 400) return adapterError(problemFor(sent.value.status));
          const receipt = await readReceipt(sent.value);
          if (receipt === undefined) {
            return adapterError(
              integrationProblem(
                "validation",
                502,
                "Microsoft's answer to a new event could not be read",
              ),
            );
          }
          const skipped = await removeSkippedDays(receipt.id, event);
          if (!skipped.ok) return skipped;
          return ok({ remoteId: receipt.id, versionTag: receipt.changeKey ?? null });
        },

        async updateEvent(
          remoteId: string,
          event: ProviderEventWrite,
        ): Promise<Dispatch<ProviderEventPresence>> {
          const recurrence = graphRecurrenceOf(event);
          if (recurrence === null) {
            return adapterError(integrationProblem("validation", 422, UNREPEATABLE));
          }
          const sent = await send(
            "PATCH",
            `${GRAPH_ORIGIN}/v1.0/me/events/${encodeURIComponent(remoteId)}`,
            // An event that happens once says so, because the copy may have been a series when it
            // was last written and a PATCH leaves alone whatever it does not name.
            { ...graphEventBody(event), ...(recurrence === undefined ? { recurrence: null } : {}) },
          );
          if (!sent.ok) return sent;
          if (sent.value.status === 404) return ok({ found: false });
          if (sent.value.status >= 400) return adapterError(problemFor(sent.value.status));
          const receipt = await readReceipt(sent.value);
          // Changing a series' rule gives it back the days taken out of it, so they are taken out
          // again after every write.
          const skipped = await removeSkippedDays(remoteId, event);
          if (!skipped.ok) return skipped;
          return ok({ found: true, versionTag: receipt?.changeKey ?? null });
        },

        async deleteEvent(remoteId: string): Promise<Dispatch<null>> {
          const sent = await send(
            "DELETE",
            `${GRAPH_ORIGIN}/v1.0/me/events/${encodeURIComponent(remoteId)}`,
            undefined,
          );
          if (!sent.ok) return sent;
          // Already gone is what the caller asked for.
          if (sent.value.status === 404) return ok(null);
          if (sent.value.status >= 400) return adapterError(problemFor(sent.value.status));
          return ok(null);
        },

        async listWrittenEvents(): Promise<Dispatch<ProviderWrittenEvents>> {
          const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${WRITTEN_COPY_PROPERTY_ID}' and ep/value eq '${WRITTEN_COPY_PROPERTY_VALUE}')`;
          const events: ProviderEventSnapshot[] = [];
          let url: string | undefined =
            `${GRAPH_ORIGIN}/v1.0/me/events?$filter=${encodeURIComponent(filter)}` +
            `&$select=${SNAPSHOT_FIELDS}&$top=100`;
          for (let page = 0; page < WRITTEN_EVENT_PAGE_LIMIT && url !== undefined; page += 1) {
            let response;
            try {
              response = await dependencies.http.request({ method: "GET", url, headers });
            } catch {
              return unreachable();
            }
            if (response.status >= 400) return adapterError(problemFor(response.status));
            const parsed = eventSnapshotPageSchema.safeParse(await readJson(response));
            if (!parsed.success) return unreadable("Microsoft's list of events");
            for (const event of parsed.data.value) {
              const snapshot = snapshotOfGraphEvent(event);
              if (snapshot === undefined) return unreadable("An event in Microsoft's list");
              events.push(snapshot);
            }
            const next = parsed.data["@odata.nextLink"];
            url = next !== undefined && next.startsWith(`${GRAPH_ORIGIN}/`) ? next : undefined;
          }
          return ok({ events, complete: url === undefined });
        },

        async watchChanges(
          request: ProviderChangeWatchRequest,
        ): Promise<Dispatch<ProviderChangeWatch>> {
          const sent = await send("POST", `${GRAPH_ORIGIN}/v1.0/subscriptions`, {
            changeType: "created,updated,deleted",
            resource: "me/events",
            notificationUrl: request.address,
            // The same address hears that a watch was removed or that notices were missed, which
            // are told apart from a change by their own field.
            lifecycleNotificationUrl: request.address,
            clientState: request.secret,
            // Graph keeps a subscription to a calendar's events for a little under seven days at
            // most and refuses a longer one; the caller asks for less than that.
            expirationDateTime: request.expiresAt,
          });
          if (!sent.ok) return sent;
          if (sent.value.status >= 400) return adapterError(problemFor(sent.value.status));
          const parsed = subscriptionSchema.safeParse(await readJson(sent.value));
          if (!parsed.success) return unreadable("Microsoft's answer to a new subscription");
          return ok({ watchId: parsed.data.id, expiresAt: parsed.data.expirationDateTime });
        },

        async renewWatch(
          watchId: string,
          expiresAt: string,
        ): Promise<Dispatch<ProviderChangeWatch | null>> {
          const sent = await send(
            "PATCH",
            `${GRAPH_ORIGIN}/v1.0/subscriptions/${encodeURIComponent(watchId)}`,
            { expirationDateTime: expiresAt },
          );
          if (!sent.ok) return sent;
          if (sent.value.status === 404) return ok(null);
          if (sent.value.status >= 400) return adapterError(problemFor(sent.value.status));
          const parsed = subscriptionSchema.safeParse(await readJson(sent.value));
          if (!parsed.success) return unreadable("Microsoft's answer to a renewed subscription");
          return ok({ watchId: parsed.data.id, expiresAt: parsed.data.expirationDateTime });
        },

        async stopWatch(watchId: string): Promise<Dispatch<null>> {
          const sent = await send(
            "DELETE",
            `${GRAPH_ORIGIN}/v1.0/subscriptions/${encodeURIComponent(watchId)}`,
            undefined,
          );
          if (!sent.ok) return sent;
          if (sent.value.status === 404) return ok(null);
          if (sent.value.status >= 400) return adapterError(problemFor(sent.value.status));
          return ok(null);
        },

        async readEvent(remoteId: string): Promise<Dispatch<ProviderEventSnapshot | null>> {
          let response;
          try {
            response = await dependencies.http.request({
              method: "GET",
              url: `${GRAPH_ORIGIN}/v1.0/me/events/${encodeURIComponent(remoteId)}?$select=${SNAPSHOT_FIELDS}`,
              headers,
            });
          } catch {
            return unreachable();
          }
          if (response.status === 404) return ok(null);
          if (response.status >= 400) return adapterError(problemFor(response.status));
          const parsed = eventSnapshotSchema.safeParse(await readJson(response));
          const snapshot = parsed.success ? snapshotOfGraphEvent(parsed.data) : undefined;
          if (snapshot === undefined) return unreadable("Microsoft's answer for an event");
          return ok(snapshot);
        },
      };
    },
  };
}
