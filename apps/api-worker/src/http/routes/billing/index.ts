import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerBillingRoutes } from "./billing.ts";
import { registerCostsRoutes } from "./costs.ts";
import { registerReportExportRoutes } from "./report-exports.ts";
import { registerFinancialReportsRoutes } from "./financial-reports.ts";
import { registerReportsRoutes } from "./reports.ts";

// The invoice spine, costs, and the read-only reporting projections with their exports.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/http/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
export function mountBilling(app: AppRouter, chokepoint: Chokepoint, _deps: DomainDeps = {}): void {
  const domain = createDomainApp();
  registerReportExportRoutes(domain, chokepoint);
  // Costs / disbursements — the cost-entry WIP store, composed through the same chokepoint.
  registerCostsRoutes(domain, chokepoint);
  // Reporting — projections over records the firm already holds. Read-only by construction: the
  // reporting package composes nothing, and every route registered here is a GET.
  registerReportsRoutes(domain, chokepoint);
  registerFinancialReportsRoutes(domain, chokepoint);
  // Billing — the invoice spine: draft, claim work-in-progress, review the lines, finalize (the one
  // batch that draws the number, locks the work, and posts the receivable), and the reads over it.
  registerBillingRoutes(domain, chokepoint);
  app.route("/", domain);
}
