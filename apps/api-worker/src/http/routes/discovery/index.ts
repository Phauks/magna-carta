import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerDiscoveryRoutes } from "./discovery.ts";

// Discovery: review sets, coding, and the review-document reads.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/http/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
export function mountDiscovery(
  app: AppRouter,
  chokepoint: Chokepoint,
  _deps: DomainDeps = {},
): void {
  const domain = createDomainApp();
  // Discovery — the corpus of documents under review on a matter: the review set, whose records are
  // in it, what was loaded and when, and the internal load lanes that resolve the firm's own files
  // and filed email into review documents without moving a byte. Its own permission namespace, so
  // matter access alone reaches nothing here.
  registerDiscoveryRoutes(domain, chokepoint);
  app.route("/", domain);
}
