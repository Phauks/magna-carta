import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
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
export function mountCalendar(app: AppRouter, chokepoint: Chokepoint, deps: DomainDeps = {}): void {
  const domain = createDomainApp();
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
