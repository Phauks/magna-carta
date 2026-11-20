import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerPortalAccountRoutes } from "./portal-account.ts";

// The client portal: routes under /api/portal/v1/, reached only by a portal client and admitted
// through the chokepoint's portal lane (a firm-scoped route needs the client's own active membership
// in the firm its path names). What a client may see inside a firm is decided by what the firm has
// shared with them, never by a role.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/http/routes/manifest.ts).
export function mountPortal(app: AppRouter, chokepoint: Chokepoint, _deps: DomainDeps = {}): void {
  const domain = createDomainApp();
  registerPortalAccountRoutes(domain, chokepoint);
  app.route("/", domain);
}
