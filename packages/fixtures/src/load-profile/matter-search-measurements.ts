import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { DatabaseSync } from "node:sqlite";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { matterSearchSources } from "@magna-carta/matter-search/sources";
import type { MatterId } from "@magna-carta/identifiers/types";
import { explainStatement, type LabeledPlan } from "./runner.ts";

// The consolidated matter search, measured for the one thing that decides whether it can grow.
//
// TWO KINDS OF MATCH, AND ONE QUESTION ASKED OF BOTH. A source matching a name or a number uses
// `LIKE '%term%'`, which no index can serve: that is the nature of a substring match, and measuring
// it as though an index could would be measuring the wrong thing. A source matching prose asks the
// firm's record index for the words, narrowed inside the index to the matter. What decides whether
// either is affordable is the same: whether the read is fenced to ONE case's rows, or runs over
// every row the firm has ever written.
//
// That distinction is the whole gate in front of adding more sources. A matter's notes and custody
// packets are counted in tens, so even a careless plan would look fine on them; a long-running
// matter's time entries and files run to thousands, and the firm's run to millions. A source whose
// matter filter is not index-served is one that gets slower as the FIRM grows rather than as the
// MATTER does, and the difference does not show up until a firm is large enough that finding out is
// expensive.
//
// So the assertions here are structural rather than timed: no statement the registry builds may
// read a whole table — an ordinary one without an index, or the full-text one without a match. A
// materialised SORT is a second question and is answered separately in the smoke, because it is
// acceptable in a place a full scan never is — the rows a sort materialises here are rows the read
// has already narrowed to one matter, so it adds a log factor to work already done rather than a
// new dependency on the size of the firm. Plan shape is timing-noise-free, which is what makes this
// a gate rather than a reading.

export interface MatterSearchPlanInput {
  readonly database: SqlDatabase;
  readonly raw: DatabaseSync;
  readonly matterId: MatterId;
  // The term the plans are taken against. A real word rather than a single letter, because a query
  // below a source's minimum builds no statement at all and would silently measure nothing.
  readonly query: string;
}

// Every statement every registered source builds, labelled by source key. Reading them from the
// REGISTRY rather than listing them is what makes this gate grow with the search: a source added
// without an index-served matter filter fails here without anybody remembering to add it.
//
// A source that asks an index outside the database first is planned the same way: it is handed an
// index that names a full page of candidate files, and the statement it then builds over the firm's
// own table is what is planned. What the index itself costs is not a database plan and is measured
// where the engine is (crates/search-eval).
export async function matterSearchHotPathPlans(
  input: MatterSearchPlanInput,
): Promise<LabeledPlan[]> {
  const plans: LabeledPlan[] = [];
  for (const source of matterSearchSources.all()) {
    const captured: { sql: string; bindings: readonly unknown[] }[] = [];
    const recorder: SqlDatabase = {
      prepare: (sql: string) => {
        const statement = {
          sql,
          bind: (...values: unknown[]) => {
            captured.push({ sql, bindings: values });
            return input.database.prepare(sql).bind(...values);
          },
          run: () => {
            throw new Error("the plan capture never runs a statement");
          },
          all: () => {
            throw new Error("the plan capture never runs a statement");
          },
          first: () => {
            throw new Error("the plan capture never runs a statement");
          },
        };
        return statement as ReturnType<SqlDatabase["prepare"]>;
      },
    };
    const request = {
      database: recorder,
      matterId: input.matterId,
      query: input.query,
      visibility: visibleMatterPredicate(),
      limit: PLANNED_LIMIT,
      includeDeleted: false,
      fileContents: {
        query: () =>
          Promise.resolve({
            kind: "passages" as const,
            // One more file than the limit, which is the most the source ever asks the table for.
            passages: Array.from({ length: PLANNED_LIMIT + 1 }, (_unused, index) => ({
              fileId: `file_planned${String(index).padStart(4, "0")}`,
              chunkId: "page-0",
            })),
          }),
      },
    };
    if (source.prepare === undefined) source.buildStatements(request);
    else await source.prepare(request);
    captured.forEach((statement, index) => {
      plans.push({
        label:
          captured.length === 1
            ? `matter-search.${source.key}`
            : `matter-search.${source.key}.${index}`,
        details: explainStatement(input.raw, statement.sql, statement.bindings),
      });
    });
  }
  return plans;
}

const PLANNED_LIMIT = 50;

// Plans allowed to carry a full table scan. EMPTY, and it should stay that way: a matter search that
// scans a table scans every firm-wide row of it, which is the one shape this whole measurement
// exists to refuse. An entry here would need to say which table, why the matter cannot narrow it
// first, and what bounds the read instead.
export const MATTER_SEARCH_PLAN_SCAN_ALLOWLIST: readonly string[] = [];

// The sources that materialise their sort, as a REGISTER rather than a pass mark. Every one of these
// is acceptable, and the rule that makes it acceptable is the same for all of them: the rows being
// sorted are rows the read has ALREADY narrowed to one matter, so the sort adds a log factor to work
// already done rather than a new dependency on the size of the firm. A source that sorted rows it
// had not already narrowed would fail the scan assertion above first, which is why that one is a
// bar and this one is a list.
//
// It is a list rather than a blanket allowance so that a NEW source materialising a sort has to be
// added deliberately, with somebody looking at whether it could cheaply have been avoided:
//
//   billing      — sorts on created_at; the matter index leads (matter_id, invoice_id).
//   calendar     — the record index leads, so the rows arrive in the index's order and are the
//                  events on this matter that contain the words; they are sorted by starts_on.
//   costs        — the record index leads; the matching costs on this matter, sorted by
//                  incurred_date.
//   notes        — the record index leads; the matching notes on this matter, sorted by
//                  COALESCE(occurred_on, date(created_at)), the Notes tab's own order.
//   parties      — sorts on the case-folded display name, resolved per row by subquery.
//   time         — the record index leads; the matching entries on this matter, sorted by
//                  work_date.
//
// WHAT AN INDEX-LED SOURCE COSTS, so nobody has to re-derive it: it reads the records on the matter
// that MATCH, sorts them, and returns the first page. For a selective word that is a handful of
// rows where the scan it replaced read the matter's every row; for a word in most of a long
// matter's entries it is most of them, which is about what the scan cost. Golden rule 10: recorded,
// and not bought down further without a measured problem.
export const MATTER_SEARCH_MATERIALISED_SORTS: readonly string[] = [
  "matter-search.billing",
  "matter-search.calendar",
  "matter-search.costs",
  "matter-search.notes",
  "matter-search.parties",
  "matter-search.time",
];
