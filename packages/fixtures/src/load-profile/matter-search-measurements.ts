import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { DatabaseSync } from "node:sqlite";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { matterSearchSources } from "@magna-carta/matter-search/sources";
import type { MatterId } from "@magna-carta/identifiers/types";
import { explainStatement, type LabeledPlan } from "./runner.ts";

// The consolidated matter search, measured for the one thing that decides whether it can grow.
//
// EVERY SOURCE MATCHES WITH `LIKE '%term%'`, AND NO INDEX CAN SERVE THAT. That is not a defect to
// fix, it is the nature of a substring match, and measuring it as though an index could would be
// measuring the wrong thing. What decides whether the search is affordable is the step BEFORE the
// match: whether the matter narrowing is served by an index, so the scan runs over ONE case's rows
// rather than over every row the firm has ever written.
//
// That distinction is the whole gate in front of adding more sources. A matter's notes and custody
// packets are counted in tens, so even a careless plan would look fine on them; a long-running
// matter's time entries and files run to thousands, and the firm's run to millions. A source whose
// matter filter is not index-served is one that gets slower as the FIRM grows rather than as the
// MATTER does, and the difference does not show up until a firm is large enough that finding out is
// expensive.
//
// So the assertions here are structural rather than timed: every statement the registry builds must
// SEARCH an index for its matter. A materialised SORT is a second question and is answered
// separately in the smoke, because it is acceptable in a place a full scan never is — the rows a
// sort materialises here are the rows the substring scan has already read, bounded by one matter, so
// it adds a log factor to work already done rather than a new dependency on the size of the firm.
// Plan shape is timing-noise-free, which is what makes this a gate rather than a reading.

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
export function matterSearchHotPathPlans(input: MatterSearchPlanInput): LabeledPlan[] {
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
    source.buildStatements({
      database: recorder,
      matterId: input.matterId,
      query: input.query,
      visibility: visibleMatterPredicate(),
      limit: 50,
      includeDeleted: false,
    });
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

// Plans allowed to carry a full table scan. EMPTY, and it should stay that way: a matter search that
// scans a table scans every firm-wide row of it, which is the one shape this whole measurement
// exists to refuse. An entry here would need to say which table, why the matter cannot narrow it
// first, and what bounds the read instead.
export const MATTER_SEARCH_PLAN_SCAN_ALLOWLIST: readonly string[] = [];
