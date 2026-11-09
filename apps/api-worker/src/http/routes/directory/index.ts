import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerConflictsRoutes } from "./conflicts.ts";
import { registerDirectoryRoutes } from "./directory.ts";

// The directory of persons and organizations, and the conflicts-of-interest check run over it.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/http/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
export function mountDirectory(
  app: AppRouter,
  chokepoint: Chokepoint,
  _deps: DomainDeps = {},
): void {
  const domain = createDomainApp();
  // Slice 1·3: the directory (persons/organizations, names, sensitive identifiers, edges,
  // categories, search, merge, matter-party link) — composed through the same chokepoint.
  registerDirectoryRoutes(domain, chokepoint);
  // The conflicts-of-interest check surface: run a check against the directory corpus, read a
  // completed check back with its hits, and record a reviewer's disposition of a hit.
  registerConflictsRoutes(domain, chokepoint);
  app.route("/", domain);
}
