import { isVersionRequest, versionResponse } from "@magna-carta/build-identity/version-route";
import { setServiceIdentity } from "@magna-carta/telemetry/service-identity";
import { resolveStoredSecrets } from "@magna-carta/worker-secrets/stored-secrets";
import { boardApplication } from "./board-application.ts";
import { COMMUNITY_WORKER_SECRET_NAMES, type Bindings } from "./bindings.ts";
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
    // The handoff secret may be bound from the account's Secrets Store; the board reads a string.
    const response = own
      ? await application.fetch(
          request,
          await resolveStoredSecrets(environment, COMMUNITY_WORKER_SECRET_NAMES),
          context,
        )
      : await environment.ASSETS.fetch(request);
    return withBoardHeaders(response);
  },
} satisfies ExportedHandler<Bindings>;
