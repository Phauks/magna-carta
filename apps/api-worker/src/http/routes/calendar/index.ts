import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { requestCalendarSync } from "../../../calendar-sync/request-sync.ts";
import {
  optionalChokepointFirmContext,
  optionalChokepointFirmId,
} from "../../chokepoint/context-accessors.ts";
import { runInBackground } from "../../deferred-work.ts";
import { registerCalendarRoutes } from "./calendar.ts";
import { registerConnectedAccountsRoutes } from "./connected-accounts.ts";
import { registerCalendarSeriesRoutes } from "./series.ts";
import { registerCalendarSyncSettingsRoutes } from "./sync-settings.ts";

// The case calendar and the matter timeline it federates.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/http/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
// The paths whose writes can change what belongs in a member's own calendar at their provider: an
// event, a firm event or a deadline recorded, changed or cancelled; an event type switched off; a
// member's rules or the firm's limits saved. Named one by one because this router is mounted at the
// root, where a wildcard would run on every request the Worker serves.
const SYNC_AFFECTING_PATHS = [
  "/api/v1/events/*",
  "/api/v1/firm-events",
  "/api/v1/firm-events/*",
  "/api/v1/deadlines/*",
  "/api/v1/matters/:matterId/events",
  "/api/v1/matters/:matterId/deadlines",
  "/api/v1/calendar/event-types/*",
  "/api/v1/calendar-sync/*",
  "/api/v1/me/calendar-sync/*",
] as const;

export function mountCalendar(app: AppRouter, chokepoint: Chokepoint, deps: DomainDeps = {}): void {
  const domain = createDomainApp();
  // After a write on one of those paths succeeds, every connected account with a rule is asked to
  // look again. It runs behind the response and never changes it; an account that finds nothing
  // different sends its provider nothing. Registered ahead of the routes so it wraps them, and it
  // reads the firm only after the chokepoint has resolved one.
  for (const path of SYNC_AFFECTING_PATHS) {
    domain.use(path, async (c, next) => {
      await next();
      if (c.req.method === "GET" || c.res.status >= 400) return;
      const firmId = optionalChokepointFirmId(c);
      const firmContext = optionalChokepointFirmContext(c);
      if (firmId === undefined || firmContext === undefined) return;
      runInBackground(
        c,
        requestCalendarSync(c.env, firmId, firmContext.firmDatabase).catch(() => undefined),
      );
    });
  }
  // The case calendar: litigation events and deadlines recorded here, plus the matter timeline that
  // federates them with what every other subsystem already recorded — read in place, never copied.
  registerCalendarRoutes(domain, chokepoint);
  // A member's own account at a calendar provider: connecting it, listing it and disconnecting it.
  registerConnectedAccountsRoutes(domain, chokepoint, deps.connectedAccounts);
  // What the firm lets leave for those accounts, and which event types each member sends where.
  registerCalendarSyncSettingsRoutes(domain, chokepoint, deps.connectedAccounts);
  // Repeating settings: the days a series falls on in a window, and one day of it changed.
  registerCalendarSeriesRoutes(domain, chokepoint);
  app.route("/", domain);
}
