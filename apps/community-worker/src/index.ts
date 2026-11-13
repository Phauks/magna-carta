import { isVersionRequest, versionResponse } from "@magna-carta/build-identity/version-route";
import { setServiceIdentity } from "@magna-carta/telemetry/service-identity";
import { boardApplication } from "./board-application.ts";
import type { Bindings } from "./bindings.ts";
import { withBoardHeaders } from "./respond.ts";

setServiceIdentity("cmy");

const application = boardApplication();

// Every request reaches this script first (run_worker_first in wrangler.jsonc), so the pages and
// their files carry the board's headers too. Only /api/ and /session/ are the board's own; the rest
// is the app's built interface, whose reroute hook shows the board's screens on this host.
export default {
  async fetch(request: Request, environment: Bindings, context: ExecutionContext) {
    // The build identity the app's aggregate version read probes. A commit and two timestamps,
    // which the app already shows to signed-out visitors; never cached.
    if (isVersionRequest(request)) {
      const version = versionResponse();
      version.headers.set("Cache-Control", "no-store");
      return withBoardHeaders(version);
    }
    const { pathname } = new URL(request.url);
    const own =
      pathname === "/session" || pathname.startsWith("/session/") || pathname.startsWith("/api/");
    const response = own
      ? await application.fetch(request, environment, context)
      : await environment.ASSETS.fetch(request);
    return withBoardHeaders(response);
  },
} satisfies ExportedHandler<Bindings>;
