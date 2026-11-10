import { describe, expect, it } from "vitest";
import { VISIBLE_MATTER_MARKER } from "@magna-carta/calendar/visibility";
import { matterSearchSources } from "../src/sources/all.ts";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { MATTER, seededDatabase, visibility } from "./support.ts";

// The properties every registered source must have, asserted over the SQL each one actually builds
// rather than over the code that is supposed to build it. A source that stopped using the shared
// builder would still typecheck and would still return plausible rows; these are what notice.
//
// This is the same discipline the federated timeline's source-fitness pass uses, and it exists for
// the same reason: the guarantees are worth exactly as much as the proof that every source has them,
// and review does not scale to re-checking four — soon fourteen — statement builders.

// Captures the SQL each source hands to the database, without running any of it. A source that asks
// an index outside the database first is given an index that names one file, so the statement it
// builds from that answer is held to the same properties as every other.
async function statementsFor(query: string): Promise<{ key: string; sql: string }[]> {
  const { database } = seededDatabase();
  const captured: { key: string; sql: string }[] = [];
  for (const source of matterSearchSources.all()) {
    const recorder = {
      prepare: (sql: string): SqlStatement => {
        captured.push({ key: source.key, sql });
        return database.prepare(sql);
      },
    };
    const request = {
      database: recorder,
      matterId: MATTER,
      query,
      visibility,
      limit: 10,
      includeDeleted: false,
      fileContents: {
        query: () =>
          Promise.resolve({
            kind: "passages" as const,
            passages: [{ fileId: "file_anything", chunkId: "page-0" }],
          }),
      },
    };
    if (source.prepare === undefined) source.buildStatements(request);
    else await source.prepare(request);
  }
  return captured;
}

const EVERY_STATEMENT = await statementsFor("easement");

describe("every registered source is bound to one matter", () => {
  it("builds at least one statement", () => {
    const sourcesThatBuilt = new Set(EVERY_STATEMENT.map((statement) => statement.key));
    expect([...sourcesThatBuilt].toSorted()).toEqual(
      matterSearchSources
        .all()
        .map((source) => source.key)
        .toSorted(),
    );
  });

  it.each(EVERY_STATEMENT)("$key binds a matter id", ({ sql }) => {
    // The builder composes `<matter expression> = ?` as the first condition. A source that reached
    // around it to search two matters could not produce this.
    expect(sql).toMatch(/WHERE \S+\.matter_id = \?/u);
  });
});

describe("every registered source composes the visible-matter predicate", () => {
  it.each(EVERY_STATEMENT)("$key carries the predicate's own marker", ({ sql }) => {
    // The marker is part of the predicate's text rather than a comment appended to it, so a
    // statement that does not contain it did not compose the predicate — a formatter cannot strip
    // this the way it could strip a comment.
    expect(sql).toContain(VISIBLE_MATTER_MARKER);
  });

  it.each(EVERY_STATEMENT)("$key composes it BEFORE the limit", ({ sql }) => {
    // Applying it afterwards would under-fill the answer and turn the limit into an existence
    // oracle for the rows it removed.
    expect(sql.indexOf(VISIBLE_MATTER_MARKER)).toBeLessThan(sql.lastIndexOf("LIMIT"));
  });
});

describe("every registered source is bounded", () => {
  it.each(EVERY_STATEMENT)("$key carries a LIMIT", ({ sql }) => {
    expect(sql).toContain("LIMIT ?");
  });

  it.each(EVERY_STATEMENT)(
    "$key orders totally, so a tie cannot reorder between reads",
    ({ sql }) => {
      expect(sql).toMatch(/ORDER BY .+, \S+ (ASC|DESC)/u);
    },
  );
});

describe("every registered source escapes the text it matches on", () => {
  it.each(EVERY_STATEMENT)("$key names an ESCAPE on every LIKE", ({ sql }) => {
    // SQLite's LIKE takes no escape character unless one is NAMED, so an unescaped pattern is not a
    // syntax error — it is a query that quietly matches more than it should. Counting the two
    // against each other is what catches a LIKE that lost its ESCAPE rather than never had one.
    const likes = sql.match(/LIKE \?/gu) ?? [];
    const escapes = sql.match(/LIKE \? ESCAPE '\\'/gu) ?? [];
    expect(escapes).toHaveLength(likes.length);
  });
});

// The rule that is not about correctness but about disclosure, and the one worth a fitness test more
// than any other here.
describe("no registered source can reach a review set", () => {
  it.each(EVERY_STATEMENT)("$key names no discovery review table", ({ sql }) => {
    // packages/search/src/corpus.ts made a review set its own corpus precisely so that an ordinary
    // matter search is structurally unable to name material an opposing party produced — which may
    // be attorney's-eyes-only under a protective order. A matter search that could reach it would
    // be a disclosure nobody authorized, and it would look exactly like a helpful new source.
    expect(sql).not.toMatch(/\breview_(set|document|load|tag|coding)\b/u);
    expect(sql).not.toMatch(/\bdiscovery_/u);
  });
});

describe("the registry itself", () => {
  it("refuses two sources claiming one key", () => {
    const duplicate = matterSearchSources.all()[0];
    if (duplicate === undefined) throw new Error("registry is empty");
    expect(
      () =>
        new (matterSearchSources.constructor as never as new (s: unknown[]) => unknown)([
          duplicate,
          duplicate,
        ]),
    ).toThrow(/duplicate matter search source key/u);
  });

  it("declares a section slug for every source, so a hit knows which tab it opens", () => {
    for (const source of matterSearchSources.all()) {
      expect(source.sectionSlug).not.toBe("");
      expect(source.matchedFields.length).toBeGreaterThan(0);
    }
  });

  it("declares a snippet decision for every source rather than leaving it to chance", () => {
    for (const source of matterSearchSources.all()) {
      expect(typeof source.declaresSnippet).toBe("boolean");
    }
  });

  it("projects no snippet from a source that declares it has none", () => {
    const projected = matterSearchSources.all().map((source) => ({
      key: source.key,
      declares: source.declaresSnippet,
      snippet: source.project({
        row_id: "row",
        matter_id: MATTER,
        sort_key: "2026-08-01T00:00:00.000Z",
        title: "A title",
        snippet: "an excerpt that should not survive a false declaration",
        secondary: null,
        actor_user_id: null,
      }).snippet,
    }));
    for (const entry of projected) {
      if (entry.declares) continue;
      // A source declaring no snippet must not have one in its SELECT either — the projection is
      // faithful, so this is checked at the statement instead.
      const statement = EVERY_STATEMENT.find((candidate) => candidate.key === entry.key);
      expect(statement?.sql).toContain("NULL AS snippet");
    }
  });
});
