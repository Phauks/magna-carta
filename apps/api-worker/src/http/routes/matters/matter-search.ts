import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import type { MatterId } from "@magna-carta/identifiers/types";
import { runMatterSearch } from "@magna-carta/matter-search/run";
import type { MatterSearchAnswer } from "@magna-carta/matter-search/types";
import { matterSearchSources } from "@magna-carta/matter-search/sources";
import { SearchTextMark } from "@magna-carta/search/contract";
import type { Bindings } from "../../../bindings.ts";
import { matterFileContentsSearcherFor } from "../../../search/matter-file-contents.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointPermissions,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { identifierPathParam } from "../../contracts/common.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// The consolidated matter search: one query answered from every section of ONE matter at once.
//
// It reaches its rows through @magna-carta/matter-search, whose registry is the whole architecture —
// each subsystem declares where its rows live and which capability gates them, and the shared
// statement builder composes the matter binding and the visible-matter predicate itself, so no
// source can search across matters. This file is the HTTP surface over that and owns three things
// the package deliberately does not: the wire contract, the scope parameter, and the second
// permission gate.
//
// THE SECOND GATE IS THE PART WORTH READING. RouteMeta names one permission and this route spans a
// dozen subsystems with a dozen read capabilities, so the declared `search:matter` gates the SURFACE
// and each source is checked separately against the capability set the chokepoint resolved. That
// check happens before any statement is built: a source the member may not read never runs a query,
// rather than running one whose rows are thrown away. And a source withheld that way is REPORTED —
// "nothing in Time matches" and "you cannot read Time" are different answers, and conflating them
// would teach a reader the matter holds nothing when it holds a great deal they simply cannot see.

const READ = "search:matter" as const;

// How many hits one source contributes. The panel under the field asks for a handful; the results
// page asks for the maximum. Capped rather than unbounded because the fan-out multiplies it by the
// number of selected sources.
const MAX_HITS_PER_SOURCE = 50;
const DEFAULT_HITS_PER_SOURCE = 5;

// ---- request/response contracts ----

const matterIdParam = z.object({ matterId: identifierPathParam("matter", "matterId") });

const searchQuery = z.object({
  q: z.string().min(1).max(200),
  // Repeatable. Narrows the REGISTRY before any statement is built, so a search scoped to one
  // section issues one statement rather than one per source — which is what makes the DEFAULT scope
  // (the section the reader is standing on) the cheapest query rather than the most expensive.
  //
  // There is deliberately no value meaning "everything": ABSENT means every source the reader may
  // read, and the vocabulary never grows a word that could be read as wider than this matter.
  // Searching the whole application is the command palette's job.
  in: z.union([z.string(), z.array(z.string())]).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_HITS_PER_SOURCE).optional(),
  // Whether records the firm deleted join the answer. Honored only by the sources that DECLARE they
  // can honor it — a retracted note stays unmatchable whatever a caller asks for.
  includeDeleted: z.enum(["true", "false"]).optional(),
});

const SearchHit = z
  .object({
    id: z.string(),
    title: z.string(),
    // Where the reader's words are in `title`. Empty where the title is not what matched.
    titleMarks: z.array(SearchTextMark),
    // The DECLARED excerpt, or null where the source declares it has none. A source over a
    // protected() column always declares none and returns the pointer instead. A long text is
    // quoted at the stretch the reader's words are in.
    snippet: z.string().nullable(),
    // Where the reader's words are in `snippet`.
    snippetMarks: z.array(SearchTextMark),
    secondary: z.string().nullable(),
    actorUserId: z.string().nullable(),
    sortKey: z.string(),
    link: z.string(),
  })
  .openapi("MatterSearchHit");

const SearchGroup = z
  .object({
    source: z.string(),
    section: z.string(),
    answerShape: z.enum(["listing", "ranked"]),
    matchedFields: z.array(z.string()),
    // Whether this source honors `includeDeleted`, so a client can offer that control only where it
    // means something rather than keeping its own list of which sources have deleted sets.
    supportsDeleted: z.boolean(),
    hits: z.array(SearchHit),
    // Measured by reading one row past the limit, never estimated — so a group can say more exists
    // without ever claiming a total nobody counted.
    hasMore: z.boolean(),
    // Why this source contributed nothing, or null when it answered. Absence is always explained.
    // Three of these belong to a source that reads an index outside the database:
    // `engine-not-connected` is a deployment that does not have the index's service yet,
    // `engine-unavailable` is that service failing to answer, and `not-indexed` is a firm that has
    // not turned the index on.
    skipped: z
      .enum([
        "permission",
        "query-too-short",
        "engine-unavailable",
        "engine-not-connected",
        "not-indexed",
      ])
      .nullable(),
  })
  .openapi("MatterSearchGroup");

