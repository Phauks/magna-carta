import { getContainer } from "@cloudflare/containers";
import { DocumentEditorContainer } from "./document-editor-container.ts";
import { documentKeyFromHost } from "./document-routing.ts";

// The standalone in-app document editor worker. It owns the DocumentEditorContainer Durable Object
// (Container-backed) — ONE isolated coolwsd per open document. Two trust boundaries:
//   inbound  — the browser loads the editor (iframe + WebSocket) from this worker's cookieless origin;
//              authorization is the WOPI access token coolwsd validates against the host, NOT anything
//              this worker checks, so the proxy only routes to the right per-document container.
//   outbound — coolwsd's WOPI callbacks are intercepted by DocumentEditorContainer.outboundByHost and
//              forwarded to the app worker over APP_WORKER; enableInternet stays false.
export type Bindings = {
  // The per-document coolwsd Container (Container-backed Durable Object). Named in wrangler.jsonc's
  // durable_objects.bindings + migrations; re-exported below so the runtime can instantiate it.
  DOCUMENT_EDITOR: DurableObjectNamespace<DocumentEditorContainer>;
  // Service binding to the main app worker (the `magna-carta` worker). The target of coolwsd's
  // intercepted WOPI callbacks — it mounts the token-guarded /wopi/files/* host. This worker holds no
  // R2/D1/secret bindings of its own; all object I/O flows through that host.
  APP_WORKER: Fetcher;
};

export { DocumentEditorContainer } from "./document-editor-container.ts";

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const key = documentKeyFromHost(request.headers.get("host") ?? "");
    if (key === null) return new Response("Not Found", { status: 404 });
    // Forwards the request verbatim, including the WebSocket upgrade, to the per-document container.
    // coolwsd's own WOPI callbacks do NOT pass through here — they leave the container via
    // outboundByHost straight to the app worker.
    return getContainer(env.DOCUMENT_EDITOR, key).fetch(request);
  },
} satisfies ExportedHandler<Bindings>;
