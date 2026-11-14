import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerTrustCheckStockRoutes } from "./trust-check-stock.ts";
import { registerTrustCheckRoutes } from "./trust-checks.ts";
import { registerTrustFirmFundsRoutes } from "./trust-firm-funds.ts";
import { registerTrustReconciliationRoutes } from "./trust-reconciliation.ts";
import { registerTrustUnclaimedFundsRoutes } from "./trust-unclaimed-funds.ts";
import { registerTrustRoutes } from "./trust.ts";

// Trust accounting: client money in, out and between matters, the firm's own carve-out, reconciliation, and unclaimed funds.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/http/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
export function mountTrust(app: AppRouter, chokepoint: Chokepoint, _deps: DomainDeps = {}): void {
  const domain = createDomainApp();
  // Trust accounting movements: client money into a matter's trust ledger, out of it, and
  // reallocated between two matters of one client, plus the client ledger those movements build.
  registerTrustRoutes(domain, chokepoint);
  registerTrustReconciliationRoutes(domain, chokepoint);
  // Check printing: the queue, the register, the stock and its scan. Printing moves no money.
  registerTrustCheckRoutes(domain, chokepoint);
  registerTrustCheckStockRoutes(domain, chokepoint);
  // The firm's OWN money in a trust account — the bank-charge carve-out, on its own capability and
  // in its own module, because firm money and client money never share a door.
  registerTrustFirmFundsRoutes(domain, chokepoint);
  // Unclaimed client funds: the dormancy read against a window the caller states, and the diligence
  // file that evidences the search. Nothing on that surface moves money.
  registerTrustUnclaimedFundsRoutes(domain, chokepoint);
  app.route("/", domain);
}
