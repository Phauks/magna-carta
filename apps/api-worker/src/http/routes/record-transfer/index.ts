import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerTransferSourceFileRoutes } from "./files.ts";
import { registerTransferPassRoutes } from "./passes.ts";
import { registerTransferRunRoutes } from "./runs.ts";

// The record transfer: bringing a firm's records in from the system it is leaving. A run, the files
// given to it, and the passes made over them.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/http/routes/manifest.ts). Every route below registers through defineOpenAPIRoute and
// chokepointMiddleware, and the order inside this function is the order Hono matches in.
export function mountRecordTransfer(
  app: AppRouter,
  chokepoint: Chokepoint,
  _deps: DomainDeps = {},
): void {
  const domain = createDomainApp();
  registerTransferRunRoutes(domain, chokepoint);
  registerTransferSourceFileRoutes(domain, chokepoint);
  registerTransferPassRoutes(domain, chokepoint);
  app.route("/", domain);
}
