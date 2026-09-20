import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerMyDayRoutes } from "./my-day.ts";
import { registerNotesRoutes } from "./notes.ts";
import { registerTasksRoutes } from "./tasks.ts";

// Notes, tasks and the timekeeper's My Day headline.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
export function mountNotesAndTasks(
  app: AppRouter,
  chokepoint: Chokepoint,
  _deps: DomainDeps = {},
): void {
  const domain = createDomainApp();
  // The matter note: what the firm wrote down about a case that no other record holds. Corrected by
  // appending a revision, withdrawn by retraction, and never deleted — there is no delete route here
  // because there is no delete path anywhere in the subsystem.
  registerNotesRoutes(domain, chokepoint);
  registerTasksRoutes(domain, chokepoint);
  // My Day: daily headline totals (billable, non-billable, target, shortfall).
  registerMyDayRoutes(domain, chokepoint);
  app.route("/", domain);
}
