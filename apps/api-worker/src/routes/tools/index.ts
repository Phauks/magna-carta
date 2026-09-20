import { fetchHttpClient } from "@magna-carta/integrations/http";
import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerSafeBrowseSessionProbeRoute } from "./safe-browse-session-probe.ts";
import { registerSafeBrowseRoute, registerSafeBrowseStreamRoute } from "./safe-browse.ts";
import { registerToolsConnectionRoute } from "./tools-connection.ts";
import { registerToolsTurnCredentialsRoute } from "./tools-turn-credentials.ts";
import { registerWhoisRoute, type WhoisRouteDeps } from "./whois.ts";

// The Tools area: matter-grade work done without a matter — the connection and speed-test credentials, WHOIS, the safe browser.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
export function mountTools(app: AppRouter, chokepoint: Chokepoint, deps: DomainDeps = {}): void {
  const domain = createDomainApp();
  registerToolsConnectionRoute(domain, chokepoint);
  registerToolsTurnCredentialsRoute(domain, chokepoint);
  // The WHOIS route: RDAP-first domain/IP registration lookup with a port-43 fallback. All outbound
  // effects go through injected deps so tests substitute fakes without touching global fetch or sockets.
  // The production socket opens a raw TCP connection on port 43 via cloudflare:sockets connect().
  const productionWhoisSocket: WhoisRouteDeps["socket"] = {
    async query(host, request) {
      // Imported lazily: cloudflare:sockets is a Workers-only module, so a top-level import would
      // break Node-based tooling (the emit-openapi script loads this file outside the Worker runtime).
      const { connect } = await import("cloudflare:sockets");
      const socket = connect({ hostname: host, port: 43 });
      const writer = socket.writable.getWriter();
      await writer.write(new TextEncoder().encode(request));
      await writer.close();
      const reader = socket.readable.getReader();
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
      } finally {
        // cloudflare:sockets does not auto-close when the readable is exhausted; release the
        // reader lock first so close() can drain and tear down the underlying TCP connection.
        reader.releaseLock();
        await socket.close();
      }
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      return new TextDecoder().decode(merged);
    },
  };
  const whoisDeps: WhoisRouteDeps = {
    http: deps.whoisDeps?.http ?? fetchHttpClient(),
    socket: deps.whoisDeps?.socket ?? productionWhoisSocket,
    resolve: deps.whoisDeps?.resolve,
  };
  registerWhoisRoute(domain, chokepoint, whoisDeps);
  // The safe-browse route: renders a suspect URL in an isolated remote browser and returns a
  // static snapshot. All outbound effects go through injected deps so tests substitute fakes
  // without touching the BROWSER binding. Production: createBrowserRenderer(c.env.BROWSER) +
  // createFetchRedirectProbe() — built lazily in the handler, never at startup.
  registerSafeBrowseRoute(domain, chokepoint, deps.safeBrowseDeps ?? {});
  registerSafeBrowseStreamRoute(domain, chokepoint, deps.safeBrowseDeps ?? {});
  registerSafeBrowseSessionProbeRoute(domain, chokepoint);
  app.route("/", domain);
}
