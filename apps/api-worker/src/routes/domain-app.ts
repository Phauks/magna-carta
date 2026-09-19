import { OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../bindings.ts";
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
// construction anywhere under src/routes/.
export function createDomainApp(): AppRouter {
  return new OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>({ defaultHook });
}
