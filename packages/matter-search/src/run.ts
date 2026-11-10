import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { Permission } from "@magna-carta/access-control/registry";
import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import type { MatterId } from "@magna-carta/identifiers/types";
import type { MatterFileContentsSearcher } from "./file-contents.ts";
import type {
  MatterSearchSource,
  MatterSearchSourceRegistry,
  SourceSearchRequest,
} from "./sources/registry.ts";
import type {
  MatterSearchAnswer,
  MatterSearchGroup,
  MatterSearchRawRow,
  SourceSkipReason,
} from "./types.ts";

// The fan-out. It is BOUNDED BY THE REGISTRY, not by the firm's data: a search issues at most one
// statement per selected source, and the selection is narrowed twice before a single statement is
// built — once by the reader's scope, once by the capabilities they hold. That is the distinction
// between a bounded fan-out and an N+1, and it is why the DEFAULT scope (one section) is the
// cheapest query this surface can run rather than the most expensive.

export interface RunMatterSearchInput {
  readonly database: SqlDatabase;
  readonly registry: MatterSearchSourceRegistry;
  readonly matterId: MatterId;
  readonly query: string;
  readonly visibility: VisibleMatterPredicate;
  // The reader's scope. Absent or empty means every source they may read — never a key meaning
  // "everything", because the vocabulary must not grow a word wider than this matter.
  readonly sourceKeys: readonly string[] | undefined;
  // The capability set the chokepoint already resolved for this request.
  readonly permissions: ReadonlySet<Permission>;
  readonly limit: number;
  readonly includeDeleted: boolean;
  // The way to the index of the words inside files. Left out, the file contents source answers
  // "could not be searched" instead of "no matches".
  readonly fileContents?: MatterFileContentsSearcher | null;
}

function skippedGroup(source: MatterSearchSource, reason: SourceSkipReason): MatterSearchGroup {
  return {
    source: source.key,
    section: source.sectionSlug,
    answerShape: source.answerShape,
    matchedFields: source.matchedFields,
    supportsDeleted: source.supportsDeleted,
    hits: [],
    hasMore: false,
    skipped: reason,
  };
}

export async function runMatterSearch(input: RunMatterSearchInput): Promise<MatterSearchAnswer> {
  const query = input.query.trim();
  const selected = input.registry.select(input.sourceKeys);
  const groups: MatterSearchGroup[] = [];

  // Every selected source appears in the answer, whether it ran or not. A source dropped silently is
  // how a reader comes to believe the matter holds nothing when it holds something they simply
  // cannot see — so a withheld source is a group carrying its reason, not an absence.
  const runnable: MatterSearchSource[] = [];
  for (const source of selected) {
    if (source.permission !== null && !input.permissions.has(source.permission)) {
      groups.push(skippedGroup(source, "permission"));
      continue;
    }
    if (query.length < source.minimumQueryLength) {
      groups.push(skippedGroup(source, "query-too-short"));
      continue;
    }
    runnable.push(source);
  }

  const answered = await Promise.all(
    runnable.map(async (source): Promise<MatterSearchGroup> => {
      const request: SourceSearchRequest = {
        database: input.database,
        matterId: input.matterId,
        query,
        visibility: input.visibility,
        limit: input.limit,
        // A source that has not DECLARED it can honor the flag never receives it. A retracted note
        // must stay unmatchable whatever a caller asks for, and that is enforced here rather than
        // trusted to each source's own reading of the request.
        includeDeleted: input.includeDeleted && source.supportsDeleted,
        fileContents: input.fileContents ?? null,
      };
      // A source that asks an index outside the database does that first. What comes back is either
      // a reason it could not, which is reported like any other withheld source, or candidates that
      // its own statement then re-reads under the same matter binding as everything else.
      const prepared = source.prepare === undefined ? null : await source.prepare(request);
      if (prepared?.kind === "skipped") return skippedGroup(source, prepared.reason);
      const statements = prepared === null ? source.buildStatements(request) : prepared.statements;
      if (statements.length === 0) {
        return {
          source: source.key,
          section: source.sectionSlug,
          answerShape: source.answerShape,
          matchedFields: source.matchedFields,
          supportsDeleted: source.supportsDeleted,
          hits: [],
          hasMore: false,
          skipped: null,
        };
      }
      const results = await Promise.all(
        statements.map((statement) => statement.all<MatterSearchRawRow>()),
      );
      let rows: MatterSearchRawRow[] = [];
      for (const result of results) rows.push(...result.results);
      /*
       * A source may answer from more than one statement (the files source matches folder names
       * alongside file names), and concatenating their results is not the same as merging them.
       * Each statement sorted its OWN rows and stopped at the limit, so the second statement's
       * newest row can be newer than half of the first's — and without this the answer would read
       * in statement order and, worse, a first statement that filled the limit by itself would
       * push every row of the second out of the group entirely.
       *
       * Sorting the union by the same key the statements sorted by, before the limit is applied,
       * makes a two-statement source read exactly as a one-statement source does. Descending,
       * matching the builder's own default order; a source that asked for ascending would need
       * this to know that, which no source does today.
       */
      if (prepared !== null) {
        // The outside index's order, restored: the statement returned its rows in the table's order,
        // which says nothing about which of them answers the question best.
        rows = prepared.arrange(rows);
      } else if (results.length > 1) {
        rows.sort((left, right) =>
          left.sort_key < right.sort_key ? 1 : left.sort_key > right.sort_key ? -1 : 0,
        );
      }
      // The builder read one row past the limit. That extra row is the has-more probe and is never
      // returned — which is how a group says "there is more" without claiming a total nobody counted.
      const hasMore = rows.length > input.limit;
      const kept = hasMore ? rows.slice(0, input.limit) : rows;
      return {
        source: source.key,
        section: source.sectionSlug,
        answerShape: source.answerShape,
        matchedFields: source.matchedFields,
        supportsDeleted: source.supportsDeleted,
        hits: kept.map((row) => source.project(row)),
        hasMore,
        skipped: null,
      };
    }),
  );

  groups.push(...answered);

  // Registry order, not completion order — the answer reads in the same order as the matter's own
  // section strip however the statements happened to settle.
  const order = new Map(input.registry.all().map((source, index) => [source.key, index]));
  groups.sort((left, right) => (order.get(left.source) ?? 0) - (order.get(right.source) ?? 0));

  return { matterId: input.matterId, query, groups };
}
