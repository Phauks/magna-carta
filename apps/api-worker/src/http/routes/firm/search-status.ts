import type { OpenAPIHono } from "@hono/zod-openapi";
import { readSearchIndexCoverage } from "@magna-carta/file-manager/queries";
import { type FirmSearchStatusBody, FirmSearchStatusResponse } from "@magna-carta/search/contract";
import { readNaturalLanguageSearchEnabled } from "@magna-carta/search/natural-language-settings";
import { readRecordIndexPlaces } from "@magna-carta/search/record-index-statements";
import { readSearchIndexingEnabled } from "@magna-carta/search/settings";
import type { Bindings } from "../../../bindings.ts";
import { DAILY_INDEX_BACKLOG_ENQUEUE_CAP } from "../../../search/index-backlog.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// What a firm's indexes hold, for the screen that shows a firm what is searchable.
//
// Every number here is COUNTED AT THE MOMENT OF THE READ, from the firm's own database: how many
// records each searchable place holds in the record index and how many it should, and how many of
// the firm's files the file contents index holds. Nothing is kept between reads and nothing is
// estimated, because a status screen that reports a stored figure reports the last time something
// remembered to update it.
//
// WHAT IS NOT HERE, on purpose:
//   - Discovery review sets. Each set's index is its own corpus, readable only from inside that set
//     by a member with access to it. A firm-wide total would be a read across that wall by somebody
//     holding a settings permission, so the screen names review sets and counts nothing.
//   - A way to rebuild anything. A rebuild is work in proportion to the place being rebuilt and does
//     not belong on a request; this read only says when one is needed (`indexed` differs from
//     `expected`).
//
// WHAT IT COSTS: it reads every row of each indexed table once and every live file once, so it is a
// read for a screen a person opened. The page asks once when it opens and again only when somebody
// presses the button to check.

// The body is declared in packages/search/src/contract.ts, with what each field means.

// The permission that governs the firm's search settings governs seeing how they are working out:
// the counts say how much a firm holds of each kind of record, which is a firm administrator's
// fact and not every member's.
const PERMISSION = "firm:manageSearchSettings" as const;

const getMeta: RouteMeta = {
  operationId: "firmSearchStatus.get",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const getRoute = defineOpenAPIRoute(getMeta, {
  method: "get",
  path: "/api/v1/firm/search-status",
  description:
    "What the firm's search indexes hold, counted when asked: for each searchable place, how many records are indexed and how many should be; how many of the firm's files have their contents indexed; and whether search by meaning is turned on. Reads every indexed record once, so it is for a status screen and not for polling.",
  responses: {
    200: {
      description: "What the firm's search indexes hold now",
      content: { "application/json": { schema: FirmSearchStatusResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks firm:manageSearchSettings",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable or the member is deactivated",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

type SearchStatusApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerFirmSearchStatusRoutes(app: SearchStatusApp, chokepoint: Chokepoint): void {
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const database = firm.firmDatabase;
      const [places, coverage, fileContentsTurnedOn, searchByMeaningTurnedOn] = await Promise.all([
        readRecordIndexPlaces(database),
        readSearchIndexCoverage(database),
        readSearchIndexingEnabled(database),
        readNaturalLanguageSearchEnabled(database),
      ]);
      const body: FirmSearchStatusBody = {
        checkedAt: new Date().toISOString(),
        records: {
          places: places.map((place) => ({
            key: place.sourceKey,
            label: place.label,
            matchedFields: [...place.matchedFields],
            readBy: [...place.readBy],
            indexed: place.indexed,
            expected: place.expected,
          })),
        },
        fileContents: {
          turnedOn: fileContentsTurnedOn,
          serviceConnected: c.env.SEARCH_SERVICE !== undefined,
          filesBelonging: coverage.belonging,
          filesIndexed: coverage.held,
          lastIndexedAt: coverage.lastIndexedAt,
          dailyCatchUpLimit: DAILY_INDEX_BACKLOG_ENQUEUE_CAP,
        },
        searchByMeaning: {
          turnedOn: searchByMeaningTurnedOn,
          serviceConnected: c.env.AI_SEARCH !== undefined,
        },
      };
      return c.json(body, 200);
    },
  );
}
