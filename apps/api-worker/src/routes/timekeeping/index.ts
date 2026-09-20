import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerFeesRoutes } from "./fees.ts";
import { registerNarrativeTemplatesRoutes } from "./narrative-templates.ts";
import { registerNonBillableCategoriesRoutes } from "./non-billable-categories.ts";
import { registerRateCardsRoutes } from "./rate-cards.ts";
import { registerTimeEntriesRoutes } from "./time-entries.ts";
import { registerTimerRoutes } from "./timer.ts";
import { registerUtbmsCodesRoutes } from "./utbms-codes.ts";

// Time tracking: entries, the live timer, rate cards, the code and category catalogs, narrative templates, and fees.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
export function mountTimekeeping(
  app: AppRouter,
  chokepoint: Chokepoint,
  _deps: DomainDeps = {},
): void {
  const domain = createDomainApp();
  registerFeesRoutes(domain, chokepoint);
  // Time tracking — the work-in-progress entry surface, composed through the same chokepoint.
  registerTimeEntriesRoutes(domain, chokepoint);
  // Timer routes: the per-timekeeper live timer (DO proxy) and the idempotent stop-commit.
  registerTimerRoutes(domain, chokepoint);
  // Rate card management: create cards, append effective-dated rates, re-rate unbilled drafts.
  registerRateCardsRoutes(domain, chokepoint);
  // UTBMS code catalog: list and toggle enable/disable on the seeded ABA set.
  registerUtbmsCodesRoutes(domain, chokepoint);
  // Non-billable category management: create, rename, soft-archive.
  registerNonBillableCategoriesRoutes(domain, chokepoint);
  // Narrative template management: create, list, archive, and read recent narratives.
  registerNarrativeTemplatesRoutes(domain, chokepoint);
  app.route("/", domain);
}
