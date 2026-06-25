import { getContainer } from "@cloudflare/containers";
import { DocumentEditorContainer } from "./document-editor-container.ts";

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

// The per-document container key, read from the Host's first label. The editor is served on a cookieless
// wildcard origin (`<key>.edit.<domain>` — a deploy-time route), so every request for one document
// (cool.html, static assets, the WebSocket) shares the same label and pins to one container. The key is
// a STABLE, opaque per-document token the app worker's editor-launch derives deterministically from the
// fileId — stable so co-editors converge on one container, opaque so the origin leaks no fileId. coolwsd
// serves from root, so requests forward verbatim (no path rewriting).
function documentKeyFromHost(host: string): string | null {
  const label = (host.split(":")[0] ?? "").split(".")[0]?.trim() ?? "";
  return label.length > 0 ? label : null;
}

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
