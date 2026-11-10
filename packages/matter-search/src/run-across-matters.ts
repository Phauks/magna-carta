import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { Permission } from "@magna-carta/access-control/registry";
import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { countRecordIndexMatchesUpToStatement } from "@magna-carta/search/record-index-statements";
import { withMarks } from "./marks.ts";
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

export interface RunSearchAcrossMattersInput {
  readonly database: SqlDatabase;
  readonly registry: MatterSearchSourceRegistry;
  readonly query: string;
  readonly visibility: VisibleMatterPredicate;
  // The places to search. Absent or empty means every source the reader may read.
  readonly sourceKeys: readonly string[] | undefined;
  // The capability set the chokepoint already resolved for this request.
  readonly permissions: ReadonlySet<Permission>;
  readonly limit: number;
  readonly candidateCap?: number;
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

async function isBroad(database: SqlDatabase, query: string, cap: number): Promise<boolean> {
  const statement = countRecordIndexMatchesUpToStatement(database, query, cap);
  if (statement === null) return false;
  const { results } = await statement.all<{ matched: number }>();
  return (results[0]?.matched ?? 0) > cap;
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

  const request: AcrossMattersSearchRequest = {
    database: input.database,
    query,
    visibility: input.visibility,
    limit: input.limit,
    candidateCap,
  };

  const readsRecordIndex = runnable.some(({ declaration }) => declaration.reads === "record-index");
  const [broad, answered] = await Promise.all([
    readsRecordIndex ? isBroad(input.database, query, candidateCap) : Promise.resolve(false),
    Promise.all(
      runnable.map(async ({ source, declaration }): Promise<AcrossMattersGroup> => {
        const statements = declaration.buildStatements(request);
        const results = await Promise.all(
          statements.map((statement) => statement.all<MatterSearchRawRow>()),
        );
        const rows: MatterSearchRawRow[] = [];
        for (const result of results) rows.push(...result.results);
        // Each statement sorted its own rows and stopped at its own limit. A source answering from
        // two statements is merged on the key they both sorted by before the limit is applied, so
        // the second statement's newest row is not pushed out by the first having filled the limit
        // by itself. Descending, the order every source declared across matters reads in.
        if (results.length > 1) {
          rows.sort((left, right) =>
            left.sort_key < right.sort_key ? 1 : left.sort_key > right.sort_key ? -1 : 0,
          );
        }
        // One row past the limit was read, and is the measure of "there is more".
        const hasMore = rows.length > input.limit;
        const kept = hasMore ? rows.slice(0, input.limit) : rows;
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

  return { query, broad, groups };
}
