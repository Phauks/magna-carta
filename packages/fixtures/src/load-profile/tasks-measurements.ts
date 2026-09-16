import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { NodeSqlStatement } from "@magna-carta/database/node-sqlite";
import {
  decodeTaskCursor,
  encodeTaskSortKey,
  readMatterTaskDocuments,
  selectMatterTasksStatement,
  selectMyTasksStatement,
  type MatterTaskRow,
} from "@magna-carta/tasks/task-statements";
import { MAX_TASK_PAGE_SIZE } from "@magna-carta/tasks/types";
import { readTaskTimeSummaries } from "@magna-carta/timekeeping/task-time";
import { explainStatement, type LabeledPlan, type Measurement } from "./runner.ts";
import type { LoadedSnapshot } from "./snapshot.ts";

// The task volume-shaped measured set. Two things are the subject here and nothing else in the
// fixture set reaches them:
//
//   1. THE FOUR-TERM KEYSET CURSOR. A task list orders by undated-last, then date, then priority
//      rank, then identifier — where most lists in this codebase order by two terms. Page 20 must
//      not be materially slower than page 1; that is what keyset pagination buys and what a
//      regression takes away silently by falling back to a scan.
//
//   2. THE PAGE'S TIME, IN ONE READ. The grouped time summary fans over a whole page of task
//      identifiers at once, precisely so a rendered list cannot become one round-trip per row. A
//      per-row lookup added inside the projection would not change any single statement's PLAN, so
//      the plan probes below are not what would catch it — the read is measured over a real page's
//      worth of identifiers, and `taskPageBounds` records how many tasks it answered for beside
//      the timings, because a number is the better witness for that failure.
//
// Beside those: the matterless branch of the visibility fragment (the firm's own work, reachable to
// the people on it and its creator and to nobody else), which only the firm-wide read reaches; the state
// and participant filters that make the default list selective; and the search read, which the
// statements module is explicit is a LIKE scan bounded by a narrowing rather than by an index — so
// it is measured with that narrowing in place, which is the only shape the product offers.

export interface TaskMeasurementHandle {
  readonly snapshot: LoadedSnapshot;
  readonly visibility: ReturnType<typeof visibleMatterPredicate>;
}

export function taskMeasurementHandle(snapshot: LoadedSnapshot): TaskMeasurementHandle {
  return { snapshot, visibility: visibleMatterPredicate() };
}

const DEEP_PAGE_NUMBER = 20;

type TaskListRow = MatterTaskRow & { priority_rank: number };
type TaskCursor = NonNullable<ReturnType<typeof decodeTaskCursor>>;

function capturedStatement(statement: SqlStatement): NodeSqlStatement {
  return statement as NodeSqlStatement;
}

function matterPage(handle: TaskMeasurementHandle, cursor: TaskCursor | undefined): SqlStatement {
  const probes = handle.snapshot.manifest.taskProbes;
  return selectMatterTasksStatement(handle.snapshot.database, probes.deepTaskMatterId, {
    cursor,
    limit: MAX_TASK_PAGE_SIZE + 1,
    visibility: handle.visibility,
    viewerUserId: probes.memberUserId,
  });
}

// Walks forward to the requested page and returns the cursor that OPENS it. The walk is untimed —
// what is under measurement is the cost of one page at depth, not the cost of getting there.
async function cursorAtPage(
  handle: TaskMeasurementHandle,
  pageNumber: number,
): Promise<TaskCursor | undefined> {
  let cursor: TaskCursor | undefined;
  for (let page = 1; page < pageNumber; page += 1) {
    const { results } = await matterPage(handle, cursor).all<TaskListRow>();
    if (results.length <= MAX_TASK_PAGE_SIZE) return cursor;
    const last = results[MAX_TASK_PAGE_SIZE - 1];
    if (last === undefined) return cursor;
    // The wire cursor, decoded exactly as the route decodes it — the tasks surface mints no cursor
    // of its own, so walking a page here is the same walk a browser makes.
    cursor = decodeTaskCursor(encodeTaskSortKey(last), last.id);
  }
  return cursor;
}

