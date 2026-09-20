import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerSupportDiagnosticsRoute } from "./support-diagnostics.ts";
import { registerSupportGrantsRoutes } from "./support-grants.ts";
import { registerSupportSessionsRoute } from "./support-sessions.ts";

// Support access: grants, the staff session mint, and the diagnostics overview.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
export function mountSupport(app: AppRouter, chokepoint: Chokepoint, _deps: DomainDeps = {}): void {
  const domain = createDomainApp();
  // Support access — firm members request time-boxed help-desk access; the list gives all members
  // the transparency surface (who has or had access to their firm). Co-sign and revoke land in the
  // next task.
  registerSupportGrantsRoutes(domain, chokepoint);
  // Support sessions — a platform-staff principal redeems an active grant for a support-session
  // token. Public surface (platform-admin-key guard); the chokepoint applies the idempotency and
  // rate-limit gates.
  registerSupportSessionsRoute(domain, chokepoint);
  // Support diagnostics — the read-only firm system-state overview gated on diagnostics:overview,
  // a permission never seeded to any firm role. Only a diagnostic support session carries it.
  registerSupportDiagnosticsRoute(domain, chokepoint);
  app.route("/", domain);
}
