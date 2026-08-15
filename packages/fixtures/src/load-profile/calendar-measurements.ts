import {
  findBookingConflicts,
  readResourceAvailability,
} from "@magna-carta/calendar/booking-service";
import { readContinuanceChain } from "@magna-carta/calendar/continuance-service";
import { decodeTimelineCursor } from "@magna-carta/calendar/merge";
import { selectLiveBookingsInWindowStatement } from "@magna-carta/calendar/booking-statements";
import { timelineSourceRegistry } from "@magna-carta/calendar/sources/all";
import type { SourceReadRequest, TimelineCursor } from "@magna-carta/calendar/sources/registry";
import { readTimelinePage } from "@magna-carta/calendar/timeline";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { NodeSqlStatement } from "@magna-carta/database/node-sqlite";
import { explainStatement, type LabeledPlan, type Measurement } from "./runner.ts";
import type { LoadedSnapshot } from "./snapshot.ts";

// The calendar volume-shaped measured set. The federated read is the whole subject: a timeline page
// unions one bounded statement per REGISTERED SOURCE under one comparable sort key, one shared
// cursor, and one visibility predicate — so the number to watch is that the read count scales with
// the REGISTRY (fixed in code, reviewed when it changes) and never with the firm's data.
//
// That distinction is exactly where an N+1 would hide, which is why the page reads below are
// accompanied by `timelinePageBounds` — the statement count and rows read the harness records
// alongside the timings. A number is a better witness than a plan here: a per-row lookup added inside
// a projection would not change any single statement's plan, but it would change the count.
//
//   1. the MATTER TIMELINE at page 1 and at page 20 — page 20 must not be materially slower, which
//      is the whole thing keyset pagination buys and the thing a regression takes away silently;
//   2. the FIRM-WIDE 31-DAY WINDOW — federation's weakest read, the one that spans every matter, and
//      the measurement the design says decides whether a projected read model is ever built;
//   3. the MEMBER-FILTERED firm calendar, which composes the participant and all-members predicates
//      in SQL and DROPS the sources that cannot answer the filter;
//   4. the RESOURCE AVAILABILITY read — one statement plus the in-memory overlap pairing;
//   5. the OVERLAP CHECK a booking write makes — one coarse civil-date statement widened a day each
//      side, then precise per-zone intersection in memory;
//   6. the CONTINUANCE CHAIN read, whose cost must be bounded by the chain's own length.

export interface CalendarMeasurementHandle {
  readonly snapshot: LoadedSnapshot;
  readonly registry: ReturnType<typeof timelineSourceRegistry>;
  readonly visibility: ReturnType<typeof visibleMatterPredicate>;
}

export function calendarMeasurementHandle(snapshot: LoadedSnapshot): CalendarMeasurementHandle {
  return {
    snapshot,
    registry: timelineSourceRegistry(),
    visibility: visibleMatterPredicate(),
  };
}

// The timeline page size the calendar surface reads with, and the page depth the "page 20 costs what
// page 1 cost" claim is checked at.
const TIMELINE_PAGE_SIZE = 50;
const DEEP_PAGE_NUMBER = 20;

// Walks forward to the requested page and returns the LAST page read. The walk itself is untimed —
// only the final page is on the clock — because what is under measurement is the cost of ONE page at
// depth, not the cost of getting there.
async function pageAt(
  handle: CalendarMeasurementHandle,
  scope: { matterId?: string; fromDate?: string; toDate?: string; memberUserId?: string },
  pageNumber: number,
): Promise<Awaited<ReturnType<typeof readTimelinePage>>> {
  let page = await readTimelinePage({
    database: handle.snapshot.database,
    registry: handle.registry,
    scope,
    visibility: handle.visibility,
    pageSize: TIMELINE_PAGE_SIZE,
  });
  for (let index = 1; index < pageNumber; index += 1) {
    // The wire cursor, decoded exactly as the route decodes it — the calendar mints no cursor of its
    // own, so walking a page here is the same walk a browser makes.
    const cursor = decodeTimelineCursor(page.nextCursor ?? undefined);
    if (cursor === undefined) break;
    page = await readTimelinePage({
      database: handle.snapshot.database,
      registry: handle.registry,
      scope,
      visibility: handle.visibility,
      cursor,
      pageSize: TIMELINE_PAGE_SIZE,
    });
  }
  return page;
}