export const taskMeasurements: readonly Measurement<TaskMeasurementHandle, unknown>[] = [
  {
    name: "tasks.matter-page-1",
    operation: async (handle) => {
      await matterPage(handle, undefined).all<TaskListRow>();
    },
  },
  {
    name: "tasks.matter-page-20",
    // The cursor for page 20 is resolved untimed: paging there is not what a reader does, and timing
    // the walk would measure nineteen pages nobody asked for.
    prepare: async (handle): Promise<TaskCursor | undefined> =>
      cursorAtPage(handle, DEEP_PAGE_NUMBER),
    operation: async (handle, state) => {
      await matterPage(handle, state as TaskCursor | undefined).all<TaskListRow>();
    },
  },
  {
    // The read a member makes most often, and the widest one: every matter they can see, plus their
    // own work on no matter at all. Both halves of the visibility fragment are live here and only
    // here — the matter-scoped list never reaches the nullable branch.
    name: "tasks.my-work-page-1",
    operation: async (handle) => {
      await selectMyTasksStatement(handle.snapshot.database, {
        limit: MAX_TASK_PAGE_SIZE + 1,
        visibility: handle.visibility,
        viewerUserId: handle.snapshot.manifest.taskProbes.memberUserId,
        includeClosedMatters: false,
      }).all<TaskListRow>();
    },
  },
  {
    // The same read narrowed to what is still owed and in this member's name — the two filters a
    // person actually leaves on. What is being watched is that narrowing makes it cheaper.
    name: "tasks.my-work-open-and-mine",
    operation: async (handle) => {
      await selectMyTasksStatement(handle.snapshot.database, {
        limit: MAX_TASK_PAGE_SIZE + 1,
        visibility: handle.visibility,
        viewerUserId: handle.snapshot.manifest.taskProbes.memberUserId,
        includeClosedMatters: false,
        filters: {
          rungs: ["to_do", "in_progress", "on_hold"],
          participantUserId: handle.snapshot.manifest.taskProbes.memberUserId,
        },
      }).all<TaskListRow>();
    },
  },
  {
    // A LIKE scan over title and body, measured WITH the matter narrowing in front of it.
    name: "tasks.search-within-matter",
    operation: async (handle) => {
      const probes = handle.snapshot.manifest.taskProbes;
      await selectMatterTasksStatement(handle.snapshot.database, probes.deepTaskMatterId, {
        limit: MAX_TASK_PAGE_SIZE + 1,
        visibility: handle.visibility,
        viewerUserId: probes.memberUserId,
        filters: { search: probes.searchTerm },
      }).all<TaskListRow>();
    },
  },
  {
    // The page's attachments in ONE read keyed by the tasks on it. Beside the time read below,
    // because the two are the whole of what a rendered page costs on top of the list itself.
    name: "tasks.page-documents",
    operation: async (handle) => {
      const probes = handle.snapshot.manifest.taskProbes;
      await readMatterTaskDocuments(
        handle.snapshot.database,
        probes.pageTaskIds,
        handle.visibility,
        probes.memberUserId,
      );
    },
  },
  {
    // THE READ THIS SLICE ADDED. One grouped statement over a whole page of task identifiers. Its
    // cost must track the PAGE, not the corpus: a regression that turned it into a lookup per task
    // would leave every plan below unchanged and show up here and nowhere else.
    name: "tasks.page-time-summaries",
    operation: async (handle) => {
      await readTaskTimeSummaries(handle.snapshot.database, {
        taskIds: handle.snapshot.manifest.taskProbes.pageTaskIds,
        onlyTimekeeperUserId: null,
      });
    },
  },
  {
    // The same read narrowed to one timekeeper — the member without `time:viewFirm`. One extra bind
    // and one extra predicate, and otherwise the identical shape, so a gap between this and the one
    // above is a gap in the index rather than in the code.
    name: "tasks.page-time-summaries-own",
    operation: async (handle) => {
      const probes = handle.snapshot.manifest.taskProbes;
      await readTaskTimeSummaries(handle.snapshot.database, {
        taskIds: probes.pageTaskIds,
        onlyTimekeeperUserId: probes.memberUserId,
      });
    },
  },
];

// Plans allowed to scan, by name, with the reason each stands on.
//
// THE MATTER-SCOPED LIST IS GATED AND CLEAN: it seeks `matter_task_matter_due_on_id_index`, which is
// what a matter's task list is supposed to look like. So is the NARROWED firm-wide read — name a
// state and a participant and it seeks the participant table's (user_id, task_id) index before
// joining back to matter_task by primary key.
//
// The UNNARROWED firm-wide read is the one that scans, and it is structural rather than a planner
// accident: "everything on my plate" names no matter and no participant, so there is nothing to seek
// on, and its visibility fragment is an OR spanning `matter_id IS NULL` and `matter_id IS NOT NULL`
// — a disjunction over the presence of the very column any useful index would be led by. An index
// cannot answer both arms at once. That the branch is one composable fragment rather than two
// unioned tables is the whole argument for the nullable column, and this is its cost, paid on the
// read that is otherwise the cheapest thing to narrow.
//
// It is exempted BY NAME rather than by prefix, and the exemption is the finding rather than a
// dismissal of it. The trade was made against a number: at the profile corpus the scan costs 2.1 ms
// against 1.1 ms for the same read with `open` plus the member's own name applied — about a
// millisecond, on a read that is already the cheapest thing in the product to narrow and that no
// member leaves unnarrowed for long. If that gap stops being small the answer is a partial index
// over the matterless arm, not a second table: splitting the population back into two tables would
// undo the whole argument for the nullable column. Revisit against `tasks.my-work-page-1` beside
// `tasks.my-work-open-and-mine` in the baseline.
export const TASK_PLAN_SCAN_ALLOWLIST: readonly string[] = ["tasks.my-work-page-1"];

