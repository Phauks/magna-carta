import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerCustodyRoutes } from "./custody.ts";

// Custodian: the register of physical client originals the firm holds in safekeeping.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
export function mountCustody(app: AppRouter, chokepoint: Chokepoint, _deps: DomainDeps = {}): void {
  const domain = createDomainApp();
  // Custodian — the register of physical client originals the firm holds in safekeeping: the
  // container tree, packets and their items, Directory ownership, the append-only movement ledger,
  // holds, and scanned copies bound over ordinary File Manager files.
  registerCustodyRoutes(domain, chokepoint);
  app.route("/", domain);
}
