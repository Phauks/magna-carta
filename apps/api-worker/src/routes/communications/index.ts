import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerCommunicationsRoutes } from "./communications.ts";

// The call and text log, and the shipping surface the carrier plugin mounts through this module's file.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
export function mountCommunications(
  app: AppRouter,
  chokepoint: Chokepoint,
  _deps: DomainDeps = {},
): void {
  const domain = createDomainApp();
  registerCommunicationsRoutes(domain, chokepoint);
  app.route("/", domain);
}
