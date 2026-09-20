import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerIntakeRoutes } from "./intake.ts";
import { registerLocationsRoutes } from "./locations.ts";
import { registerMatterAssetRoutes } from "./matter-assets.ts";
import { registerMatterPlanRoutes } from "./matter-plans.ts";
import { registerMatterRecordsRoutes } from "./matter-records.ts";
import { registerMatterSearchRoutes } from "./matter-search.ts";
import { registerMattersRoutes } from "./matters.ts";

// The matter shell and everything that hangs on its identity: records, search, plans, intake, the asset register, and the firm's offices.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
export function mountMatters(app: AppRouter, chokepoint: Chokepoint, _deps: DomainDeps = {}): void {
  const domain = createDomainApp();
  // Slice 1·1: matters (shell + lifecycle), per-firm matter/document types, Locations, and the
  // numbering-scheme surface — each composed through the same chokepoint.
  registerMattersRoutes(domain, chokepoint);
  // The matter's identity records beyond the shell — staffing assignments, the court-case record,
  // and the estate record — plus the member professional profile documents read from.
  registerMatterRecordsRoutes(domain, chokepoint);
  registerLocationsRoutes(domain, chokepoint);
  registerMatterSearchRoutes(domain, chokepoint);
  registerMatterPlanRoutes(domain, chokepoint);
  registerIntakeRoutes(domain, chokepoint);
  // The matter asset register — what a client or an estate owns, kept on the matter: the asset row
  // and its class attributes, the append-only value history and its as-of reads, interests held by
  // directory entities, links to documents that stay ordinary matter files, and account numbers
  // sealed to their last four characters. Beside Custodian on purpose: the two are the register
  // pair, and the boundary between them (property in the client's ownership, against objects in the
  // firm's possession) is the first thing a reader of either one needs.
  registerMatterAssetRoutes(domain, chokepoint);
  app.route("/", domain);
}
