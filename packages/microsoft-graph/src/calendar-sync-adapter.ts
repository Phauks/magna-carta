import { z } from "zod";
import {
  CALENDAR_SYNC_CATEGORY,
  type CalendarSyncPort,
  type ProviderCalendar,
} from "@magna-carta/calendar/sync-port";
import { adapterError, ok, type Dispatch } from "@magna-carta/integrations/dispatch";
import type { HttpClient } from "@magna-carta/integrations/http";
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
  operations: { listCalendars: { supported: true } },
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
      };
    },
  };
}
