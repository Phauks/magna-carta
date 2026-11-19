import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import type { MatterId } from "@magna-carta/identifiers/types";
import type { MatterNarrowing } from "@magna-carta/matter-search/narrowing";
import { runSearchAcrossMatters } from "@magna-carta/matter-search/run-across-matters";
import { matterSearchSources } from "@magna-carta/matter-search/sources";
import type { AcrossMattersSearchAnswer } from "@magna-carta/matter-search/types";
import { readMattersByIds } from "@magna-carta/matters/queries";
import {
  SearchAcrossMattersAnswer,
  type SearchAcrossMattersAnswerBody,
} from "@magna-carta/search/contract";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { Bindings } from "../../../bindings.ts";
import { matterFileContentsSearcherFor } from "../../../search/matter-file-contents.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointPermissions,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { matterNarrowingQuery, matterNarrowingsOf } from "./matter-narrowing-query.ts";

// The search across matters: one question answered from every matter the member may see.
//
// It is the matter search's sibling and reads through the same registry
// (@magna-carta/matter-search), by a different door. A matter's own search binds the one matter it
// was given and cannot be widened. This one runs only the sources that DECLARED they can answer
// across matters, through a second builder that binds no matter and composes the visible-matter
// predicate in its place. So the predicate below is the whole of the reach: whatever it admits is
// searched, and a matter it stops admitting leaves every member's search with it.
//
// THE SAME TWO GATES AS THE MATTER SEARCH. `search:matter` gates the surface, and each source is
// checked against the capability set the chokepoint resolved before a statement is built. A source
// withheld that way is reported, and so is a source that does not answer across matters, so the
// page can say what it did not look at.
//
// WHAT IT COSTS IS BOUNDED BEFORE IT RUNS. A source reading the record index draws on the newest
// matches up to a cap, whatever the firm holds, and the answer is marked `broad` when the cap
// decided it. A source that reads a table (file and folder names, parties, invoice lines, custody
// packets) reads short rows of one kind. Those readings are in
// packages/matter-search/scripts/measure-across-matters.mts. The words inside files are in an index
// kept one matter at a time, so that source is asked only where the search reaches few enough
// matters to ask each, and says `too-many-matters` where it reaches more.
//
// A MEMBER MAY NARROW THE REACH AND NOT WIDEN IT. `mine` and `clientEntityId` are composed inside
// the predicate with AND, so a narrowed search answers from the matters the member may see AND
// chose. A client identifier the member made up reaches no matter and answers nothing; it cannot
// show that a matter exists.

const READ = "search:matter" as const;

const MAX_HITS_PER_SOURCE = 50;
const DEFAULT_HITS_PER_SOURCE = 5;

// The most matters one hydration statement names. A firm's database takes a bounded number of
// bindings in one statement, and a full answer can name more matters than that.
const MATTERS_PER_READ = 80;

const searchQuery = z.object({
  q: z.string().min(1).max(200),
  // Repeatable. The places to search; absent means every place the member may read.
  in: z.union([z.string(), z.array(z.string())]).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_HITS_PER_SOURCE).optional(),
  // The member's own narrowing of the reach: their own matters, one client's, or both at once.
  ...matterNarrowingQuery,
});

const searchMeta: RouteMeta = {
  operationId: "search.acrossMatters",
  surface: "app",
  authenticated: true,
  permission: READ,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  // The default bucket, for the reason the matter search gives: it is driven by a person typing,
  // and its cost is bounded by the registry and the cap instead of by a tight request budget.
  rateLimit: "default",
};

