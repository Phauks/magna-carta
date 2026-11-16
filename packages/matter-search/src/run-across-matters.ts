import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { Permission } from "@magna-carta/access-control/registry";
import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import type { MatterId } from "@magna-carta/identifiers/types";
import { RECORD_QUERY_MATTERS_LIMIT } from "@magna-carta/search/record-index-query";
import { countRecordIndexMatchesUpToStatement } from "@magna-carta/search/record-index-statements";
import type { MatterFileContentsSearcher } from "./file-contents.ts";
import { withMarks } from "./marks.ts";
import {
  narrowedMatterIdsStatement,
  narrowedVisibility,
  type MatterNarrowing,
} from "./narrowing.ts";
import type {
  AcrossMattersDeclaration,
  AcrossMattersSearchRequest,
  MatterSearchSource,
  MatterSearchSourceRegistry,
} from "./sources/registry.ts";
import type {
  AcrossMattersGroup,
  AcrossMattersSearchAnswer,
  AcrossMattersSkipReason,
  MatterSearchRawRow,
} from "./types.ts";

// One question, answered from every matter the reader may see.
//
// THE REACH IS THE VISIBLE-MATTER PREDICATE AND NOTHING ELSE. There is no matter in the request and
// no list of matters is resolved first: every statement composes the predicate over its own row's
// matter, before its limit, so a record on a matter the reader may not see is refused by the
// statement that reads it. That is the second of the two checks every result passes; the first is
// the capability each source sits behind, settled here before any statement is built.
//
// ONLY THE SOURCES THAT DECLARED IT RUN. A source answers across matters through its own
// `acrossMatters` declaration and never through the statement it builds for one matter, which binds
// the matter it was given. A source with no declaration is reported as not searched here.
//
// THE COST IS BOUNDED BY A CAP, AND THE ANSWER SAYS WHEN THE CAP DECIDED IT. Inside a matter the
// matter keeps an index read small. Across matters a word the firm writes in most of its records
// would read most of the index, so a source reading the record index draws on the newest matches up
// to `candidateCap` and no further. One cheap count says whether the words matched more than that.
// When they did, the answer is marked `broad`: its groups hold the most recent records with those
// words, and a reader is told so.

// The most index entries one statement draws its candidates from. Chosen from
// scripts/measure-across-matters.mts: large enough that an ordinary question (a name, a phrase, a
// term of art) is answered in full, small enough that the commonest word a firm writes costs the
// same handful of milliseconds as a rare one.
export const ACROSS_MATTERS_CANDIDATE_CAP = 2000;

// A READER MAY NARROW THE REACH, AND NEVER WIDEN IT. A narrowing (the reader's own matters, one
// client's) is composed inside the predicate with AND (narrowing.ts), so every statement refuses a
// row outside it exactly as it refuses a row on a matter the reader may not see.
//
// A NARROWED SEARCH NAMES ITS MATTERS TO THE INDEX WHERE THEY ARE FEW. The cap above is over the
// firm's newest matches, and a narrowed search of a common word would otherwise be answered from
// two thousand records that are mostly on other matters. So the matters the narrowing reaches are
// read first, one statement, and where there are no more of them than the index takes in one
// question they are named to it: the cap and the `broad` count are then over those matters'
// records, and a search of one client's matters is answered in full where the same words across
// the firm are not. A narrowing that reaches more matters than that is asked the firm-wide way and
// says `broad` when the cap decided it. The list is for the index alone and decides nothing.
//
// THE WORDS INSIDE FILES ARE ASKED ONE MATTER AT A TIME, so that source needs the same list, and
// needs it whether or not the reader narrowed: a reader who may see few matters reaches few. The
// one read serves both. Where the search reaches more matters than the list holds, the source says
// so and is not run.

export interface RunSearchAcrossMattersInput {
  readonly database: SqlDatabase;
  readonly registry: MatterSearchSourceRegistry;
  readonly query: string;
  readonly visibility: VisibleMatterPredicate;
  // The reader's own narrowing of the reach, or absent for every matter they may see.
  readonly narrowing?: MatterNarrowing;
  // The places to search. Absent or empty means every source the reader may read.
  readonly sourceKeys: readonly string[] | undefined;
  // The capability set the chokepoint already resolved for this request.
  readonly permissions: ReadonlySet<Permission>;
  readonly limit: number;
  readonly candidateCap?: number;
  // How the words inside files are reached. Supplied by the application, which holds the service
  // binding; absent, the source that needs it reports the index as not connected.
  readonly fileContents?: MatterFileContentsSearcher | null;
}

function group(
  source: MatterSearchSource,
  matchedFields: readonly string[],
  rest: Pick<AcrossMattersGroup, "hits" | "hasMore" | "skipped">,
): AcrossMattersGroup {
  return {
    source: source.key,
    section: source.sectionSlug,
    answerShape: source.answerShape,
    matchedFields,
    ...rest,
  };
}

function skipped(source: MatterSearchSource, reason: AcrossMattersSkipReason): AcrossMattersGroup {
  return group(source, source.acrossMatters?.matchedFields ?? source.matchedFields, {
    hits: [],
    hasMore: false,
    skipped: reason,
  });
}

interface Runnable {
  readonly source: MatterSearchSource;
  readonly declaration: AcrossMattersDeclaration;
}

async function isBroad(
  database: SqlDatabase,
  query: string,
  cap: number,
  indexMatterIds: readonly MatterId[] | undefined,
): Promise<boolean> {
  const statement = countRecordIndexMatchesUpToStatement(database, query, cap, indexMatterIds);
  if (statement === null) return false;
  const { results } = await statement.all<{ matched: number }>();
  return (results[0]?.matched ?? 0) > cap;
}

