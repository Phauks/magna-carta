import { z } from "zod";
import {
  CALENDAR_SYNC_CATEGORY,
  type CalendarSyncPort,
  type ProviderCalendar,
  type ProviderEventPresence,
  type ProviderEventReceipt,
  type ProviderEventWrite,
} from "@magna-carta/calendar/sync-port";
import { addCalendarDays, type CivilDate } from "@magna-carta/civil-time/civil-date";
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

// The event as Microsoft Graph takes it.
//
// Graph requires an event that takes the whole day to start and end at midnight in one zone, with
// the end being the midnight AFTER the last day. Magna Carta holds the last day itself, so the end
// moves one day on. A timed event with no end is sent ending when it starts: that is what was
// recorded, and inventing an hour would put a duration in a calendar that nobody decided on.
//
// No attendees are ever sent. An event with attendees is a meeting request, which emails them.
export function graphEventBody(event: ProviderEventWrite): Record<string, unknown> {
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
          return ok({ remoteId: receipt.id, versionTag: receipt.changeKey ?? null });
        },

        async updateEvent(
          remoteId: string,
          event: ProviderEventWrite,
        ): Promise<Dispatch<ProviderEventPresence>> {
          const sent = await send(
            "PATCH",
            `${GRAPH_ORIGIN}/v1.0/me/events/${encodeURIComponent(remoteId)}`,
            graphEventBody(event),
          );
          if (!sent.ok) return sent;
          if (sent.value.status === 404) return ok({ found: false });
          if (sent.value.status >= 400) return adapterError(problemFor(sent.value.status));
          const receipt = await readReceipt(sent.value);
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
      };
    },
  };
}
