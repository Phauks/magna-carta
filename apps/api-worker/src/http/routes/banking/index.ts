import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerBankingConnectionRoutes } from "./banking-connections.ts";
import { registerBankingReadRoutes } from "./banking-reads.ts";

// Banking: what the firm's banks report about its operating and trust accounts, through the bank
// feed provider, set beside the books. Read only toward the books: nothing here posts.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/http/routes/manifest.ts). The order inside this function is the order Hono matches in.
export function mountBanking(app: AppRouter, chokepoint: Chokepoint, deps: DomainDeps = {}): void {
  const domain = createDomainApp();
  registerBankingReadRoutes(domain, chokepoint, deps.banking ?? {});
  registerBankingConnectionRoutes(domain, chokepoint, deps.banking ?? {});
  app.route("/", domain);
}
