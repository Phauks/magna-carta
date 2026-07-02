import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  readCleanVersionCount,
  readFileCount,
  readFolderCount,
  readStorageUsage,
} from "@magna-carta/file-manager/usage";
import { readLocationCount } from "@magna-carta/locations/statements";
import { readMatterCounts } from "@magna-carta/matters/queries";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

const ClassTotals = z.object({ bytes: z.number(), objects: z.number() });

const FirmUsageResponse = z
  .object({
    storage: z.object({
      totalBytes: z.number(),
      totalObjects: z.number(),
      byStorageClass: z.object({ standard: ClassTotals, infrequent_access: ClassTotals }),
    }),
    counts: z.object({
      matters: z.object({
        total: z.number(),
        prospective: z.number(),
        open: z.number(),
        closed: z.number(),
      }),
      files: z.number(),
      fileVersions: z.number(),
      folders: z.number(),
      locations: z.number(),
    }),
  })
  .openapi("FirmUsageResponse");

// Read-only, per-firm. The chokepoint resolves the session + firm and enforces tools:firmUsage; the
// handler composes the per-domain reads over the resolved firm database. The tenancy resource is the
// firm — the whole firm's usage, not a matter-scoped object.
export const firmUsageMeta: RouteMeta = {
  operationId: "firmUsage.get",
  surface: "app",
  authenticated: true,
  permission: "tools:firmUsage",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const firmUsageRoute = defineOpenAPIRoute(firmUsageMeta, {
  method: "get",
  path: "/api/v1/firm-usage",
  description:
    "The firm's own usage: storage consumed (by class) and entity counts (matters by status, files, versions, folders, locations).",
  responses: {
    200: {
      description: "The firm usage snapshot",
      content: { "application/json": { schema: FirmUsageResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks tools:firmUsage",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The session's firm is not reachable, or the member is deactivated (absent)",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

// Compose the per-domain reads over the firm database. Each read queries only its own domain's tables;
// this is the one place they assemble.
async function readFirmUsage(database: SqlDatabase) {
  const [storage, files, fileVersions, folders, matters, locations] = await Promise.all([
    readStorageUsage(database),
    readFileCount(database),
    readCleanVersionCount(database),
    readFolderCount(database),
    readMatterCounts(database),
    readLocationCount(database),
  ]);
  return { storage, counts: { matters, files, fileVersions, folders, locations } };
}

export function registerFirmUsageRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...firmUsageRoute, middleware: chokepointMiddleware(chokepoint, firmUsageRoute) },
    async (c) => {
      const firmContext = requireChokepointFirmContext(c);
      const usage = await readFirmUsage(firmContext.firmDatabase);
      return c.json(usage, 200);
    },
  );
}