// The plan probes. A task list that fell back to a full scan of matter_task, and a firm-wide read
// that stopped using the matter index behind the visibility fragment, are both regressions no
// timing threshold would reliably catch on a corpus this size.
export function taskHotPathPlans(handle: TaskMeasurementHandle): LabeledPlan[] {
  const probes = handle.snapshot.manifest.taskProbes;
  const statements: { label: string; statement: NodeSqlStatement }[] = [
    { label: "tasks.matter-page-1", statement: capturedStatement(matterPage(handle, undefined)) },
    {
      label: "tasks.my-work-page-1",
      statement: capturedStatement(
        selectMyTasksStatement(handle.snapshot.database, {
          limit: MAX_TASK_PAGE_SIZE + 1,
          visibility: handle.visibility,
          viewerUserId: probes.memberUserId,
          includeClosedMatters: false,
        }),
      ),
    },
    {
      // The narrowed read's own plan. It shares every clause with the one above plus two filters,
      // so a plan that got WORSE here is a filter that stopped being usable as one.
      label: "tasks.my-work-open-and-mine",
      statement: capturedStatement(
        selectMyTasksStatement(handle.snapshot.database, {
          limit: MAX_TASK_PAGE_SIZE + 1,
          visibility: handle.visibility,
          viewerUserId: probes.memberUserId,
          includeClosedMatters: false,
          filters: {
            rungs: ["to_do", "in_progress", "on_hold"],
            participantUserId: probes.memberUserId,
          },
        }),
      ),
    },
  ];
  return statements.map(({ label, statement }) => ({
    label,
    details: explainStatement(handle.snapshot.raw, statement.sql, statement.bindings),
  }));
}

// Recorded beside the timings, and the real witness for the N+1 this slice could grow.
//
// The grouped time read's whole claim is that it costs ONE statement per page of tasks rather than
// one per task. A plan cannot see the difference — a per-task lookup would have the same plan as the
// grouped one — and a timing would only show it once the corpus outgrew the noise. A COUNT states
// it: fifty tasks, one statement. The database handle is wrapped rather than instrumented in the
// product code, so nothing about the read changes to be measured.
export interface TaskPageBounds {
  readonly label: string;
  readonly statementCount: number;
  readonly rowsRead: number;
  readonly sourcesRead: number;
  readonly entriesReturned: number;
}

function countingDatabase(database: LoadedSnapshot["database"]): {
  readonly database: LoadedSnapshot["database"];
  statementCount(): number;
} {
  let statements = 0;
  const counting = {
    ...database,
    prepare(sql: string) {
      statements += 1;
      return database.prepare(sql);
    },
  } as LoadedSnapshot["database"];
  return { database: counting, statementCount: () => statements };
}

export async function taskPageBounds(handle: TaskMeasurementHandle): Promise<TaskPageBounds[]> {
  const probes = handle.snapshot.manifest.taskProbes;
  const { results } = await matterPage(handle, undefined).all<TaskListRow>();

  const counted = countingDatabase(handle.snapshot.database);
  const summaries = await readTaskTimeSummaries(counted.database, {
    taskIds: probes.pageTaskIds,
    onlyTimekeeperUserId: null,
  });
  let entriesCounted = 0;
  for (const summary of summaries.values()) entriesCounted += summary.entryCount;

  return [
    {
      label: "tasks.matter-page-1",
      statementCount: 1,
      rowsRead: results.length,
      sourcesRead: 1,
      entriesReturned: Math.min(results.length, MAX_TASK_PAGE_SIZE),
    },
    {
      label: "tasks.page-time-summaries",
      // ONE for a page inside the bound-parameter cap. Anything that tracks the task count instead
      // of the page count is the regression this bound exists for.
      statementCount: counted.statementCount(),
      rowsRead: entriesCounted,
      sourcesRead: probes.pageTaskIds.length,
      // Every task asked about is answered for, including the ones with nothing logged — a caller
      // rendering a list needs "nothing" to be a value rather than a missing key.
      entriesReturned: summaries.size,
    },
  ];
}
