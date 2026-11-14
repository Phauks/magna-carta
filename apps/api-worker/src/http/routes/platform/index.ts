import { authForEnv } from "../../../auth-instance.ts";
import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerClientErrorsRoute } from "./client-errors.ts";
import { registerFirmsRoute } from "./firms.ts";
import { registerIncidentsRoute } from "./incidents.ts";
import { registerMetaDatabaseHealthRoute } from "./meta-database-health.ts";
import { registerMetaVersionsRoute } from "./meta-versions.ts";
import { registerPlatformErrorLookupRoute } from "./platform-error-lookup.ts";
import { registerPlatformReleaseChannelRoute } from "./platform-release-channel.ts";
import { registerPlatformRecentErrorsRoute } from "./platform-recent-errors.ts";
import { registerPlatformStatusRoute } from "./platform-status.ts";

// Platform plumbing: the public firms door and its alpha release-channel twin, the operator's status, recent-errors, error-lookup and incident surfaces, the browser-crash record, and the version and database-health probes.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/http/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
export function mountPlatform(
  app: AppRouter,
  chokepoint: Chokepoint,
  _deps: DomainDeps = {},
): void {
  const domain = createDomainApp();
  registerMetaVersionsRoute(domain, chokepoint);
  registerMetaDatabaseHealthRoute(domain, chokepoint);
  registerFirmsRoute(domain, chokepoint, authForEnv);
  registerPlatformReleaseChannelRoute(domain, chokepoint);
  registerPlatformStatusRoute(domain, chokepoint);
  registerPlatformRecentErrorsRoute(domain, chokepoint);
  registerPlatformErrorLookupRoute(domain, chokepoint);
  registerIncidentsRoute(domain, chokepoint);
  registerClientErrorsRoute(domain, chokepoint);
  app.route("/", domain);
}
