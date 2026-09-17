import { Container } from "@cloudflare/containers";
import { forwardWopiCallback } from "./document-routing.ts";
import type { Bindings } from "./index.ts";

// The fixed internal host coolwsd is configured (Dockerfile) to use as its WOPI host. It never resolves
// on the public internet — outboundByHost below intercepts it and forwards to the app worker. Naming it
// a non-routable `.internal` host makes "this is not real egress" obvious at the call site.
export const WOPI_HOST = "wopi.magna-carta.internal";

// One isolated Collabora Online (coolwsd) container per open document — the editor's compute, extracted
// from the app worker. coolwsd serves the editor (HTTP) + the document WebSocket on 9980 and is itself a
// WOPI CLIENT: it calls back to the app worker's /wopi/files/* host to read and save the document. The
// container runs least-privilege — enableInternet=false, no R2/D1 credentials — so untrusted document
// bytes have no general egress. The single host it must reach (the WOPI host) is reached NOT over the
// internet but through container outbound interception (outboundByHost) → the APP_WORKER service binding.
//
// The image is a deploy-time Docker build (collabora/code — containers/collabora/Dockerfile). coolwsd
// cannot run under the local test pool, so the proxy + interception are exercised against fakes in tests.
export class DocumentEditorContainer extends Container<Bindings> {
  override defaultPort = 9980; // coolwsd: the editor HTTP surface + the document WebSocket
  override requiredPorts = [9980];
  // Sleep a few minutes after the editor's WebSocket drops — long enough to absorb a reload/reconnect,
  // short enough that an abandoned session stops billing provisioned memory. Liveness WHILE a document
  // is open rides the WebSocket itself (an open WS is an in-flight request in @cloudflare/containers
  // >= 0.3.7) — there is NO alarm keep-alive (unnecessary, and it rides the open #191 spinloop). On
  // reap, version-cut-on-reap + DO/R2 state mean zero lost work.
  override sleepAfter = "5m";
  override enableInternet = false; // untrusted document bytes — no general egress
  override pingEndpoint = "hosting/discovery"; // coolwsd readiness probe (200 once coolwsd is up)

  // Outbound interception — the editing topology's hinge. coolwsd must call the WOPI host to read/save
  // the document, but it has no general egress; its WOPISrc targets WOPI_HOST, which this handler
  // forwards to the app worker over the APP_WORKER service binding, inside the Workers runtime (so no
  // public-internet egress opens). Every other outbound host is refused by default (enableInternet
  // false). The app worker re-derives firm scope + capability from the access token on every callback
  // (apps/api-worker/src/editing/wopi-guard.ts), so this hop carries no trust of its own: forwarding here
  // is plumbing, and a forged or replayed callback still fails the token check on the far side.
  //
  // Registered by ASSIGNMENT, in a static block — never as a static field. `Container` declares
  // `outboundByHost` as a static accessor pair whose setter files the handlers in a module-level registry
  // keyed by class name, and that registry, not the class, is what the library's `ContainerProxy` reads
  // when an intercepted request arrives. A static field is a definition, not an assignment: under the
  // class-field semantics this repository compiles to (ES2022), it creates an own property on this class
  // that shadows the inherited setter, which then never runs. That shipped, and it registered exactly half
  // of the contract — the runtime intercepted the host (that path reads the property) while the proxy
  // found no handler (that path reads the registry) and answered coolwsd 520 "Origin is disallowed" for
  // every CheckFileInfo, so no document ever loaded. test/document-editor-container.test.ts runs the
  // library's real dispatch against this class and holds both halves.
  static {
    this.outboundByHost = {
      [WOPI_HOST]: (request: Request, env: Bindings) =>
        forwardWopiCallback(request, env.APP_WORKER),
    };
  }
}
