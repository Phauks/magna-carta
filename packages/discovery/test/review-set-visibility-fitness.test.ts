import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCESS_SCOPED_BUILDERS } from "../src/coding-statements.ts";
import {
  REVIEW_SET_ACCESS_MARKER,
  reviewSetAccessPredicate,
} from "../src/review-set-visibility.ts";
import { migratedDatabase, REVIEWER } from "./support.ts";

// THE STRUCTURAL PROOF that the review-set access list is a wall rather than a hint.
//
// Every property below is asserted for EVERY registered builder from one table-driven pass rather
// than once per builder, so a read added tomorrow is held to it without anybody remembering to write
// its test. Access control is exactly where a quiet bug becomes a confidentiality breach, and the
// quiet bug in question has one shape: filtering in the Worker after the rows come back.

interface InspectableStatement {
  readonly sql: string;
  readonly bindings: readonly unknown[];
}

function statementFor(builder: (typeof ACCESS_SCOPED_BUILDERS)[number]): InspectableStatement {
  const { database } = migratedDatabase();
  return builder.build(
    database,
    reviewSetAccessPredicate(REVIEWER),
  ) as unknown as InspectableStatement;
}

describe("every access-scoped builder composes the predicate in SQL", () => {
  it("has builders to check (the sweep is not vacuous)", () => {
    // Without this, an empty registry would make every assertion below pass trivially — which is
    // precisely the failure mode of a wall nobody is standing behind.
    expect(ACCESS_SCOPED_BUILDERS.length).toBeGreaterThan(15);
    const keys = ACCESS_SCOPED_BUILDERS.map((builder) => builder.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  for (const builder of ACCESS_SCOPED_BUILDERS) {
    it(`${builder.key} carries the predicate marker`, () => {
      const statement = statementFor(builder);
      // Composed at all: a builder that skips it reads another firm's corpus for anyone holding the
      // permission, which is the disclosure the whole namespace exists to prevent.
      expect(
        statement.sql.includes(REVIEW_SET_ACCESS_MARKER),
        `${builder.key} does not compose the access predicate`,
      ).toBe(true);
      // And binds the member it was built for. A marker present with nobody bound would be a
      // predicate that matched whatever the previous binding happened to be.
      expect(statement.bindings).toContain(REVIEWER);
    });

    it(`${builder.key} composes it inside the WHERE clause, never a projection`, () => {
      const statement = statementFor(builder);
      const markerIndex = statement.sql.indexOf(REVIEW_SET_ACCESS_MARKER);
      const whereIndex = statement.sql.indexOf("WHERE");
      expect(whereIndex, `${builder.key} has no WHERE clause`).toBeGreaterThan(-1);
      expect(markerIndex).toBeGreaterThan(whereIndex);
    });

    if (builder.pages) {
      it(`${builder.key} composes it BEFORE the LIMIT`, () => {
        const statement = statementFor(builder);
        const markerIndex = statement.sql.indexOf(REVIEW_SET_ACCESS_MARKER);
        const limitIndex = statement.sql.lastIndexOf("LIMIT");
        expect(limitIndex, `${builder.key} has no LIMIT`).toBeGreaterThan(-1);
        // A predicate applied after the rows come back would under-fill the page and turn the page
        // size into an existence oracle for what it removed.
        expect(markerIndex, `${builder.key} filters after its LIMIT`).toBeLessThan(limitIndex);
      });
    }
  }
});

// The other half of the proof, and the half a marker check cannot give: the predicate actually
// EXCLUDES. A marker that composed into a clause SQLite treats as always-true would satisfy every
// assertion above.
describe("the predicate excludes a corpus the member is not on the list for", () => {
  it("a member on no list reads nothing, and one on the list reads their own rows", async () => {
    const { database } = migratedDatabase();
    const onTheList = reviewSetAccessPredicate(REVIEWER);
    const onNoList = reviewSetAccessPredicate("user_nobodyAtAll0000" as typeof REVIEWER);

    const reachable = await database
      .prepare(`SELECT 1 AS ok WHERE ${onTheList.fragmentFor("?")}`)
      .bind("reviewSet_codingTest00000000000000", ...onTheList.bindings)
      .all<{ ok: number }>();
    expect(reachable.results).toHaveLength(1);

    const unreachable = await database
      .prepare(`SELECT 1 AS ok WHERE ${onNoList.fragmentFor("?")}`)
      .bind("reviewSet_codingTest00000000000000", ...onNoList.bindings)
      .all<{ ok: number }>();
    expect(unreachable.results).toHaveLength(0);
  });

  it("the walled review set is absent for the member who is not on its list", async () => {
    const { database } = migratedDatabase();
    const access = reviewSetAccessPredicate(REVIEWER);
    const walled = await database
      .prepare(`SELECT 1 AS ok WHERE ${access.fragmentFor("?")}`)
      .bind("reviewSet_walledTest00000000000000", ...access.bindings)
      .all<{ ok: number }>();
    // ABSENT, not refused: no row, no count, and nothing that names the corpus.
    expect(walled.results).toHaveLength(0);
  });
});

// The registry is a list somebody maintains, so it can fall behind the file it describes. This scans
// the source for exported statement builders that take the predicate and asserts each one is
// registered — without it, the sweep above proves things about whatever happens to be on the list.
describe("the registry names every access-taking builder in the source", () => {
  it("every exported statement builder that takes the predicate is registered", () => {
    const source = readFileSync(
      join(import.meta.dirname, "..", "src", "coding-statements.ts"),
      "utf8",
    );
    // Function declarations whose parameter list mentions the predicate type.
    const declared = new Set<string>();
    const pattern = /export function (\w*Statement)\(([\s\S]*?)\n\)/g;
    for (const match of source.matchAll(pattern)) {
      const [, name, parameters] = match;
      if (name !== undefined && parameters?.includes("ReviewSetAccessPredicate") === true) {
        declared.add(name);
      }
    }
    expect(declared.size, "found no access-taking builders to check").toBeGreaterThan(15);

    const registered = new Set(ACCESS_SCOPED_BUILDERS.map((builder) => `${builder.key}Statement`));
    for (const name of declared) {
      expect(registered.has(name), `${name} takes the access predicate but is not registered`).toBe(
        true,
      );
    }
  });
});
