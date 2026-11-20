import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerBillingRoutes } from "./billing.ts";
import { registerChangeLogReportRoutes } from "./change-log-report.ts";
import { registerBillingGuideReportRoutes } from "./billing-guide-report.ts";
import { registerClientStatementReportRoutes } from "./client-statement-report.ts";
import { registerCostsRoutes } from "./costs.ts";
import { registerLedgerAccountRoutes } from "./ledger-accounts.ts";
import { registerVendorBillRoutes } from "./vendor-bills.ts";
import { registerReportExportRoutes } from "./report-exports.ts";
import { registerActivityReportsRoutes } from "./activity-reports.ts";
import { registerFinancialReportsRoutes } from "./financial-reports.ts";
import { registerMatterReportsRoutes } from "./matter-reports.ts";
import { registerReceivablesReportsRoutes } from "./receivables-reports.ts";
import { registerReportsRoutes } from "./reports.ts";
import { registerRevenueReportRoutes } from "./revenue-report.ts";

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
  // The operating books: the chart of accounts, the firm's own bank accounts, and vendor bills.
  registerLedgerAccountRoutes(domain, chokepoint);
  registerVendorBillRoutes(domain, chokepoint);
  // Reporting — projections over records the firm already holds. Read-only by construction: the
  // reporting package composes nothing, and every route registered here is a GET.
  registerReportsRoutes(domain, chokepoint);
  registerFinancialReportsRoutes(domain, chokepoint);
  registerActivityReportsRoutes(domain, chokepoint);
  registerReceivablesReportsRoutes(domain, chokepoint);
  registerMatterReportsRoutes(domain, chokepoint);
  registerChangeLogReportRoutes(domain, chokepoint);
  registerRevenueReportRoutes(domain, chokepoint);
  registerBillingGuideReportRoutes(domain, chokepoint);
  registerClientStatementReportRoutes(domain, chokepoint);
  // Billing — the invoice spine: draft, claim work-in-progress, review the lines, finalize (the one
  // batch that draws the number, locks the work, and posts the receivable), and the reads over it.
  registerBillingRoutes(domain, chokepoint);
  app.route("/", domain);
}
