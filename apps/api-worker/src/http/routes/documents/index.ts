import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { registerDocumentCheckoutRoutes } from "../../../editing/checkout-routes.ts";
import { registerDocumentEditingRoutes } from "../../../editing/edit-session-route.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerAssembliesRoutes } from "./assemblies.ts";
import { registerConversionRoutes } from "./conversions.ts";
import { registerDocumentSealRoutes } from "./document-seal.ts";
import { emailAdapterForEnv } from "../../../auth-instance.ts";
import { registerSignerRoutes } from "./signers.ts";
import { registerSigningRequestRoutes } from "./signing-requests.ts";
import { registerTemplatesRoutes } from "./templates.ts";

// Document automation and editing: templates and assemblies, server conversion, the seal, and the two chokepoint routes of in-app editing.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/http/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
export function mountDocuments(
  app: AppRouter,
  chokepoint: Chokepoint,
  deps: DomainDeps = {},
): void {
  const domain = createDomainApp();
  registerDocumentSealRoutes(domain, chokepoint, deps.sealPort);
  // Sending a document for signature: the member's draft, send, follow, remind and cancel.
  registerSigningRequestRoutes(domain, chokepoint, deps.signingMail ?? emailAdapterForEnv);
  // An outside signer's own routes, on the chokepoint's signer lane.
  registerSignerRoutes(domain, chokepoint, deps.signingMail ?? emailAdapterForEnv);
  // Slice 2·2: in-app document editing — the editor-launch route that mints the WOPI access token and
  // returns the editor URL to iframe (the WOPI host callback surface is its own token-guarded route).
  registerDocumentEditingRoutes(domain, chokepoint);
  // Slice 2·2: offline checkout / check-in — take a working copy out and return it through the
  // quarantine ingest, reconciling divergence as a human-reviewed conflicting copy.
  registerDocumentCheckoutRoutes(domain, chokepoint);
  // The server-conversion surface: presign an upload slot, submit a job, and poll its state.
  // Each route traverses the same chokepoint under the tools:fileConverter permission.
  registerConversionRoutes(domain, chokepoint);
  // Document automation: the firm's template catalogue (register, version, list, inspect fields,
  // archive) plus the merge-field dictionary a template is authored against.
  registerTemplatesRoutes(domain, chokepoint);
  // Document automation: submit an assembly onto a matter and poll it. Matter-rooted, so an assembly
  // carries the matter's ethical wall like every other document operation.
  registerAssembliesRoutes(domain, chokepoint);
  app.route("/", domain);
}