export const calendarMeasurements: readonly Measurement<CalendarMeasurementHandle, unknown>[] = [
  {
    name: "timeline.matter-page-1",
    operation: async (handle) => {
      await readTimelinePage({
        database: handle.snapshot.database,
        registry: handle.registry,
        scope: { matterId: handle.snapshot.manifest.calendarProbes.deepTimelineMatterId },
        visibility: handle.visibility,
        pageSize: TIMELINE_PAGE_SIZE,
      });
    },
  },
  {
    name: "timeline.matter-page-20",
    // The cursor for page 20 is resolved untimed: paging there is not what a reader does, and timing
    // the walk would measure nineteen pages nobody asked for. Only the twentieth page is on the clock.
    prepare: async (handle): Promise<TimelineCursor | undefined> => {
      const scope = { matterId: handle.snapshot.manifest.calendarProbes.deepTimelineMatterId };
      const page = await pageAt(handle, scope, DEEP_PAGE_NUMBER - 1);
      return decodeTimelineCursor(page.nextCursor ?? undefined);
    },
    operation: async (handle, state) => {
      await readTimelinePage({
        database: handle.snapshot.database,
        registry: handle.registry,
        scope: { matterId: handle.snapshot.manifest.calendarProbes.deepTimelineMatterId },
        visibility: handle.visibility,
        cursor: state as TimelineCursor | undefined,
        pageSize: TIMELINE_PAGE_SIZE,
      });
    },
  },
  {
    name: "timeline.matter-shallow-page-1",
    operation: async (handle) => {
      // An ordinary matter's timeline beside the deep one. The federated read issues the SAME number
      // of statements either way — that is the point of a registry-shaped fan-out — so the gap
      // between these two is the cost of the ROWS rather than of the reads.
      await readTimelinePage({
        database: handle.snapshot.database,
        registry: handle.registry,
        scope: { matterId: handle.snapshot.manifest.calendarProbes.shallowTimelineMatterId },
        visibility: handle.visibility,
        pageSize: TIMELINE_PAGE_SIZE,
      });
    },
  },
  {
    name: "timeline.firm-window-31-day",
    operation: async (handle) => {
      const { calendarProbes } = handle.snapshot.manifest;
      // Federation's weakest read: no matter narrows it, so every source scans its own date window
      // across the whole firm and the merge does the rest.
      await readTimelinePage({
        database: handle.snapshot.database,
        registry: handle.registry,
        scope: {
          fromDate: calendarProbes.firmWindowFromDate,
          toDate: calendarProbes.firmWindowToDate,
        },
        visibility: handle.visibility,
        pageSize: TIMELINE_PAGE_SIZE,
      });
    },
  },
  {
    name: "timeline.firm-window-member-filtered",
    operation: async (handle) => {
      const { calendarProbes } = handle.snapshot.manifest;
      // "What is on my calendar" — the sources that cannot answer the filter are dropped from the
      // registry before a statement is built, so this read issues FEWER statements than the one
      // above rather than the same ones with a post-filter.
      //
      // Fewer statements, and yet reliably slower than the unfiltered window it narrows. The filter
      // is composed as two correlated per-row lookups — is this member a participant, or responsible
      // for the matter — and the participant arm's cost tracks how many events the member is on
      // rather than how many are in the window. The profile's participation share is what that arm is
      // measured against; the fixture firm has ONE member, so this is a partner's diary, not a
      // junior's.
      await readTimelinePage({
        database: handle.snapshot.database,
        registry: handle.registry,
        scope: {
          fromDate: calendarProbes.firmWindowFromDate,
          toDate: calendarProbes.firmWindowToDate,
          memberUserId: calendarProbes.memberUserId,
        },
        visibility: handle.visibility,
        pageSize: TIMELINE_PAGE_SIZE,
      });
    },
  },
  {
    name: "booking.availability-read",
    operation: async (handle) => {
      const { calendarProbes } = handle.snapshot.manifest;
      await readResourceAvailability(handle.snapshot.database, {
        resourceId: calendarProbes.busiestResourceId,
        fromDate: calendarProbes.availabilityFromDate,
        toDate: calendarProbes.availabilityToDate,
      });
    },
  },
  {
    name: "booking.overlap-check",
    operation: async (handle) => {
      const { calendarProbes } = handle.snapshot.manifest;
      // What every booking write pays before it commits: one coarse statement over one resource's
      // widened civil-date window, then a precise per-zone intersection over what came back.
      await findBookingConflicts(handle.snapshot.database, {
        resourceId: calendarProbes.busiestResourceId,
        candidate: {
          starts_on: calendarProbes.availabilityFromDate,
          starts_at_time: "09:00",
          ends_on: null,
          ends_at_time: "12:00",
          time_zone: calendarProbes.bookingTimeZone,
        },
      });
    },
  },
  {
    name: "continuance.chain-read",
    operation: async (handle) => {
      const { calendarProbes } = handle.snapshot.manifest;
      // One indexed link hop per node, then ONE bounded read for the settings themselves. Its cost
      // must track the chain's length and nothing else — a chain read that grew with the firm's event
      // count would mean the link hops stopped being seeks.
      await readContinuanceChain(handle.snapshot.database, calendarProbes.continuanceChainEventId, {
        clock: { now: () => calendarProbes.chainReadAt },
        actorUserId: null,
        visibility: handle.visibility,
      });
    },
  },
];

