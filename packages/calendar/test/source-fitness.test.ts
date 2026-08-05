import { describe, expect, it } from "vitest";
import { TIMELINE_SOURCES } from "../src/sources/all.ts";
import type { SourceReadRequest } from "../src/sources/registry.ts";
import { VISIBLE_MATTER_MARKER, visibleMatterPredicate } from "../src/visibility.ts";
import { MATTER, migratedDatabase } from "./support.ts";

// The structural proof. Every property below is asserted for EVERY registered source from one
// table-driven pass rather than once per source, so a source added tomorrow is held to it without
// anybody remembering to write its test.

interface InspectableStatement {
  readonly sql: string;
  readonly bindings: readonly unknown[];
}

function statementsFor(
  source: (typeof TIMELINE_SOURCES)[number],
  overrides: Partial<SourceReadRequest> = {},
): InspectableStatement[] {
  const { database } = migratedDatabase();
  const request: SourceReadRequest = {
    database,
    scope: { matterId: MATTER, fromDate: "2026-01-01", toDate: "2026-12-31" },
    visibility: visibleMatterPredicate(),
    cursor: { sortKey: "2026-06-01", id: "row_seed" },
    limit: 51,
    ascending: false,
    // The join-reached sources are handed a resolved key so they build rather than short-circuit;
    // the short-circuit itself is asserted separately below.
    joinKeys: ["custodyPacket_seed0000000000000000", "trustLedgerNode_seed00000000000000"],
    ...overrides,
  };
  return source.buildStatements(request) as unknown as InspectableStatement[];
}

describe("every registered source composes the visible-matter predicate before its LIMIT", () => {
  for (const source of TIMELINE_SOURCES) {
    it(`${source.key} composes the predicate into SQL, ahead of the LIMIT`, () => {
      const statements = statementsFor(source);
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) {
        const markerIndex = statement.sql.indexOf(VISIBLE_MATTER_MARKER);
        const limitIndex = statement.sql.lastIndexOf("LIMIT");
        // Composed at all: a source that skips it is a leak.
        expect(markerIndex, `${source.key} does not compose the predicate`).toBeGreaterThan(-1);
        // Composed BEFORE the LIMIT: a predicate applied after the rows come back would under-fill
        // the page and turn the page size into an existence oracle for what it removed.
        expect(limitIndex, `${source.key} has no LIMIT`).toBeGreaterThan(-1);
        expect(markerIndex, `${source.key} filters after its LIMIT`).toBeLessThan(limitIndex);
        // In the WHERE clause, not in a projection or an ORDER BY.
        const whereIndex = statement.sql.indexOf("WHERE");
        expect(markerIndex).toBeGreaterThan(whereIndex);
      }
    });

    it(`${source.key} is bounded and keyset-paginated from the shared cursor`, () => {
      for (const statement of statementsFor(source)) {
        expect(statement.sql).toContain("LIMIT");
        // The keyset predicate over the same (sort key, id) pair the merge compares, so one cursor
        // serves every source from one global position.
        expect(statement.bindings).toContain("2026-06-01");
        expect(statement.bindings).toContain("row_seed");
        expect(statement.bindings.at(-1)).toBe(51);
      }
    });

    it(`${source.key} projects no privileged column`, () => {
      for (const statement of statementsFor(source)) {
        const selectList = statement.sql.slice(
          statement.sql.indexOf("SELECT"),
          statement.sql.indexOf(" FROM "),
        );
        // A timeline entry is a reference, not a record: no title, no description, no narrative, no
        // authority note, no participant or counterparty name reaches a merged page.
        for (const forbidden of [
          "title",
          "description",
          "narrative",
          "authority_text",
          "counterparty_name",
          "borrower_name",
          "participant_name",
          "satisfaction_note",
          "state_reason",
          "subject_parties",
          "file.name",
          "client_display_name",
        ]) {
          expect(selectList, `${source.key} projects ${forbidden}`).not.toContain(forbidden);
        }
      }
    });

    it(`${source.key} declares its label decision either way`, () => {
      // Absence is a DECLARED decision, never an oversight: a source either has a non-privileged
      // summary or says it has none, and the projection matches what it declared.
      expect(typeof source.declaresLabel).toBe("boolean");
      for (const statement of statementsFor(source)) {
        const projectsNull = / NULL AS label/.test(statement.sql);
        if (!source.declaresLabel) {
          expect(projectsNull, `${source.key} declares no label but projects one`).toBe(true);
        }
      }
    });
  }

  it("holds for a firm-wide window with no matter in scope", () => {
    for (const source of TIMELINE_SOURCES) {
      const statements = statementsFor(source, {
        scope: { fromDate: "2026-08-01", toDate: "2026-08-31" },
        joinKeys: [],
      });
      for (const statement of statements) {
        expect(statement.sql, `${source.key} on a firm-wide window`).toContain(
          VISIBLE_MATTER_MARKER,
        );
        expect(statement.sql.indexOf(VISIBLE_MATTER_MARKER)).toBeLessThan(
          statement.sql.lastIndexOf("LIMIT"),
        );
      }
    }
  });

  it("issues no statement at all where a join-reached source cannot match", () => {
    // A matter with no custody packets and no trust leaf matches nothing, so the source builds
    // nothing rather than a query that cannot hit — the read count stays honest.
    for (const source of TIMELINE_SOURCES.filter((entry) => entry.resolveJoinKeys !== undefined)) {
      expect(statementsFor(source, { joinKeys: [] })).toHaveLength(0);
    }
  });
});

describe("the registry is a reviewed list, not a discovery", () => {
  it("carries unique keys and a closed kind set per source", () => {
    const keys = TIMELINE_SOURCES.map((source) => source.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const source of TIMELINE_SOURCES) {
      expect(source.kinds.length).toBeGreaterThan(0);
    }
  });
});
