# Task 2 review package (connection worker route)

Range: 78a006f646309aa3a0c0aaa72211c5017317daef..fb6ed3e4603f4a24d475420e749a7435f043b504

## Commits

fb6ed3e feat(tools): connection route reporting the edge's view of the caller

## Diff --stat

apps/worker/openapi/openapi.json | 93 ++++++++++++++++++++++
apps/worker/src/app.ts | 2 +
apps/worker/src/routes/tools-connection.ts | 80 +++++++++++++++++++
apps/worker/test/tools-connection.test.ts | 20 +++++
.../api-client/src/@tanstack/svelte-query.gen.ts | 22 ++++-
packages/api-client/src/index.ts | 6 +-
packages/api-client/src/sdk.gen.ts | 7 +-
packages/api-client/src/types.gen.ts | 41 ++++++++++
8 files changed, 265 insertions(+), 6 deletions(-)

## Full diff, hand-authored files only (-U10)

```diff
diff --git a/apps/worker/src/app.ts b/apps/worker/src/app.ts
index e1f3593..a5de7d6 100644
--- a/apps/worker/src/app.ts
+++ b/apps/worker/src/app.ts
@@ -41,20 +41,21 @@ import { registerPlatformStatusRoute } from "./routes/platform-status.ts";
 import { registerFoldersRoutes } from "./routes/folders.ts";
 import { registerIncidentsRoute } from "./routes/incidents.ts";
 import { registerLocationsRoutes } from "./routes/locations.ts";
 import { fetchHttpClient } from "@magna-carta/integrations/http";
 import { workerPlugins } from "./plugins/registry.ts";
 import type { PluginRuntime } from "./plugins/runtime.ts";
 import { firmSecretStoreNotYetAvailable } from "./plugins/secret-store.ts";
 import { registerMatterTypesRoutes } from "./routes/matter-types.ts";
 import { registerMattersRoutes } from "./routes/matters.ts";
 import { registerFirmUsageRoute } from "./routes/firm-usage.ts";
+import { registerToolsConnectionRoute } from "./routes/tools-connection.ts";
 import { registerWhoisRoute, type WhoisRouteDeps } from "./routes/whois.ts";
 import { registerSafeBrowseRoute, type SafeBrowseRouteDeps } from "./routes/safe-browse.ts";
 import { registerDecryptionRoutes } from "./routes/decryption.ts";
 import { registerRecoveryRoutes } from "./routes/recovery.ts";
 import { registerFileIntegrityRoutes } from "./routes/file-integrity.ts";
 import { registerFileTypeRoutes } from "./routes/file-type.ts";
 import { registerFileRepairRoutes } from "./routes/file-repair.ts";
 import { registerAiDetectionRoutes } from "./routes/ai-detection.ts";
 import { registerMetadataRoutes } from "./routes/metadata.ts";
 import { registerSupportGrantsRoutes } from "./routes/support-grants.ts";
@@ -354,20 +355,21 @@ export function createApp(options: CreateAppOptions = {}) {
   // Better Auth owns everything under its default basePath, /api/auth/* — its router serves
   // only GET and POST. Registered before the catch-all asset fallthrough, OUTSIDE the chokepoint
   // (it is its own authentication surface, not a /api/v1 route).
   app.on(["GET", "POST"], "/api/auth/*", (c) => authForEnv(c.env).handler(c.req.raw));

   // The /api/v1 routes, each composed through the chokepoint (the one enforcement point). The
   // public firms route additionally mounts the platform-admin secret guard as route-specific
   // middleware, run before the chokepoint's idempotency/rate-limit gates (see routes/firms.ts).
   registerMeRoute(app, chokepoint);
   registerFirmUsageRoute(app, chokepoint);
+  registerToolsConnectionRoute(app, chokepoint);

   // The WHOIS route: RDAP-first domain/IP registration lookup with a port-43 fallback. All outbound
   // effects go through injected deps so tests substitute fakes without touching global fetch or sockets.
   // The production socket opens a raw TCP connection on port 43 via cloudflare:sockets connect().
   const productionWhoisSocket: WhoisRouteDeps["socket"] = {
     async query(host, request) {
       // Imported lazily: cloudflare:sockets is a Workers-only module, so a top-level import would
       // break Node-based tooling (the emit-openapi script loads this file outside the Worker runtime).
       const { connect } = await import("cloudflare:sockets");
       const socket = connect({ hostname: host, port: 43 });
diff --git a/apps/worker/src/routes/tools-connection.ts b/apps/worker/src/routes/tools-connection.ts
new file mode 100644
index 0000000..9d06560
--- /dev/null
+++ b/apps/worker/src/routes/tools-connection.ts
@@ -0,0 +1,80 @@
+import { z, type OpenAPIHono } from "@hono/zod-openapi";
+import type { Bindings } from "../app.ts";
+import type { Chokepoint } from "../chokepoint/chokepoint.ts";
+import type { AppVariables } from "../chokepoint/ports.ts";
+import { chokepointMiddleware } from "../chokepoint/register.ts";
+import { Problem } from "../contracts/problem.ts";
+import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
+
+const ConnectionResponse = z
+  .object({
+    ip: z.string(),
+    asn: z.number(),
+    asOrganization: z.string(),
+    colo: z.string(),
+    country: z.string(),
+  })
+  .openapi("ToolsConnectionResponse");
+
+// Reads only what the edge already knows about this request — no database, no bindings — so the
+// handler adds no work of its own to the round trip. The caller's own address is returned to the
+// caller and never logged.
+export const toolsConnectionMeta: RouteMeta = {
+  operationId: "toolsConnection.get",
+  surface: "app",
+  authenticated: true,
+  permission: "tools:speedTest",
+  resource: "firm",
+  audited: false,
+  idempotency: "optional",
+  rateLimit: "default",
+};
+
+export const toolsConnectionRoute = defineOpenAPIRoute(toolsConnectionMeta, {
+  method: "get",
+  path: "/api/v1/tools/connection",
+  description:
+    "What the edge sees about this caller's connection: public address, network operator, and the edge location serving the request.",
+  responses: {
+    200: {
+      description: "The caller's connection as the edge sees it",
+      content: { "application/json": { schema: ConnectionResponse } },
+    },
+    401: {
+      description: "No valid session",
+      content: { "application/problem+json": { schema: Problem } },
+    },
+    403: {
+      description: "Authenticated, but the member lacks tools:speedTest",
+      content: { "application/problem+json": { schema: Problem } },
+    },
+    429: {
+      description: "Rate limit exceeded",
+      content: { "application/problem+json": { schema: Problem } },
+    },
+  },
+});
+
+export function registerToolsConnectionRoute(
+  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
+  chokepoint: Chokepoint,
+): void {
+  app.openapi(
+    { ...toolsConnectionRoute, middleware: chokepointMiddleware(chokepoint, toolsConnectionRoute) },
+    (c) => {
+      // `cf` is absent in local test runtimes; the empty defaults keep the contract satisfied
+      // rather than throwing on a diagnostic surface.
+      const edge = c.req.raw.cf;
+      return c.json(
+        {
+          ip: c.req.header("CF-Connecting-IP") ?? "",
+          asn: typeof edge?.asn === "number" ? edge.asn : 0,
+          asOrganization: typeof edge?.asOrganization === "string" ? edge.asOrganization : "",
+          colo: typeof edge?.colo === "string" ? edge.colo : "",
+          country: typeof edge?.country === "string" ? edge.country : "",
+        },
+        200,
+      );
+    },
+  );
+}
diff --git a/apps/worker/test/tools-connection.test.ts b/apps/worker/test/tools-connection.test.ts
new file mode 100644
index 0000000..df839e5
--- /dev/null
+++ b/apps/worker/test/tools-connection.test.ts
@@ -0,0 +1,20 @@
+/*
+ * The connection route reports what the edge sees about the caller and touches no database, so
+ * its round trip measures a real authenticated API call. It is gated on tools:speedTest like
+ * every other tool surface.
+ */
+import { SELF } from "cloudflare:test";
+import { describe, expect, it } from "vitest";
+
+describe("GET /api/v1/tools/connection", () => {
+  it("rejects an unauthenticated caller", async () => {
+    const response = await SELF.fetch("https://example.com/api/v1/tools/connection");
+    expect(response.status).toBe(401);
+  });
+
+  it("is registered in the emitted contract", async () => {
+    const response = await SELF.fetch("https://example.com/api/openapi.json");
+    const document = (await response.json()) as { paths: Record<string, unknown> };
+    expect(document.paths["/api/v1/tools/connection"]).toBeDefined();
+  });
+});
```

## Generated artifacts (NOT hand-authored; verified byte-equal to a fresh emission)

apps/worker/openapi/openapi.json | 93 ++++++++++++++++++++++
.../api-client/src/@tanstack/svelte-query.gen.ts | 22 ++++-
packages/api-client/src/index.ts | 6 +-
packages/api-client/src/sdk.gen.ts | 7 +-
packages/api-client/src/types.gen.ts | 41 ++++++++++
5 files changed, 163 insertions(+), 6 deletions(-)
