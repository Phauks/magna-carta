import { getContainer } from "@cloudflare/containers";
import { isVersionRequest, versionResponse } from "@magna-carta/build-identity/version-route";
import { setServiceIdentity } from "@magna-carta/telemetry/service-identity";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import { withEditorDiagnostics } from "./diagnostics.ts";
import { DocumentEditorContainer } from "./document-editor-container.ts";
import { documentKeyFromHost } from "./document-routing.ts";
import { withoutEditorLogo } from "./editor-branding.ts";
import { allowAppFraming, appFrameAncestors } from "./embedding-policy.ts";

// The standalone in-app document editor worker. It owns the DocumentEditorContainer Durable Object
// (Container-backed) — ONE isolated coolwsd per open document. Two trust boundaries:
//   inbound  — the browser loads the editor (iframe + WebSocket) from this worker's cookieless origin;
//              authorization is the WOPI access token coolwsd validates against the host, NOT anything
//              this worker checks, so the proxy only routes to the right per-document container.
//   outbound — coolwsd's WOPI callbacks are intercepted by DocumentEditorContainer.outboundByHost and
//              forwarded to the app worker over APP_WORKER; enableInternet stays false.
// This Worker mints Error IDs of its own (diagnostics.ts), so it says which Worker it is before
// any of them are minted. Unlike the API Worker's entrypoint there is no startup budget to protect
// here — this module's import graph is already small.
setServiceIdentity("edt");

export type Bindings = {
  // The per-document coolwsd Container (Container-backed Durable Object). Named in wrangler.jsonc's
  // durable_objects.bindings + migrations; re-exported below so the runtime can instantiate it.
  DOCUMENT_EDITOR: DurableObjectNamespace<DocumentEditorContainer>;
  // Service binding to the main app worker (the `magna-carta` worker). The target of coolwsd's
  // intercepted WOPI callbacks — it mounts the token-guarded /wopi/files/* host. This worker holds no
  // R2/D1/secret bindings of its own; all object I/O flows through that host.
  APP_WORKER: Fetcher;
  // The app origins allowed to frame the editor, space-separated CSP sources. Public configuration,
  // not a secret: bound via wrangler.jsonc vars. Optional — the production app domain is the default in
  // embedding-policy.ts, so only a deployment on another domain (or a local dev origin) sets it.
  APP_FRAME_ANCESTORS?: string;
  // The Analytics Engine dataset the telemetry Workers logger mirrors counters to. Optional: a missing
  // binding (the local pool, a deployment without it) degrades to console-only structured lines, never
  // throws — createWorkersLogger handles undefined.
  TELEMETRY?: AnalyticsEngineDataset;
};

export { DocumentEditorContainer } from "./document-editor-container.ts";

// Required by @cloudflare/containers: the runtime resolves the container's outbound-interception proxy
// via `ctx.exports.ContainerProxy`, so the entrypoint MUST re-export it. Without it, starting a container
// that uses `outboundByHost` (our WOPI-callback path) throws "ctx.exports.ContainerProxy is undefined".
// It is a WorkerEntrypoint, not a Durable Object — no wrangler binding or migration is needed.
export { ContainerProxy } from "@cloudflare/containers";

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    // The build-identity read the app worker's aggregate version endpoint probes over EDIT_SERVICE.
    // This worker is also publicly routable (the browser loads the editor from it), so the answer —
    // a build commit and two timestamps — is readable without a session; that identity is already
    // public on the sign-in screen's version chip, so the route discloses nothing a visitor cannot
    // see there. Checked before host routing: the probe carries no per-document host.
    if (isVersionRequest(request)) return versionResponse();
    const key = documentKeyFromHost(request.headers.get("host") ?? "");
    if (key === null) return new Response("Not Found", { status: 404 });
    // Everything from here reaches a container, and everything that reaches a container runs under the
    // surface's diagnostics (diagnostics.ts): a throw becomes a 500 with an Error ID and one redacted
    // event, and an upgrade the container declines is recorded with the status the browser cannot see.
    return withEditorDiagnostics(
      request,
      { logger: createWorkersLogger(env.TELEMETRY), now: () => new Date().toISOString() },
      async () => {
        // Forwards the request verbatim, including the WebSocket upgrade, to the per-document
        // container. coolwsd's own WOPI callbacks do NOT pass through here — they leave the container
        // via outboundByHost straight to the app worker.
        const response = await getContainer(env.DOCUMENT_EDITOR, key).fetch(request);
        // The two things this worker changes about the container's answer: coolwsd cannot know which
        // origin frames the editor here, so the app origins are added to the policy it sent
        // (embedding-policy.ts); and the editor page's logo field is switched off, since this image
        // offers no setting for it (editor-branding.ts). Both hand an upgrade back untouched.
        return withoutEditorLogo(allowAppFraming(response, appFrameAncestors(env)));
      },
    );
  },
} satisfies ExportedHandler<Bindings>;
