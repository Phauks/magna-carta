import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerMagnusRoutes } from "./magnus.ts";
import { registerMagnusShelfRoutes } from "./shelf.ts";
import { registerMagnusTurnChangeRoutes } from "./turn-changes.ts";

// Magnus, the conversational assistant.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/http/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
export function mountMagnus(app: AppRouter, chokepoint: Chokepoint, _deps: DomainDeps = {}): void {
  const domain = createDomainApp();
  // Magnus — the conversational assistant: the conversation and turn record, the two fail-closed
  // consent gates, the submit-and-watch path, and the transcript reads. Every route here refuses
  // unless the firm has opened both gates, and the default adapter reaches no provider.
  registerMagnusRoutes(domain, chokepoint);
  // A member's own folders and pins for their conversations.
  registerMagnusShelfRoutes(domain, chokepoint);
  // Editing or removing one's own message.
  registerMagnusTurnChangeRoutes(domain, chokepoint);
  app.route("/", domain);
}