const SearchAnswer = z
  .object({
    matterId: z.string(),
    query: z.string(),
    // One group per selected source, in the registry's order — which is the order of the matter's
    // own section strip, so the answer and the tabs above it never disagree about where things live.
    // Never a flat merged list: a listing and a ranked answer are two different objects, and there is
    // no honest way to compare a substring hit against a relevance score.
    groups: z.array(SearchGroup),
  })
  .openapi("MatterSearchAnswer");

function readMeta(action: string): RouteMeta {
  return {
    operationId: `matterSearch.${action}`,
    surface: "app",
    authenticated: true,
    permission: READ,
    resource: "matter",
    audited: false,
    idempotency: "optional",
    // The DEFAULT bucket, and the reasoning is worth writing down because the obvious choice is
    // wrong. This is a fan-out over several subsystems, which reads like the `expensive` bucket —
    // but `expensive` is ten requests a minute, and this route is driven by a person typing. A
    // member refining a query pauses several times inside one thought, and each pause is a request;
    // ten of them is an ordinary minute's work, not abuse. Putting an interactive search there would
    // lock somebody out of their own matter mid-search and tell them to come back in a minute.
    //
    // The cost is bounded structurally instead, which is the better place for it: the fan-out scales
    // with the registry rather than the firm's data, the scope narrows that registry before a
    // statement is built, and every statement carries a per-source LIMIT. `expensive` is for the
    // operations that are unbounded in the firm's data — a bundle build, a report production.
    rateLimit: "default",
  };
}

const searchRoute = defineOpenAPIRoute(readMeta("search"), {
  method: "get",
  path: "/api/v1/matters/{matterId}/search",
  description:
    "Searches one matter across every section the member may read, answering one group per " +
    "source in the matter's own section order. Pass `in` (repeatable) to narrow to named " +
    "sources; absent means every source the member may read, and there is no value meaning " +
    "wider than this matter. A group that contributed nothing says why — a source the member " +
    "lacks the capability for is reported as withheld rather than returned empty, so a search " +
    "never reads as 'this matter holds nothing' when it holds something the reader cannot see.",
  request: { params: matterIdParam, query: searchQuery },
  responses: {
    200: {
      description: "One group per selected source",
      content: { "application/json": { schema: SearchAnswer } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks the required permission",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable, the member is deactivated, or the matter is unknown",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limited",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

function sourceKeysFrom(value: string | string[] | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

// The package's answer is deeply readonly, which is right for a value nothing downstream may edit,
// and the wire contract is a plain JSON shape. Mapping across the two here rather than widening
// either is what keeps the route the only place that knows the wire — and it is where `sourceKey`
// is dropped from each hit, because the group it sits in already names its source and repeating it
// per hit is one more field free to disagree.
function wireAnswer(answer: MatterSearchAnswer): z.infer<typeof SearchAnswer> {
  return {
    matterId: answer.matterId,
    query: answer.query,
    groups: answer.groups.map((group) => ({
      source: group.source,
      section: group.section,
      answerShape: group.answerShape,
      matchedFields: [...group.matchedFields],
      supportsDeleted: group.supportsDeleted,
      hits: group.hits.map((hit) => ({
        id: hit.id,
        title: hit.title,
        titleMarks: hit.titleMarks.map((mark) => ({ start: mark.start, end: mark.end })),
        snippet: hit.snippet,
        snippetMarks: hit.snippetMarks.map((mark) => ({ start: mark.start, end: mark.end })),
        secondary: hit.secondary,
        actorUserId: hit.actorUserId,
        sortKey: hit.sortKey,
        link: hit.link,
      })),
      hasMore: group.hasMore,
      skipped: group.skipped,
    })),
  };
}

export function registerMatterSearchRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // GET /api/v1/matters/{matterId}/search
  app.openapi(
    { ...searchRoute, middleware: chokepointMiddleware(chokepoint, searchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const { q, in: scope, limit, includeDeleted } = c.req.valid("query");
      const logger = c.get("logger");
      const answer = await runMatterSearch({
        database: firm.firmDatabase,
        registry: matterSearchSources,
        matterId: matterId as MatterId,
        query: q,
        // The one visibility seam every federated read in this platform composes. It excludes the
        // platform-owned holding matters today; an information-barrier overlay is one more clause
        // in it, inherited by every registered source without one of them being touched.
        visibility: visibleMatterPredicate(),
        sourceKeys: sourceKeysFrom(scope),
        // The capability set the chokepoint already resolved for this request — the input the
        // per-source gate reads. It is populated because this route names a non-null permission.
        permissions: requireChokepointPermissions(c),
        limit: limit ?? DEFAULT_HITS_PER_SOURCE,
        includeDeleted: includeDeleted === "true",
        // The words inside the matter's files are in an index outside the firm's database. The
        // searcher costs nothing to build; it reads the firm's setting and asks the index only when
        // the file contents source is among those selected.
        fileContents: matterFileContentsSearcherFor(
          c.env,
          requireChokepointFirmId(c),
          logger === undefined ? {} : { logger },
        ),
      });
      return c.json(wireAnswer(answer), 200);
    },
  );
}
