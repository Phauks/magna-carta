import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIRM_ANCHORED_SOURCE_KEYS, TIMELINE_SOURCES } from "../src/sources/all.ts";
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

// ONE migrated database for the whole file, the way test/visibility-fitness.test.ts and
// test/load-profile.test.ts already do it. Nothing here EXECUTES a statement — every assertion reads
// `.sql` and `.bindings` off what a builder composed — so the handle is only ever a `prepare()`
// factory and sharing it writes no state anything else could see. Building one per composition
// instead re-read every committed per-firm migration off disk and replayed the whole schema, about
// 200 ms a time and roughly seventy-five times across this file: fourteen seconds of DDL to prove a
// property about string concatenation. That is also why this file used to time out on branches that
// never touched the calendar — the work was real, so a machine under load pushed a single case past
// the 5 s default and reported it as a calendar failure. Keep the composition pure and the margin
// stops being a number anyone has to tune.
const { database } = migratedDatabase();

function statementsFor(
  source: (typeof TIMELINE_SOURCES)[number],
  overrides: Partial<SourceReadRequest> = {},
): InspectableStatement[] {
  const request: SourceReadRequest = {
    database,
    scope:
      // A firm-anchored source has no matter to scope by and builds nothing on a matter timeline —
      // its statements are inspected on the firm-wide window, which is the read it exists for.
      source.visibilityAnchor === "firm"
        ? { fromDate: "2026-01-01", toDate: "2026-12-31" }
        : { matterId: MATTER, fromDate: "2026-01-01", toDate: "2026-12-31" },
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

// The declaration, asserted both ways: every matter-anchored source's statement carries the
// predicate marker, and every firm-anchored source is one of a REVIEWED ALLOWLIST — absence of the
// predicate is a declared decision with a named reviewer, never an oversight. The declaresLabel
// idiom, applied to visibility.
describe("every registered source declares its visibility anchor honestly", () => {
  it("every firm-anchored source is on the reviewed allowlist, and the allowlist names only firm anchors", () => {
    const firmAnchored = TIMELINE_SOURCES.filter((source) => source.visibilityAnchor === "firm");
    expect(firmAnchored.map((source) => source.key).sort()).toEqual(
      [...FIRM_ANCHORED_SOURCE_KEYS].sort(),
    );
    expect(Object.isFrozen(FIRM_ANCHORED_SOURCE_KEYS)).toBe(true);
  });

  it("a firm-anchored source composes NO matter predicate and projects a NULL matter", () => {
    for (const source of TIMELINE_SOURCES.filter((entry) => entry.visibilityAnchor === "firm")) {
      const statements = statementsFor(source);
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) {
        // The marker's ABSENCE is the declared behavior here — a firm event has no matter, and a
        // predicate over a NULL expression would silently match nothing.
        expect(statement.sql).not.toContain(VISIBLE_MATTER_MARKER);
        expect(statement.sql).toContain("NULL AS matter_id");
        expect(statement.sql).toContain("LIMIT");
      }
    }
  });

  it("a firm-anchored source contributes nothing to a matter timeline", () => {
    for (const source of TIMELINE_SOURCES.filter((entry) => entry.visibilityAnchor === "firm")) {
      expect(
        statementsFor(source, {
          scope: { matterId: MATTER, fromDate: "2026-01-01", toDate: "2026-12-31" },
        }),
      ).toHaveLength(0);
    }
  });
});

describe("every registered source composes the visible-matter predicate before its LIMIT", () => {
  for (const source of TIMELINE_SOURCES) {
    if (source.visibilityAnchor === "matter") {
      it(`${source.key} composes the predicate into SQL, ahead of the LIMIT`, () => {
        const statements = statementsFor(source);
        expect(statements.length).toBeGreaterThan(0);
        for (const statement of statements) {
          const markerIndex = statement.sql.indexOf(VISIBLE_MATTER_MARKER);
          const limitIndex = statement.sql.lastIndexOf("LIMIT");
          // Composed at all: a source that skips it is a leak.
          expect(markerIndex, `${source.key} does not compose the predicate`).toBeGreaterThan(-1);
          // Composed BEFORE the LIMIT: a predicate applied after the rows come back would
          // under-fill the page and turn the page size into an existence oracle for what it
          // removed.
          expect(limitIndex, `${source.key} has no LIMIT`).toBeGreaterThan(-1);
          expect(markerIndex, `${source.key} filters after its LIMIT`).toBeLessThan(limitIndex);
          // In the WHERE clause, not in a projection or an ORDER BY.
          const whereIndex = statement.sql.indexOf("WHERE");
          expect(markerIndex).toBeGreaterThan(whereIndex);
        }
      });
    }

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
    for (const source of TIMELINE_SOURCES.filter((entry) => entry.visibilityAnchor === "matter")) {
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

// A federated timeline cannot DISAGREE with the register it is built from, because it IS that
// register — and the way that claim gets broken is a source filtering on a date column and forgetting
// the status column beside it. A deed returned on Tuesday stays on the calendar as "due back Friday"
// forever; a will released to the executor keeps showing "review due", named by its custody number,
// for property the firm no longer holds.
//
// So each custody-derived source is PAIRED with the custodian read it mirrors, and the predicates
// asserted on the source are the ones lifted out of that read. The pairing is the point: this is a
// divergence that recurs every time either side gains a status, and a test that only restated the
// predicates would drift with the source rather than against it.
describe("every custody-derived source carries the predicates its register read carries", () => {
  const pairings = [
    {
      sourceKey: "custodyReviewDue",
      mirrors: "selectCustodyReviewsDueStatement in packages/custodian/src/review-statements.ts",
      // The packet statement and the item statement, in the order the source builds them.
      required: [
        ["custody_packet.review_on IS NOT NULL", "custody_packet.status IN ('held', 'out')"],
        [
          "custody_item.review_on IS NOT NULL",
          "custody_item.status IN ('held', 'out')",
          "custody_packet.status IN ('held', 'out')",
        ],
      ],
    },
    {
      sourceKey: "custodyDueBack",
      mirrors: "selectOverdueCustodyCheckoutsStatement in packages/custodian/src/queries.ts",
      required: [
        [
          "custody_movement.due_back_on IS NOT NULL",
          "custody_packet.status = 'out'",
          // Which movement is wanted — the packet's latest check-out of the packet itself rather
          // than of one item inside it — is asserted where that movement is picked out, on both
          // sides of the pairing. Stating either condition a second time in the outer WHERE would
          // filter nothing and would let the planner drive the read from the ledger instead of from
          // the packets that are out.
          "latest.kind = 'checked_out'",
          "latest.item_id IS NULL",
          // The most recent check-out only: a back-dated correction to an old one must not resurrect
          // its deadline over a newer one.
          "ORDER BY latest.occurred_at DESC",
        ],
      ],
    },
  ] as const;

  for (const pairing of pairings) {
    it(`${pairing.sourceKey} carries every predicate of ${pairing.mirrors}`, () => {
      const source = TIMELINE_SOURCES.find((entry) => entry.key === pairing.sourceKey);
      expect(source, `${pairing.sourceKey} is not registered`).toBeDefined();
      const statements = statementsFor(source!);
      expect(statements).toHaveLength(pairing.required.length);
      pairing.required.forEach((predicates, index) => {
        const sql = statements[index]?.sql ?? "";
        for (const predicate of predicates) {
          expect(sql, `${pairing.sourceKey} statement ${index} drops "${predicate}"`).toContain(
            predicate,
          );
        }
      });
    });
  }

  // The other half of each pairing: the register read itself. Scanned as SOURCE TEXT rather than
  // imported, because this package deliberately depends on no other domain package — every source
  // reads its rows by table name. Without this half, deleting a predicate from the custodian would
  // leave the pairing above passing while the two sides had silently stopped agreeing.
  it("the register reads still carry the predicates the sources mirror", () => {
    const custodian = (file: string): string =>
      readFileSync(join(import.meta.dirname, "..", "..", "custodian", "src", file), "utf8");

    const reviews = custodian("review-statements.ts");
    expect(reviews).toContain("packet.status IN ('held', 'out')");
    expect(reviews).toContain("item.status IN ('held', 'out')");

    const overdue = custodian("queries.ts");
    expect(overdue).toContain("packet.status = 'out'");
    // Which movement is wanted is asserted inside the subquery that picks it out, on this side of
    // the pairing exactly as on the source's side.
    expect(overdue).toContain("latest.kind = 'checked_out'");
    expect(overdue).toContain("latest.item_id IS NULL");
    expect(overdue).toContain("ORDER BY latest.occurred_at DESC");
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
