import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerCalendarRoutes } from "./calendar.ts";
import { registerCalendarSeriesRoutes } from "./series.ts";

// The case calendar and the matter timeline it federates.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/http/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
export function mountCalendar(
  app: AppRouter,
  chokepoint: Chokepoint,
  _deps: DomainDeps = {},
): void {
  const domain = createDomainApp();
  // The case calendar: litigation events and deadlines recorded here, plus the matter timeline that
  // federates them with what every other subsystem already recorded — read in place, never copied.
  registerCalendarRoutes(domain, chokepoint);
  // Repeating settings: the days a series falls on in a window, and one day of it changed.
  registerCalendarSeriesRoutes(domain, chokepoint);
  app.route("/", domain);
}
