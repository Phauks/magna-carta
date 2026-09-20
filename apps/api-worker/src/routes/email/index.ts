import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerAutoFileRuleRoutes } from "./auto-file-rules.ts";
import { registerCaptureAddressRoutes } from "./capture-addresses.ts";
import { registerEmailAddInRoutes } from "./email-add-in.ts";
import { registerEmailInspectorRoutes } from "./email-inspector.ts";
import { registerEmailsRoutes } from "./emails.ts";

// Filed email: capture addresses, the mailbox add-in, auto-file rules, the inspector, and the filed messages themselves.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
export function mountEmail(app: AppRouter, chokepoint: Chokepoint, _deps: DomainDeps = {}): void {
  const domain = createDomainApp();
  registerEmailInspectorRoutes(domain, chokepoint);
  // The mail-client surface — matter suggestions, capture status, the member's filing context.
  // Registered BEFORE registerEmailsRoutes deliberately: that bundle owns /api/v1/emails/{id}, and a
  // parameterized route registered first swallows the static siblings on its prefix.
  registerEmailAddInRoutes(domain, chokepoint);
  // The auto-file rule management surface. Registered here for the same reason the add-in bundle is:
  // it owns the static /api/v1/emails/auto-file-review, which a parameterized /api/v1/emails/{id}
  // registered first would swallow.
  registerAutoFileRuleRoutes(domain, chokepoint);
  registerEmailsRoutes(domain, chokepoint);
  // The writer for the forward/CC token index: minting an address is what makes a capture token
  // resolve to a firm and a matter. Registered beside the emails surface it feeds.
  registerCaptureAddressRoutes(domain, chokepoint);
  app.route("/", domain);
}