const searchRoute = defineOpenAPIRoute(searchMeta, {
  method: "get",
  path: "/api/v1/search",
  description:
    "Searches every matter the member may see, answering one group per place in the order a " +
    "matter's own sections read in. Each hit names its matter and links to its own section there. " +
    "Pass `in` (repeatable) to narrow to named places. A place that contributed nothing says why: " +
    "`one-matter-only` is a place searched inside a matter and not across them, `permission` " +
    "is one the member lacks the capability for, and `too-many-matters` is a place searched only " +
    "where the search reaches few enough matters to ask each one, which a member changes by " +
    "narrowing it to `fewMattersLimit` matters or fewer. `broad` is true when the words are in more of " +
    "the firm's records than one search reads; the groups then hold the most recent records with " +
    "those words and not every one. A long text is quoted at the stretch the words are in, and " +
    "`titleMarks` and `snippetMarks` say where they are in what is shown. `mine=true` narrows the " +
    "search to the matters the member is responsible for or currently assigned to, and " +
    "`clientEntityId` to the matters one person or organization is a client on; neither reaches a " +
    "matter the member may not see.",
  request: { query: searchQuery },
  responses: {
    200: {
      description: "One group per place",
      content: { "application/json": { schema: SearchAcrossMattersAnswer } },
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
      description: "The firm is unreachable or the member is deactivated",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limited",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

// Several narrowings as one: a matter has to be in every one of them.
function narrowingOf(narrowings: readonly MatterNarrowing[]): MatterNarrowing | undefined {
  if (narrowings.length === 0) return undefined;
  return {
    fragmentFor: (matterIdExpression) =>
      narrowings.map((narrowing) => narrowing.fragmentFor(matterIdExpression)).join(" AND "),
    bindings: narrowings.flatMap((narrowing) => [...narrowing.bindings]),
  };
}

function sourceKeysFrom(value: string | string[] | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

type MatterLabel = SearchAcrossMattersAnswerBody["groups"][number]["hits"][number]["matter"];

// What a reader recognizes each matter in the answer by, read once for all of them. The search
// already decided these matters are the reader's to see; this adds their names and nothing else.
async function readMatterLabels(
  database: SqlDatabase,
  answer: AcrossMattersSearchAnswer,
): Promise<Map<string, MatterLabel>> {
  const matterIds = [
    ...new Set(answer.groups.flatMap((group) => group.hits.map((hit) => hit.matterId))),
  ] as MatterId[];
  const reads: Promise<Awaited<ReturnType<typeof readMattersByIds>>>[] = [];
  for (let start = 0; start < matterIds.length; start += MATTERS_PER_READ) {
    reads.push(readMattersByIds(database, matterIds.slice(start, start + MATTERS_PER_READ)));
  }
  const labels = new Map<string, MatterLabel>();
  for (const matters of await Promise.all(reads)) {
    for (const matter of matters) {
      labels.set(matter.id, {
        id: matter.id,
        title: matter.title,
        number: matter.matterNumber ?? matter.consultationNumber ?? matter.intakeNumber,
      });
    }
  }
  return labels;
}

function wireAnswer(
  answer: AcrossMattersSearchAnswer,
  labels: ReadonlyMap<string, MatterLabel>,
): SearchAcrossMattersAnswerBody {
  return {
    query: answer.query,
    broad: answer.broad,
    fewMattersLimit: answer.fewMattersLimit,
    groups: answer.groups.map((group) => ({
      source: group.source,
      section: group.section,
      answerShape: group.answerShape,
      matchedFields: [...group.matchedFields],
      // A hit whose matter cannot be named is left out. The statement that found it already held
      // it to a visible matter, so this is a matter removed between the two reads, and a result
      // with no matter on it is not one a reader can place.
      hits: group.hits.flatMap((hit) => {
        const matter = labels.get(hit.matterId);
        if (matter === undefined) return [];
        return [
          {
            id: hit.id,
            title: hit.title,
            titleMarks: hit.titleMarks.map((mark) => ({ start: mark.start, end: mark.end })),
            snippet: hit.snippet,
            snippetMarks: hit.snippetMarks.map((mark) => ({ start: mark.start, end: mark.end })),
            secondary: hit.secondary,
            actorUserId: hit.actorUserId,
            sortKey: hit.sortKey,
            link: hit.link,
            matter,
          },
        ];
      }),
      hasMore: group.hasMore,
      skipped: group.skipped,
    })),
  };
}

export function registerSearchAcrossMattersRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // GET /api/v1/search
  app.openapi(
    { ...searchRoute, middleware: chokepointMiddleware(chokepoint, searchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { q, in: places, limit, ...narrowed } = c.req.valid("query");
      const logger = c.get("logger");
      const narrowing = narrowingOf(matterNarrowingsOf(requireChokepointUserId(c), narrowed));
      const answer = await runSearchAcrossMatters({
        database: firm.firmDatabase,
        registry: matterSearchSources,
        query: q,
        // The whole of the reach. It excludes the platform-owned holding matters today, and an
        // information barrier is one more clause in it that this search inherits untouched.
        visibility: visibleMatterPredicate(),
        // What the member chose to look inside, composed within the predicate above and never in
        // its place. Whose matters "mine" means is the session's member, not a value in the request.
        ...(narrowing === undefined ? {} : { narrowing }),
        sourceKeys: sourceKeysFrom(places),
        permissions: requireChokepointPermissions(c),
        limit: limit ?? DEFAULT_HITS_PER_SOURCE,
        // The words inside files are in an index outside the firm's database. The searcher costs
        // nothing to build, and asks the index only when that place is among those selected and
        // the search reaches few enough matters.
        fileContents: matterFileContentsSearcherFor(
          c.env,
          requireChokepointFirmId(c),
          logger === undefined ? {} : { logger },
        ),
      });
      const labels = await readMatterLabels(firm.firmDatabase, answer);
      return c.json(wireAnswer(answer, labels), 200);
    },
  );
}
