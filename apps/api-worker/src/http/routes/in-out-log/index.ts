import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerInOutLogRoutes } from "./entries.ts";

// The In/Out Log: what crosses the front desk that is not held in custody.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/http/routes/manifest.ts).
export function mountInOutLog(
  app: AppRouter,
  chokepoint: Chokepoint,
  _deps: DomainDeps = {},
): void {
  const domain = createDomainApp();
  registerInOutLogRoutes(domain, chokepoint);
  app.route("/", domain);
}