// What the federated read ACTUALLY did, recorded beside the timings. These are the design's second
// and third assertions in the only form a committed baseline can carry them: statementCount must
// equal the number of selected sources (plus the extra statement the two-armed custody review source
// contributes), and rowsRead must stay within sourceCount x (pageSize + 1).
//
// They are reported rather than asserted here because a baseline is a record, not a gate — the smoke
// test asserts the bound, and these numbers are what a person compares across commits when it moves.
export interface TimelinePageBounds {
  readonly label: string;
  readonly statementCount: number;
  readonly rowsRead: number;
  readonly sourcesRead: number;
  readonly entriesReturned: number;
}

export async function timelinePageBounds(
  handle: CalendarMeasurementHandle,
): Promise<TimelinePageBounds[]> {
  const { calendarProbes } = handle.snapshot.manifest;
  const scopes: readonly { label: string; scope: Parameters<typeof pageAt>[1] }[] = [
    { label: "timeline.matter-page-1", scope: { matterId: calendarProbes.deepTimelineMatterId } },
    {
      label: "timeline.firm-window-31-day",
      scope: {
        fromDate: calendarProbes.firmWindowFromDate,
        toDate: calendarProbes.firmWindowToDate,
      },
    },
    {
      label: "timeline.firm-window-member-filtered",
      scope: {
        fromDate: calendarProbes.firmWindowFromDate,
        toDate: calendarProbes.firmWindowToDate,
        memberUserId: calendarProbes.memberUserId,
      },
    },
  ];
  const bounds: TimelinePageBounds[] = [];
  for (const { label, scope } of scopes) {
    const page = await pageAt(handle, scope, 1);
    bounds.push({
      label,
      statementCount: page.statementCount,
      rowsRead: page.rowsRead,
      sourcesRead: page.sourcesRead.length,
      entriesReturned: page.entries.length,
    });
  }
  return bounds;
}

// THE MATTER-SCOPED READS ARE GATED AND CLEAN: every one of the fourteen sources seeks its own
// matter-keyed index, which is what a case timeline is supposed to look like.
//
// The FIRM-WIDE WINDOW is a different read, and these sources scan for it. That is not a planner
// accident: their only useful index is keyed on `matter_id`, and a read with no matter to key on has
// nothing to seek — so the date window is applied over the whole table. Two of them (`time_entry`,
// `cost_entry`) carry no index on their date column at all and scan the heap, as does `file` behind
// `documentFiled`.
//
// They are exempted BY NAME rather than by prefix, and the list is the finding rather than a
// dismissal of it: a source added to the registry is gated at both scopes until somebody looks at
// its plan and decides, and any of these that gains a date-keyed index should come OFF this list in
// the same change. Firm-window sources are absent from the list where they already seek —
// `matterEvent` and `firmEvent` walk a `(starts_on, id)` index, which is exactly the shape the others
// are missing; `matterLifecycle` seeks the audit log's event index; `custodyMovement` walks an
// `(occurred_at, id)` index; and `custodyDueBack` drives from the packets that are out rather than
// from the ledger.
//
// The seven that remain are a decision rather than a backlog. Each costs at most 1.7 ms of this one
// read at the profile corpus, and between them they are the platform's hottest write paths — the
// trade of an index on every one of them against a few milliseconds on federation's weakest read is
// not worth taking yet. `file` behind `documentFiled` is the one to revisit first, because the
// document corpus grows fastest; the number to revisit it against is this measurement.
export const CALENDAR_PLAN_SCAN_ALLOWLIST: readonly string[] = [
  "timeline.firm-window.matterDeadline",
  "timeline.firm-window.emailFiled",
  "timeline.firm-window.documentAssembly",
  "timeline.firm-window.documentFiled",
  "timeline.firm-window.timeEntry",
  "timeline.firm-window.costEntry",
  "timeline.firm-window.conflictsCheck",
  "timeline.firm-window.trustMovement",
];

