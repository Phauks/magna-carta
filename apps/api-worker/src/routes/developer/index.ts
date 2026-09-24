import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerDevR2UploadRoute } from "./dev-r2-upload.ts";
import { registerDevSeedRoute } from "./dev-seed.ts";
import { registerDevWebToolsDemoRoute } from "./dev-web-tools-demo.ts";

// Development-only surfaces, each answering a bare 404 in production.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
export function mountDeveloper(
  app: AppRouter,
  chokepoint: Chokepoint,
  _deps: DomainDeps = {},
): void {
  const domain = createDomainApp();
  // Throwaway dev-only demo page for the Websites & Domains tools (gated on DEV_DEMO_TOOLS; 404 in
  // production). A bare route, so it never enters the OpenAPI contract. Remove with the demo file.
  registerDevWebToolsDemoRoute(domain);
  // The development-only R2 upload target: stands in for direct-to-R2 uploads under `wrangler dev`
  // (where no presigned R2 host resolves and no R2 event fires). It serves its route only when the
  // real R2 S3 credential set is absent — the same fail-closed signal that makes presignerForEnv
  // return the dev presigner (routes/developer/dev-r2-upload.ts, presigner-wiring.ts) — so it answers a bare 404
  // in production. Behind the chokepoint (session -> files:upload) and validates the object key against
  // the firm's upload session. A bare route under /api/__dev, so it never enters the OpenAPI contract.
  registerDevR2UploadRoute(app, chokepoint);
  // The development-only firm seeder: stands up a complete signed-in-ready tenant (firm + owner user +
  // matter + files) so a developer can log in and see real data under `wrangler dev`. Gated on the same
  // real-credential absence as the dev upload route, so it answers a bare 404 in production. Outside the
  // chokepoint (it bootstraps the first user) and a bare route under /api/__dev, so it never enters the
  // OpenAPI contract.
  registerDevSeedRoute(domain);
  app.route("/", domain);
}
