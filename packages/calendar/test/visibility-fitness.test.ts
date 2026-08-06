import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MATTER_DEADLINE_TABLE,
  selectMatterDeadlineStatement,
  selectMatterDeadlinesStatement,
  selectOpenDeadlineTimeZonesStatement,
} from "../src/deadline-statements.ts";
import {
  MATTER_EVENT_TABLE,
  selectMatterEventStatement,
  selectMatterEventsStatement,
} from "../src/event-statements.ts";
import { VISIBLE_MATTER_MARKER, visibleMatterPredicate } from "../src/visibility.ts";
import { MATTER, migratedDatabase } from "./support.ts";

// The seam's whole value proposition is that an information-barrier overlay is ONE MORE CLAUSE in one
// predicate and every read inherits it. `test/source-fitness.test.ts` proves that for the federated
// sources, which cannot decline the predicate because it is a required field on their request. The
// DIRECT reads of the two tables this package owns are the other half, and they were the half that
// escaped: `GET /api/v1/events/{eventId}` resolved an event by identifier with no matter check at
// all, so the day the overlay landed those reads would have shipped with the barrier off — and been
// believed complete, because the seam's own documentation says every read inherits it.

interface InspectableStatement {
  readonly sql: string;
}

const { database } = migratedDatabase();
const visibility = visibleMatterPredicate();
const deadlineFragment = {
  visibilityFragment: visibility.fragmentFor(`${MATTER_DEADLINE_TABLE}.matter_id`),
  visibilityBindings: visibility.bindings,
};
const EVENT_ID = "matterEvent_fitness00000000000" as never;
const DEADLINE_ID = "matterDeadline_fitness00000000" as never;

const directReads: { readonly name: string; readonly statement: InspectableStatement }[] = [
  {
    name: "selectMatterEventStatement",
    statement: selectMatterEventStatement(database, EVENT_ID, visibility) as InspectableStatement,
  },
  {
    name: "selectMatterEventsStatement",
    statement: selectMatterEventsStatement(database, MATTER, {
      limit: 50,
      visibility,
    }) as InspectableStatement,
  },
  {
    name: "selectMatterDeadlineStatement",
    statement: selectMatterDeadlineStatement(
      database,
      DEADLINE_ID,
      visibility,
    ) as InspectableStatement,
  },
  {
    name: "selectMatterDeadlinesStatement",
    statement: selectMatterDeadlinesStatement(database, {
      limit: 50,
      ...deadlineFragment,
    }) as InspectableStatement,
  },
  {
    name: "selectOpenDeadlineTimeZonesStatement",
    statement: selectOpenDeadlineTimeZonesStatement(database, {
      throughDate: "2026-08-07",
      limit: 64,
      ...deadlineFragment,
    }) as InspectableStatement,
  },
];

describe("every direct read of an event or a deadline composes the visible-matter predicate", () => {
  for (const { name, statement } of directReads) {
    it(`${name} carries the marker in its WHERE clause, ahead of any LIMIT`, () => {
      const markerIndex = statement.sql.indexOf(VISIBLE_MATTER_MARKER);
      expect(markerIndex, `${name} does not compose the predicate`).toBeGreaterThan(-1);
      expect(markerIndex).toBeGreaterThan(statement.sql.indexOf("WHERE"));
      const limitIndex = statement.sql.lastIndexOf("LIMIT");
      if (limitIndex > -1) expect(markerIndex).toBeLessThan(limitIndex);
    });
  }

  // The enumeration above is worth something only if it is complete, and a read that forgot the
  // predicate is exactly the read that would also forget to register itself here. So the two
  // statement files are scanned (comments stripped first, so the prose explaining the rule cannot
  // pass the scan) for every `FROM <table>` they build. Adding a read moves this count and fails
  // here until the read is listed above and proved to carry the predicate.
  //
  // The one expected extra is the edit path's precondition fence, which re-selects a deadline's own
  // row by primary key to re-assert its state inside the write batch. It reaches no matter the
  // caller has not already resolved through a predicate-carrying read.
  it("enumerates every read of these two tables that the package builds", () => {
    const reads =
      selectsOver("event-statements.ts", MATTER_EVENT_TABLE) +
      selectsOver("deadline-statements.ts", MATTER_DEADLINE_TABLE);
    expect(reads).toBe(directReads.length + 1);
  });
});

function selectsOver(file: string, table: string): number {
  const source = readFileSync(join(import.meta.dirname, "..", "src", file), "utf8");
  const withoutComments = source.replace(/^\s*\/\/.*$/gm, "");
  const needle = `FROM \${${table === MATTER_EVENT_TABLE ? "MATTER_EVENT_TABLE" : "MATTER_DEADLINE_TABLE"}}`;
  return withoutComments.split(needle).length - 1;
}