function capturedStatement(statement: SqlStatement): NodeSqlStatement {
  return statement as NodeSqlStatement;
}

// Every registered source's own statement, built through the source's own builder for the scope under
// measurement. Nothing here reproduces SQL: a source that changes shape changes its own plan probe
// with it, and a source ADDED to the registry appears here without anybody remembering to add it.
function sourcePlans(
  handle: CalendarMeasurementHandle,
  labelPrefix: string,
  scope: { matterId?: string; fromDate?: string; toDate?: string; memberUserId?: string },
  joinKeys: ReadonlyMap<string, readonly string[]>,
): { label: string; statement: NodeSqlStatement }[] {
  const selected =
    scope.memberUserId === undefined
      ? handle.registry.all()
      : handle.registry.all().filter((source) => source.supportsMemberFilter);
  return selected.flatMap((source) => {
    const request: SourceReadRequest = {
      database: handle.snapshot.database,
      scope,
      visibility: handle.visibility,
      cursor: undefined,
      limit: TIMELINE_PAGE_SIZE + 1,
      ascending: false,
      joinKeys: joinKeys.get(source.key),
    };
    return source.buildStatements(request).map((statement, index) => ({
      // A source emitting more than one statement (the custody review source reads a packet's dates
      // and an item's) gets one label per arm, so a scan in the second arm is not hidden by the first.
      label:
        index === 0 ? `${labelPrefix}.${source.key}` : `${labelPrefix}.${source.key}.${index + 1}`,
      statement: capturedStatement(statement),
    }));
  });
}

export async function calendarHotPathPlans(
  handle: CalendarMeasurementHandle,
): Promise<LabeledPlan[]> {
  const { snapshot } = handle;
  const { calendarProbes } = snapshot.manifest;
  const matterScope = { matterId: calendarProbes.deepTimelineMatterId };
  const firmScope = {
    fromDate: calendarProbes.firmWindowFromDate,
    toDate: calendarProbes.firmWindowToDate,
  };

  // The bounded pre-reads the join-reached sources make, resolved exactly as the page resolves them —
  // once per page, never per row. Their results bind the second read, so a plan taken without them
  // would be a plan of a query the product never issues.
  const joinKeys = new Map<string, readonly string[]>();
  for (const source of handle.registry.all()) {
    if (source.resolveJoinKeys === undefined) continue;
    joinKeys.set(source.key, await source.resolveJoinKeys(snapshot.database, matterScope));
  }

  const statements: { label: string; statement: NodeSqlStatement }[] = [
    ...sourcePlans(handle, "timeline.matter", matterScope, joinKeys),
    // The firm scope names no matter, so the join-reached sources resolve no keys and read their
    // whole date window instead — a genuinely different plan, which is why it is probed separately.
    ...sourcePlans(handle, "timeline.firm-window", firmScope, new Map()),
    {
      label: "booking.live-in-window",
      statement: capturedStatement(
        selectLiveBookingsInWindowStatement(snapshot.database, {
          resourceId: calendarProbes.busiestResourceId,
          fromDate: calendarProbes.availabilityFromDate,
          toDate: calendarProbes.availabilityToDate,
          limit: 2_000,
        }),
      ),
    },
  ];
  return statements.map(({ label, statement }) => ({
    label,
    details: explainStatement(snapshot.raw, statement.sql, statement.bindings),
  }));
}
