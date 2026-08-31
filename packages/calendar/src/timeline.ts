import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { mergeTimelinePages, type MergedPage } from "./merge.ts";
import {
  type TimelineCursor,
  type TimelineEntry,
  type TimelineRawRow,
  type TimelineScope,
  type TimelineSource,
  type TimelineSourceRegistry,
} from "./sources/registry.ts";
import { DEFAULT_TIMELINE_PAGE_SIZE, MAX_TIMELINE_PAGE_SIZE, type CalendarScope } from "./types.ts";
import { CalendarValidationError } from "./validation.ts";
import type { VisibleMatterPredicate } from "./visibility.ts";

// The federated read: one page across every registered source, under one comparable sort key, one
// shared cursor, and one visibility predicate.
//
// The bound, per page: one bounded pre-read for each join-reached source in scope; one statement per
// SELECTED source, each LIMIT pageSize + 1 under the same keyset predicate; one k-way merge in
// memory over at most sourceCount x (pageSize + 1) rows. The read count scales with the REGISTRY,
// not with the firm's data — which is the line between a bounded fan-out and an N+1: N here is the
// number of declared sources, fixed in code and reviewed when it changes, never the number of rows.

export interface TimelineReadOptions {
  readonly database: SqlDatabase;
  readonly registry: TimelineSourceRegistry;
  readonly scope: TimelineScope;
  readonly visibility: VisibleMatterPredicate;
  // Narrows the REGISTRY before any statement is built: a request filtered to one source issues one
  // statement, not fifteen.
  readonly sourceKeys?: readonly string[];
  // Which side of the calendar to read — matter-anchored sources, firm-anchored sources, or both
  // (the default). Narrows the registry exactly as sourceKeys does, before any statement is built.
  readonly anchorScope?: CalendarScope;
  readonly cursor?: TimelineCursor;
  readonly pageSize?: number;
  readonly ascending?: boolean;
}

export interface TimelineReadResult extends MergedPage {
  // What the read actually did, so a measurement can assert the bound rather than infer it.
  readonly statementCount: number;
  readonly rowsRead: number;
  readonly sourcesRead: readonly string[];
}

function resolvePageSize(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_TIMELINE_PAGE_SIZE;
  if (!Number.isInteger(requested) || requested < 1) return DEFAULT_TIMELINE_PAGE_SIZE;
  return Math.min(requested, MAX_TIMELINE_PAGE_SIZE);
}

// Refuses a kind filter naming a source the registry does not carry, rather than ignoring it. A
// silently-dropped filter returns MORE than the caller asked for, which on a read spanning every
// matter is the wrong direction to fail in.
function assertKnownSourceKeys(
  registry: TimelineSourceRegistry,
  sourceKeys: readonly string[] | undefined,
): void {
  if (sourceKeys === undefined) return;
  for (const key of sourceKeys) {
    if (registry.get(key) === undefined) {
      throw new CalendarValidationError(
        "calendar-unknown-source",
        `${key} is not a timeline source this platform carries`,
      );
    }
  }
}

export async function readTimelinePage(options: TimelineReadOptions): Promise<TimelineReadResult> {
  assertKnownSourceKeys(options.registry, options.sourceKeys);
  const pageSize = resolvePageSize(options.pageSize);
  const ascending = options.ascending ?? false;
  let selected = options.registry.select(options.sourceKeys);

  // The anchor scope narrows the registry too: `scope=firm` reads the firm-anchored sources only,
  // `scope=matter` the matter-anchored ones, and the default reads both interleaved.
  if (options.anchorScope !== undefined && options.anchorScope !== "all") {
    selected = selected.filter((source) => source.visibilityAnchor === options.anchorScope);
  }

  // A member filter narrows the registry too. A source that cannot answer "is this member on it" is
  // DROPPED rather than returning everything it has: silently ignoring the filter would put other
  // people's matters on the answer to "what is on my calendar".
  if (options.scope.memberUserId !== undefined) {
    selected = selected.filter((source) => source.supportsMemberFilter);
  }

  // The bounded pre-reads for the join-reached sources, once per page and never per row.
  const joinKeysBySource = new Map<string, readonly string[]>();
  await Promise.all(
    selected
      .filter(
        (
          source,
        ): source is TimelineSource & {
          resolveJoinKeys: NonNullable<TimelineSource["resolveJoinKeys"]>;
        } => source.resolveJoinKeys !== undefined,
      )
      .map(async (source) => {
        joinKeysBySource.set(
          source.key,
          await source.resolveJoinKeys(options.database, options.scope),
        );
      }),
  );

  const plans: { source: TimelineSource; statements: readonly SqlStatement[] }[] = [];
  for (const source of selected) {
    const statements = source.buildStatements({
      database: options.database,
      scope: options.scope,
      visibility: options.visibility,
      cursor: options.cursor,
      // The has-more probe: one extra row per statement so the MERGED result can tell "there is
      // more" from "that is all". The extras are discarded.
      limit: pageSize + 1,
      ascending,
      joinKeys: joinKeysBySource.get(source.key),
    });
    if (statements.length > 0) plans.push({ source, statements });
  }

  // Issued together rather than one after another: the whole page is one round of reads, so a
  // thirteen-source page costs one round trip's latency rather than thirteen.
  const results = await Promise.all(
    plans.flatMap((plan) => plan.statements.map((statement) => statement.all<TimelineRawRow>())),
  );

  let resultIndex = 0;
  let rowsRead = 0;
  const perSourceEntries: TimelineEntry[][] = [];
  for (const plan of plans) {
    const entries: TimelineEntry[] = [];
    for (let index = 0; index < plan.statements.length; index += 1) {
      const rows = results[resultIndex]?.results ?? [];
      resultIndex += 1;
      rowsRead += rows.length;
      for (const row of rows) entries.push(plan.source.project(row));
    }
    perSourceEntries.push(entries);
  }

  const merged = mergeTimelinePages(perSourceEntries, pageSize, ascending);
  return {
    entries: merged.entries,
    nextCursor: merged.nextCursor,
    statementCount: plans.reduce((total, plan) => total + plan.statements.length, 0),
    rowsRead,
    sourcesRead: plans.map((plan) => plan.source.key),
  };
}
