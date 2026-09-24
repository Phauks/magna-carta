import { OpenAPIHono } from "@hono/zod-openapi";
import type { SealPort } from "@magna-carta/signing/port";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import type { HumanVerificationGateOptions } from "../human-verification/human-verification-gate.ts";
import type { SafeBrowseRouteDeps } from "./tools/safe-browse.ts";
import type { WhoisRouteDeps } from "./tools/whois.ts";
import type { Bindings } from "../../bindings.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { defaultHook } from "../contracts/problem.ts";

// The one typed router shape every route module registers on: the Worker's bindings plus the
// variables the chokepoint stashes per request.
export type AppRouter = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

// The ONE constructor for a router in this Worker — the root app and every domain sub-app alike.
//
// WHY A CONSTRUCTOR AND NOT `new OpenAPIHono(...)` AT EACH SITE. `defaultHook` is per instance in
// @hono/zod-openapi: it is what turns every zod request-validation failure into the 422 problem
// document with field-level errors. A sub-app built without it would answer a malformed request
// with the library's own default body, and nothing in the contract or the snapshot would show the
// difference — the route's declared 422 stays declared while the bytes on the wire diverge. Building
// every router here makes that hook one fact; test/route-hygiene-scan.test.ts refuses a direct
// construction anywhere under src/http/routes/.
export function createDomainApp(): AppRouter {
  return new OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>({ defaultHook });
}

// What a domain module may be handed beyond the router and the chokepoint: the seams tests inject
// fakes through. Every field is optional and every module ignores the ones it does not use, so the
// manifest can hand the same object to all of them. Production passes nothing — each module resolves
// its own defaults (the port-43 socket, the browser renderer, the seal binding, the verifier).
export interface DomainDeps {
  readonly whoisDeps?: Partial<WhoisRouteDeps>;
  readonly safeBrowseDeps?: SafeBrowseRouteDeps;
  readonly sealPort?: SealPort;
  readonly humanVerification?: HumanVerificationGateOptions;
}

// One entry of the manifest (src/http/routes/manifest.ts).
export interface DomainModule {
  readonly domain: string;
  readonly mount: (app: AppRouter, chokepoint: Chokepoint, deps: DomainDeps) => void;
}
