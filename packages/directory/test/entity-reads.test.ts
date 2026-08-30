import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import { describe, expect, test } from "vitest";
import { readEntityDisplayNames } from "../src/entity-display.ts";
import { addName, changeName, readNames } from "../src/name-history.ts";
import { createOrganization } from "../src/organization.ts";
import { createPerson } from "../src/person.ts";
import { searchNames } from "../src/search.ts";

// The reads a list surface needs: naming many entities in one query, reading a name history back,
// and knowing WHICH name a search hit landed on.

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

// Each write gets its own instant so the history's created_at ordering is real rather than a tie
// broken by identifier.
function clockAt(instant: string) {
  return { now: () => instant };
}

function options(instant: string, seed: string) {
  return { clock: clockAt(instant), actorUserId: null, randomSource: seededRandomSource(seed) };
}

describe("readEntityDisplayNames", () => {
  test("names people and organizations together, in the order asked", async () => {
    const database = freshDatabase();
    const personId = await createPerson(
      database,
      { given: "Ada", family: "Lovelace" },
      options("2026-06-01T00:00:00.000Z", "n-a"),
    );
    const organizationId = await createOrganization(
      database,
      { legalName: "Babbage Engines Limited", displayName: null },
      options("2026-06-02T00:00:00.000Z", "n-b"),
    );

    const named = await readEntityDisplayNames(database, [organizationId, personId]);

    expect(named.map((entry) => entry.entityId)).toEqual([organizationId, personId]);
    expect(named[0]).toMatchObject({
      entityKind: "organization",
      displayName: "Babbage Engines Limited",
      mergedIntoId: null,
    });
    expect(named[1]).toMatchObject({ entityKind: "person", displayName: "Ada Lovelace" });
  });

  test("omits an id the firm holds no live record for rather than naming it null", async () => {
    const database = freshDatabase();
    const personId = await createPerson(
      database,
      { given: "Ada", family: "Lovelace" },
      options("2026-06-01T00:00:00.000Z", "n-c"),
    );

    const named = await readEntityDisplayNames(database, [
      personId,
      "directoryPerson_notaperson0000000000",
      "notAHandleAtAll",
    ]);

    expect(named.map((entry) => entry.entityId)).toEqual([personId]);
  });

  test("reads nothing about the entity beyond its identity — one query per node table", async () => {
    const database = freshDatabase();
    const ids: string[] = [];
    for (let index = 0; index < 5; index++) {
      ids.push(
        await createPerson(
          database,
          { given: `Person${String(index)}`, family: "Ofmany" },
          options(`2026-06-0${String(index + 1)}T00:00:00.000Z`, `n-many-${String(index)}`),
        ),
      );
    }

    const named = await readEntityDisplayNames(database, ids);

    expect(named).toHaveLength(5);
    // The shape is display identity and nothing else: no identifier, no contact detail, no value a
    // decrypt would have produced.
    expect(Object.keys(named[0] ?? {}).sort()).toEqual([
      "displayName",
      "entityId",
      "entityKind",
      "mergedIntoId",
    ]);
  });
});

describe("readNames", () => {
  test("reads a marriage back as history — the new current name, and the maiden name kept", async () => {
    const database = freshDatabase();
    const personId = await createPerson(
      database,
      { given: "Mary", family: "Jones" },
      options("2026-06-01T00:00:00.000Z", "h-a"),
    );
    await changeName(
      database,
      personId,
      { given: "Mary", family: "Smith" },
      options("2026-06-02T00:00:00.000Z", "h-b"),
    );

    const page = await readNames(database, personId);

    expect(page.nextCursor).toBeNull();
    expect(page.data.map((name) => [name.displayName, name.nameRole, name.isCurrent])).toEqual([
      ["Mary Smith", "current", true],
      ["Mary Jones", "former", false],
    ]);
    // The superseded name carries the instant it stopped being used; the current one does not.
    expect(page.data[0]?.validTo).toBeNull();
    expect(page.data[1]?.validTo).toBe("2026-06-02T00:00:00.000Z");
  });

  test("carries an appended alias with its own role, current name untouched", async () => {
    const database = freshDatabase();
    const personId = await createPerson(
      database,
      { given: "Mary", family: "Smith" },
      options("2026-06-01T00:00:00.000Z", "h-c"),
    );
    await addName(
      database,
      personId,
      { nameRole: "maiden", given: "Mary", family: "Jones" },
      options("2026-06-02T00:00:00.000Z", "h-d"),
    );

    const page = await readNames(database, personId);

    expect(page.data.map((name) => name.nameRole)).toEqual(["maiden", "current"]);
    expect(page.data.filter((name) => name.isCurrent)).toHaveLength(1);
  });

  test("pages, newest recorded first", async () => {
    const database = freshDatabase();
    const personId = await createPerson(
      database,
      { given: "Mary", family: "One" },
      options("2026-06-01T00:00:00.000Z", "h-e"),
    );
    await changeName(
      database,
      personId,
      { given: "Mary", family: "Two" },
      options("2026-06-02T00:00:00.000Z", "h-f"),
    );
    await changeName(
      database,
      personId,
      { given: "Mary", family: "Three" },
      options("2026-06-03T00:00:00.000Z", "h-g"),
    );

    const first = await readNames(database, personId, { pageSize: 2 });
    expect(first.data.map((name) => name.family)).toEqual(["Three", "Two"]);
    expect(first.nextCursor).not.toBeNull();

    const second = await readNames(database, personId, {
      pageSize: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.data.map((name) => name.family)).toEqual(["One"]);
    expect(second.nextCursor).toBeNull();
  });

  test("an organization's former name survives as the case-folded form it was indexed under", async () => {
    const database = freshDatabase();
    const organizationId = await createOrganization(
      database,
      { legalName: "Old Trading Name Limited", displayName: null },
      options("2026-06-01T00:00:00.000Z", "h-h"),
    );
    await changeName(
      database,
      organizationId,
      { legalName: "New Trading Name Limited" },
      options("2026-06-02T00:00:00.000Z", "h-i"),
    );

    const page = await readNames(database, organizationId);

    // No name parts on an organization row, so displayName is honestly null and the caller reads
    // normalizedDisplay rather than being handed a capitalization nothing recorded.
    expect(page.data[1]?.displayName).toBeNull();
    expect(page.data[1]?.normalizedDisplay).toContain("old trading name");
  });
});

describe("searchNames reports which name matched", () => {
  test("a maiden-name hit is distinguishable from a current-name hit", async () => {
    const database = freshDatabase();
    const personId = await createPerson(
      database,
      { given: "Mary", family: "Smith" },
      options("2026-06-01T00:00:00.000Z", "s-a"),
    );
    await addName(
      database,
      personId,
      { nameRole: "maiden", given: "Mary", family: "Kowalczyk" },
      options("2026-06-02T00:00:00.000Z", "s-b"),
    );

    const maiden = await searchNames(database, "Kowalczyk");
    const hit = maiden.hits.find((entry) => entry.entityId === personId);
    expect(hit?.matchedName).toBe("Mary Kowalczyk");
    expect(hit?.matchedNameRole).toBe("maiden");
    expect(hit?.matchedNameIsCurrent).toBe(false);
    // The entity is still labelled by the name it answers to today — the two are different facts.
    expect(hit?.displayName).toBe("Mary Smith");

    const current = await searchNames(database, "Smith");
    const currentHit = current.hits.find((entry) => entry.entityId === personId);
    expect(currentHit?.matchedNameRole).toBe("current");
    expect(currentHit?.matchedNameIsCurrent).toBe(true);
  });
});
