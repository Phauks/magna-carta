import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import { describe, expect, test } from "vitest";
import { createPerson, readPerson, setPersonPronouns } from "../src/person.ts";
import { IncompletePronounSetError, pronounLabel, type PronounSet } from "../src/pronouns.ts";

// A person's stated pronouns, end to end against the real migrated schema.
//
// Two properties are load-bearing and neither shows in a happy-path write. The first is that a
// PARTIAL SET IS UNREPRESENTABLE: the table's own CHECK refuses one, so no future code path can
// leave a row that renders "she" in one clause and "them" in the next. The second is that the field
// is INERT until someone states something — creating a person records nothing, and nothing anywhere
// derives a set from the name parts.

const clock = { now: () => "2026-06-17T00:00:00.000Z" };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

const SHE: PronounSet = {
  subject: "she",
  object: "her",
  possessiveDeterminer: "her",
  possessivePronoun: "hers",
  reflexive: "herself",
  verbNumber: "singular",
};

const XE: PronounSet = {
  subject: "xe",
  object: "xem",
  possessiveDeterminer: "xyr",
  possessivePronoun: "xyrs",
  reflexive: "xemself",
  verbNumber: "singular",
};

async function personWithName(database: BatchDatabase, given: string, family: string) {
  return createPerson(
    database,
    { given, family },
    { clock, actorUserId: null, randomSource: seededRandomSource(`${given}${family}`) },
  );
}

describe("recording what a person stated", () => {
  test("a new person has no pronouns, however they are named", async () => {
    const database = freshDatabase();
    for (const [given, family] of [
      ["Elizabeth", "Marchetti"],
      ["Robert", "Vale"],
      ["Rowan", "Ashcroft"],
    ]) {
      const personId = await personWithName(database, given as string, family as string);
      const person = await readPerson(database, personId);
      expect(person.pronouns, `${given} ${family}`).toBeNull();
    }
  });

  test("records the whole set and reads it back", async () => {
    const database = freshDatabase();
    const personId = await personWithName(database, "Elizabeth", "Marchetti");
    await setPersonPronouns(database, personId, SHE, {
      clock,
      actorUserId: null,
      randomSource: seededRandomSource("set"),
    });
    expect((await readPerson(database, personId)).pronouns).toEqual(SHE);
  });

  // The whole reason the forms are stored rather than a label: no table of options contains this
  // set, and nothing about "xe/xem" says the reflexive is "xemself".
  test("records a set no closed list of options would contain", async () => {
    const database = freshDatabase();
    const personId = await personWithName(database, "Rowan", "Ashcroft");
    await setPersonPronouns(database, personId, XE, {
      clock,
      actorUserId: null,
      randomSource: seededRandomSource("neo"),
    });
    const person = await readPerson(database, personId);
    expect(person.pronouns).toEqual(XE);
    expect(person.pronouns === null ? "" : pronounLabel(person.pronouns)).toBe("xe/xem");
  });

  test("removes the set on file when null is recorded", async () => {
    const database = freshDatabase();
    const personId = await personWithName(database, "Elizabeth", "Marchetti");
    const options = { clock, actorUserId: null, randomSource: seededRandomSource("clear") };
    await setPersonPronouns(database, personId, SHE, options);
    await setPersonPronouns(database, personId, null, options);
    expect((await readPerson(database, personId)).pronouns).toBeNull();
  });

  test("refuses a set with a blank form rather than storing half of one", async () => {
    const database = freshDatabase();
    const personId = await personWithName(database, "Elizabeth", "Marchetti");
    await expect(
      setPersonPronouns(
        database,
        personId,
        { ...SHE, reflexive: "  " },
        { clock, actorUserId: null, randomSource: seededRandomSource("partial") },
      ),
    ).rejects.toBeInstanceOf(IncompletePronounSetError);
    expect((await readPerson(database, personId)).pronouns).toBeNull();
  });

  test("changing a set replaces every form, never some of them", async () => {
    const database = freshDatabase();
    const personId = await personWithName(database, "Rowan", "Ashcroft");
    const options = { clock, actorUserId: null, randomSource: seededRandomSource("change") };
    await setPersonPronouns(database, personId, SHE, options);
    await setPersonPronouns(database, personId, XE, options);
    expect((await readPerson(database, personId)).pronouns).toEqual(XE);
  });

  // The handle prefix decides which node table the existence check reads, so an organisation handle
  // would pass that check and then update no person row at all — a write that reports success and
  // records nothing.
  test("refuses an organisation handle rather than silently writing nothing", async () => {
    const database = freshDatabase();
    await expect(
      setPersonPronouns(
        database,
        "directoryOrganization_AAAAAAAAAAAAAAAAAAAAA" as unknown as Parameters<
          typeof setPersonPronouns
        >[1],
        SHE,
        { clock, actorUserId: null, randomSource: seededRandomSource("org") },
      ),
    ).rejects.toThrow(/not found/);
  });

  test("leaves the name parts alone", async () => {
    const database = freshDatabase();
    const personId = await personWithName(database, "Elizabeth", "Marchetti");
    await setPersonPronouns(database, personId, SHE, {
      clock,
      actorUserId: null,
      randomSource: seededRandomSource("names"),
    });
    const person = await readPerson(database, personId);
    expect(person.given).toBe("Elizabeth");
    expect(person.family).toBe("Marchetti");
    expect(person.displayName).toBe("Elizabeth Marchetti");
  });
});

// The database itself is the last line: even a hand-written UPDATE that bypasses every guard above
// cannot leave a person half a set, and cannot invent a third kind of verb agreement.
describe("the table refuses what the write path already refuses", () => {
  test("rejects a row carrying only some of the forms", async () => {
    const { database, raw } = createMigratedNodeDatabase("per-firm");
    const personId = await personWithName(database, "Elizabeth", "Marchetti");
    expect(() =>
      raw
        .prepare("UPDATE directory_person SET pronoun_subject = 'she' WHERE id = ?")
        .run(personId as string),
    ).toThrow();
  });

  test("rejects a verb agreement that is neither singular nor plural", async () => {
    const { database, raw } = createMigratedNodeDatabase("per-firm");
    const personId = await personWithName(database, "Elizabeth", "Marchetti");
    expect(() =>
      raw
        .prepare(
          "UPDATE directory_person SET pronoun_subject = 'she', pronoun_object = 'her', " +
            "pronoun_possessive_determiner = 'her', pronoun_possessive_pronoun = 'hers', " +
            "pronoun_reflexive = 'herself', pronoun_verb_number = 'dual' WHERE id = ?",
        )
        .run(personId as string),
    ).toThrow();
  });

  test("accepts the complete set written directly", async () => {
    const { database, raw } = createMigratedNodeDatabase("per-firm");
    const personId = await personWithName(database, "Elizabeth", "Marchetti");
    raw
      .prepare(
        "UPDATE directory_person SET pronoun_subject = 'she', pronoun_object = 'her', " +
          "pronoun_possessive_determiner = 'her', pronoun_possessive_pronoun = 'hers', " +
          "pronoun_reflexive = 'herself', pronoun_verb_number = 'singular' WHERE id = ?",
      )
      .run(personId as string);
    expect((await readPerson(database, personId)).pronouns).toEqual(SHE);
  });
});
