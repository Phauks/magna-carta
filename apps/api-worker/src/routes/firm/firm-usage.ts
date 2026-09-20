import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { readCustodyItemCountsByLocation } from "@magna-carta/custodian/usage";
import { readAiDetectionUsage } from "@magna-carta/data-access/ai-detection-usage-statements";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { readActiveMemberCount } from "@magna-carta/data-access/member-statements";
import { readTokenUsage } from "@magna-carta/data-access/token-usage-statements";
import { readDirectoryCounts } from "@magna-carta/directory/usage";
import {
  readCleanVersionCount,
  readFileCount,
  readFileUsageBreakdown,
  readFolderCount,
  readStorageUsage,
} from "@magna-carta/file-manager/usage";
import { readLocationCount, readLocationUsageRows } from "@magna-carta/locations/statements";
import {
  readMatterCounts,
  readMatterCountsByLocation,
  readMatterCountsByType,
} from "@magna-carta/matters/queries";
import { readUsageMeterTotals } from "@magna-carta/search/natural-language-statements";
import type { Bindings } from "../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

const ClassTotals = z.object({ bytes: z.number(), objects: z.number() });

const CountAndBytes = z.object({ count: z.number(), bytes: z.number() });

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
        intake: z.number(),
        consultation: z.number(),
        open: z.number(),
        hold: z.number(),
        closed: z.number(),
      }),
      files: z.number(),
      fileVersions: z.number(),
      folders: z.number(),
      locations: z.number(),
    }),
    // One row per matter type in the firm's own catalog; matterTypeName null collects the matters
    // that carry no type. System matters are excluded, the same rule the caseload list applies.
    mattersByType: z.array(
      z.object({
        matterTypeName: z.string().nullable(),
        intake: z.number(),
        consultation: z.number(),
        open: z.number(),
        hold: z.number(),
        closed: z.number(),
        total: z.number(),
      }),
    ),
    // The versioning breakdown: currentFiles + priorVersions = allVersions, deletedFiles beside
    // them. Derived artifacts (previews, extracts) count toward storage but are not files.
    files: z.object({
      currentFiles: CountAndBytes,
      priorVersions: CountAndBytes,
      allVersions: CountAndBytes,
      deletedFiles: CountAndBytes,
    }),
    byLocation: z.object({
      rows: z.array(
        z.object({
          name: z.string(),
          status: z.enum(["active", "closed"]),
          matters: z.number(),
          members: z.number(),
          // Custody-register items held on a shelf whose container-tree root binds to this office.
          custodyItems: z.number(),
        }),
      ),
      mattersWithoutLocation: z.number(),
      // Items held under an external custody root (a bank vault, an offsite vendor) — real
      // holdings at none of the firm's offices, reported rather than folded into an office row.
      custodyItemsOffsite: z.number(),
    }),
    directory: z.object({
      people: z.number(),
      organizations: z.number(),
      activeMembers: z.number(),
    }),
    // Each meter is written where the work happens and only read here; totals are all-time.
    // notMetered names what this feature costs that cannot be measured per firm, so the surface
    // says so rather than showing a zero.
    aiUsage: z.object({
      magnusTokens: z.object({
        inputTokens: z.number(),
        outputTokens: z.number(),
        requests: z.number(),
      }),
      searchQueries: z.object({ semantic: z.number(), fullText: z.number() }),
      detection: z.object({ requests: z.number(), words: z.number() }),
      notMetered: z.array(z.string()),
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
    "The firm's own usage, computed when requested: storage by class, matters by type and by location, the file versioning breakdown, Directory and member counts, and the AI meters.",
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
// this is the one place they assemble. Everything is computed on this request — nothing is cached or
// stored — so a page that is never opened costs nothing, and one that is opened is current.
async function readFirmUsage(database: SqlDatabase) {
  const [
    storage,
    files,
    fileVersions,
    folders,
    matters,
    locations,
    mattersByType,
    fileBreakdown,
    locationRows,
    mattersByLocation,
    directoryCounts,
    activeMembers,
    tokenUsage,
    searchUsage,
    detectionUsage,
    custodyItemCounts,
  ] = await Promise.all([
    readStorageUsage(database),
    readFileCount(database),
    readCleanVersionCount(database),
    readFolderCount(database),
    readMatterCounts(database),
    readLocationCount(database),
    readMatterCountsByType(database),
    readFileUsageBreakdown(database),
    readLocationUsageRows(database),
    readMatterCountsByLocation(database),
    readDirectoryCounts(database),
    readActiveMemberCount(database),
    readTokenUsage(database),
    readUsageMeterTotals(database),
    readAiDetectionUsage(database),
    readCustodyItemCountsByLocation(database),
  ]);

  const mattersAtLocation = new Map(mattersByLocation.map((row) => [row.locationId, row.matters]));
  const custodyItemsAtLocation = new Map(
    custodyItemCounts.map((row) => [row.locationId, row.items]),
  );
  const magnusTokens = tokenUsage.reduce(
    (sum, row) => ({
      inputTokens: sum.inputTokens + row.inputTokens,
      outputTokens: sum.outputTokens + row.outputTokens,
      requests: sum.requests + row.requestCount,
    }),
    { inputTokens: 0, outputTokens: 0, requests: 0 },
  );

  return {
    storage,
    counts: { matters, files, fileVersions, folders, locations },
    mattersByType: mattersByType.map((row) => ({
      matterTypeName: row.matterTypeName,
      intake: row.intake,
      consultation: row.consultation,
      open: row.open,
      hold: row.hold,
      closed: row.closed,
      total: row.total,
    })),
    files: fileBreakdown,
    byLocation: {
      rows: locationRows.map((row) => ({
        name: row.name,
        status: row.status,
        matters: mattersAtLocation.get(row.id) ?? 0,
        members: row.members,
        custodyItems: custodyItemsAtLocation.get(row.id) ?? 0,
      })),
      mattersWithoutLocation: mattersAtLocation.get(null) ?? 0,
      custodyItemsOffsite: custodyItemsAtLocation.get(null) ?? 0,
    },
    directory: { ...directoryCounts, activeMembers },
    aiUsage: {
      magnusTokens,
      searchQueries: {
        semantic: searchUsage.authoritative.semanticQueryCount,
        fullText: searchUsage.authoritative.fullTextQueryCount,
      },
      detection: {
        requests: detectionUsage.totalRequests,
        words: detectionUsage.totalWords,
      },
      notMetered: [...searchUsage.notMetered],
    },
  };
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