// The matters a search reaches, or undefined where it reaches more than one question may name. One
// number serves the record index and the file contents index alike, so a reader is told one thing
// about how few matters "few" is.
async function reachedMatterIdsFor(
  database: SqlDatabase,
  visibility: VisibleMatterPredicate,
): Promise<readonly MatterId[] | undefined> {
  // One past the limit is the measure of "too many to name".
  const { results } = await narrowedMatterIdsStatement(
    database,
    visibility,
    RECORD_QUERY_MATTERS_LIMIT + 1,
  ).all<{ id: MatterId }>();
  if (results.length > RECORD_QUERY_MATTERS_LIMIT) return undefined;
  return results.map((row) => row.id);
}

export async function runSearchAcrossMatters(
  input: RunSearchAcrossMattersInput,
): Promise<AcrossMattersSearchAnswer> {
  const query = input.query.trim();
  const candidateCap = input.candidateCap ?? ACROSS_MATTERS_CANDIDATE_CAP;
  const groups: AcrossMattersGroup[] = [];

  // Every selected source appears in the answer, run or not, and a source that did not run says
  // why. The order of the checks is the order of what a reader can do about each: nothing about a
  // source that does not answer across matters, something about a capability, and only then the
  // text they typed.
  const runnable: Runnable[] = [];
  for (const source of input.registry.select(input.sourceKeys)) {
    if (source.acrossMatters === undefined) {
      groups.push(skipped(source, "one-matter-only"));
    } else if (source.permission !== null && !input.permissions.has(source.permission)) {
      groups.push(skipped(source, "permission"));
    } else if (query.length < source.minimumQueryLength) {
      groups.push(skipped(source, "query-too-short"));
    } else {
      runnable.push({ source, declaration: source.acrossMatters });
    }
  }

  const readsRecordIndex = runnable.some(({ declaration }) => declaration.reads === "record-index");
  const visibility =
    input.narrowing === undefined
      ? input.visibility
      : narrowedVisibility(input.visibility, input.narrowing);
  const readsFileContents = runnable.some(
    ({ declaration }) => declaration.reads === "file-contents",
  );
  // Read only where it has a use: a narrowed search with a source that reads the record index, or
  // any search with a source that asks one matter at a time.
  const reachedMatterIds =
    (input.narrowing !== undefined && readsRecordIndex) || readsFileContents
      ? await reachedMatterIdsFor(input.database, visibility)
      : undefined;
  // The record index is named matters only by a narrowed search. Asked firm-wide it already reads
  // every matter, and naming the few a reader may see would cost it a list to walk for nothing.
  const indexMatterIds = input.narrowing === undefined ? undefined : reachedMatterIds;

  const request: AcrossMattersSearchRequest = {
    database: input.database,
    query,
    visibility,
    limit: input.limit,
    candidateCap,
    ...(indexMatterIds === undefined ? {} : { indexMatterIds }),
    ...(reachedMatterIds === undefined ? {} : { reachedMatterIds }),
    ...(input.fileContents === undefined ? {} : { fileContents: input.fileContents }),
  };

  const [broad, answered] = await Promise.all([
    readsRecordIndex
      ? isBroad(input.database, query, candidateCap, indexMatterIds)
      : Promise.resolve(false),
    Promise.all(
      runnable.map(async ({ source, declaration }): Promise<AcrossMattersGroup> => {
        // A source that asks an index outside the database does that first, as in a matter's own
        // search. What comes back is a reason it could not, or candidates its own statement then
        // re-reads under the visible-matter predicate like every other source's.
        const prepared =
          declaration.prepare === undefined ? null : await declaration.prepare(request);
        if (prepared?.kind === "skipped") return skipped(source, prepared.reason);
        const statements =
          prepared === null ? declaration.buildStatements(request) : prepared.statements;
        const results = await Promise.all(
          statements.map((statement) => statement.all<MatterSearchRawRow>()),
        );
        let rows: MatterSearchRawRow[] = [];
        for (const result of results) rows.push(...result.results);
        // Each statement sorted its own rows and stopped at its own limit. A source answering from
        // two statements is merged on the key they both sorted by before the limit is applied, so
        // the second statement's newest row is not pushed out by the first having filled the limit
        // by itself. Descending, the order every source declared across matters reads in.
        if (prepared !== null) {
          // The outside index's order, restored: the statement returned its rows in the table's.
          rows = prepared.arrange(rows);
        } else if (results.length > 1) {
          rows.sort((left, right) =>
            left.sort_key < right.sort_key ? 1 : left.sort_key > right.sort_key ? -1 : 0,
          );
        }
        // One row past the limit was read, and is the measure of "there is more".
        const hasMore = rows.length > input.limit;
        const cut = hasMore ? rows.slice(0, input.limit) : rows;
        const kept = prepared?.quote === undefined ? cut : await prepared.quote(cut);
        return group(source, declaration.matchedFields, {
          // Projected, then marked, as in a matter's own search: the last step, on the rows the
          // limit kept, by the rule the source declared for the texts it shows.
          hits: kept.map((row) => withMarks(source.marking, source.project(row), query)),
          hasMore,
          skipped: null,
        });
      }),
    ),
  ]);

  groups.push(...answered);

  // Registry order, the order a matter's own sections read in, however the statements settled.
  const order = new Map(input.registry.all().map((source, index) => [source.key, index]));
  groups.sort((left, right) => (order.get(left.source) ?? 0) - (order.get(right.source) ?? 0));

  return { query, broad, fewMattersLimit: RECORD_QUERY_MATTERS_LIMIT, groups };
}
