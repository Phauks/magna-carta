import type { OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { readSearchIndexCoverage } from "@magna-carta/file-manager/queries";
import {
  type FirmSearchRebuildBody,
  FirmSearchRebuildResponse,
  type FirmSearchStatusBody,
  FirmSearchStatusResponse,
} from "@magna-carta/search/contract";
import { readNaturalLanguageSearchEnabled } from "@magna-carta/search/natural-language-settings";
import {
  readRecordIndexRebuildStanding,
  recordIndexRebuildIsOutstanding,
  recordIndexRebuildRequestedEffect,
} from "@magna-carta/search/record-index-rebuild";
import { readRecordIndexPlaces } from "@magna-carta/search/record-index-statements";
import { readSearchIndexingEnabled } from "@magna-carta/search/settings";
import type { Bindings } from "../../../bindings.ts";
import { DAILY_INDEX_BACKLOG_ENQUEUE_CAP } from "../../../search/index-backlog.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../../contracts/common.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// What a firm's indexes hold, for the screen that shows a firm what is searchable, and the one
// thing a firm can do about a place that has fallen behind: ask for it to be rebuilt.
//
// Every number here is COUNTED AT THE MOMENT OF THE READ, from the firm's own database: how many
// records each searchable place holds in the record index and how many it should, and how many of
// the firm's files the file contents index holds. Nothing is kept between reads and nothing is
// estimated, because a status screen that reports a stored figure reports the last time something
// remembered to update it.
//
// THE REBUILD IS ASKED FOR HERE AND RUN ELSEWHERE. A rebuild is work in proportion to the place
// being rebuilt and does not belong on a request, so the write below records that a member asked
// and puts a message on the firm's outbox in the same batch; the per-firm queue's consumer does the
// work (src/search/record-index-rebuild.ts). The read says when a request is still to run, from the
// two audit rows a rebuild leaves, which are moments and not figures.
//
// WHAT IS NOT HERE, on purpose:
//   - Discovery review sets. Each set's index is its own corpus, readable only from inside that set
//     by a member with access to it. A firm-wide total would be a read across that wall by somebody
//     holding a settings permission, so the screen names review sets and counts nothing.
//   - A choice of which place to rebuild. The rebuild counts when it runs and takes the places that
//     are behind at that moment, so there is nothing for a request to name and nothing for it to
//     name wrongly.
//
// WHAT IT COSTS: it reads every row of each indexed table once and every live file once, so it is a
// read for a screen a person opened. The page asks once when it opens and again only when somebody
// presses the button to check.

// The bodies are declared in packages/search/src/contract.ts, with what each field means.

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

const rebuildMeta: RouteMeta = {
  operationId: "firmSearchStatus.rebuild",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

const rebuildRoute = defineOpenAPIRoute(rebuildMeta, {
  method: "post",
  path: "/api/v1/firm/search-status/rebuild",
  description:
    "Asks for the places of the firm's record index that have fallen behind their records to be rebuilt. The request is recorded and answered at once; the rebuild runs afterwards, counts what is behind when it runs and rebuilds those places from the firm's records. An index is a copy, so nothing a firm holds is changed. The search status read says when a request is still to run.",
  request: { headers: idempotencyKeyHeader },
  responses: {
    202: {
      description: "The rebuild was asked for and is queued",
      content: { "application/json": { schema: FirmSearchRebuildResponse } },
    },
    400: {
      description: "The Idempotency-Key header is missing",
      content: { "application/problem+json": { schema: Problem } },
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
    409: {
      description: "A request with this Idempotency-Key is already in progress",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "The Idempotency-Key was reused with a different request",
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
      const [places, rebuild, coverage, fileContentsTurnedOn, searchByMeaningTurnedOn] =
        await Promise.all([
          readRecordIndexPlaces(database),
          readRecordIndexRebuildStanding(database),
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
          rebuild: {
            requestedAt: rebuild.requestedAt,
            finishedAt: rebuild.finishedAt,
            outstanding: recordIndexRebuildIsOutstanding(rebuild),
          },
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

  // The audit row and the outbox message ride one idempotent batch keyed on the client's
  // Idempotency-Key, so a redelivered press asks once. Nothing is counted here: whether anything is
  // behind is the rebuild's question, answered when it runs. A press while nothing is behind is
  // therefore accepted, and the rebuild records that it found nothing to do.
  app.openapi(
    { ...rebuildRoute, middleware: chokepointMiddleware(chokepoint, rebuildRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const requestedAt = new Date().toISOString();
      // Composed before the effect and stored with it: a replayed delivery is answered from the
      // record, with the moment the first delivery was recorded.
      const answer: FirmSearchRebuildBody = { requestedAt };
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now: () => requestedAt,
        effect: async () => ({
          write: recordIndexRebuildRequestedEffect(firm.firmDatabase, {
            actorUserId: userId,
            now: requestedAt,
          }),
          responseCode: 202,
          responseBody: canonicalJsonStringify(answer),
        }),
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      const recorded =
        result.responseBody === null
          ? answer
          : (JSON.parse(result.responseBody) as FirmSearchRebuildBody);
      return c.json(recorded, 202);
    },
  );
}
