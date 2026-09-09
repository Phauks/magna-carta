import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import { describe, expect, test } from "vitest";
import { addAddress } from "../src/contact-address.ts";
import { addEmail } from "../src/contact-email.ts";
import { addPhone } from "../src/contact-phone.ts";
import { readEntityListing } from "../src/entity-listing.ts";
import { createOrganization } from "../src/organization.ts";
import { createPerson } from "../src/person.ts";

// The directory's INDEX — the read that answers "show me everyone", as opposed to the ranked search
// that answers a name. What these assert is the difference between the two: this one is complete,
// ordered, walkable, and counted.

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

function options(instant: string, seed: string) {
  return {
    clock: { now: () => instant },
    actorUserId: null,
    randomSource: seededRandomSource(seed),
  };
}

async function seedDirectory(database: BatchDatabase) {
  const lovelace = await createPerson(
    database,
    { given: "Ada", family: "Lovelace" },
    options("2026-06-01T00:00:00.000Z", "listing-a"),
  );
  const babbage = await createOrganization(
    database,
    { legalName: "Babbage Engines Limited", displayName: null },
    options("2026-06-02T00:00:00.000Z", "listing-b"),
  );
  const hopper = await createPerson(
    database,
    { given: "Grace", family: "Hopper" },
    options("2026-06-03T00:00:00.000Z", "listing-c"),
  );
  return { lovelace, babbage, hopper };
}

describe("readEntityListing", () => {
  test("lists people and organizations as one sequence in name order", async () => {
    const database = freshDatabase();
    await seedDirectory(database);

    const page = await readEntityListing(database);

    expect(page.data.map((row) => row.displayName)).toEqual([
      "Ada Lovelace",
      "Babbage Engines Limited",
      "Grace Hopper",
    ]);
    expect(page.data.map((row) => row.entityKind)).toEqual(["person", "organization", "person"]);
    expect(page.total).toBe(3);
    expect(page.nextCursor).toBeNull();
  });

  test("narrows to one side of the book without splitting the order", async () => {
    const database = freshDatabase();
    await seedDirectory(database);

    const people = await readEntityListing(database, { kind: "person" });
    const organizations = await readEntityListing(database, { kind: "organization" });

    expect(people.data.map((row) => row.displayName)).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(people.total).toBe(2);
    expect(organizations.data.map((row) => row.displayName)).toEqual(["Babbage Engines Limited"]);
    expect(organizations.total).toBe(1);
  });

  test("walks the whole record by cursor, and the count is of the record rather than the page", async () => {
    const database = freshDatabase();
    await seedDirectory(database);

    const first = await readEntityListing(database, { pageSize: 2 });
    expect(first.data.map((row) => row.displayName)).toEqual([
      "Ada Lovelace",
      "Babbage Engines Limited",
    ]);
    // The whole record, not the two rows in hand: that is the fact a listing carries and a capped
    // search answer cannot.
    expect(first.total).toBe(3);
    expect(first.nextCursor).not.toBeNull();

    const second = await readEntityListing(database, {
      pageSize: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.data.map((row) => row.displayName)).toEqual(["Grace Hopper"]);
    expect(second.total).toBe(3);
    expect(second.nextCursor).toBeNull();
  });

  test("leaves a folded record out, so one client is never shown as two", async () => {
    const database = freshDatabase();
    const { lovelace } = await seedDirectory(database);
    const duplicate = await createPerson(
      database,
      { given: "Ada", family: "Lovelace" },
      options("2026-06-04T00:00:00.000Z", "listing-d"),
    );

    const beforeMerge = await readEntityListing(database, { kind: "person" });
    expect(beforeMerge.total).toBe(3);

    // The state a merge leaves behind, written directly: the mechanics of folding one record into
    // another are merge.ts's business and are asserted there. What this read owes is that a record
    // carrying a merge pointer is not listed beside the record it was folded into.
    await database
      .prepare(
        "UPDATE directory_person SET status = 'merged_into', merged_into_id = ?2 WHERE id = ?1",
      )
      .bind(duplicate, lovelace)
      .run();

    const afterMerge = await readEntityListing(database, { kind: "person" });
    expect(afterMerge.data.map((row) => row.entityId)).not.toContain(duplicate);
    expect(afterMerge.total).toBe(2);
  });

  test("carries an organization's legal name only where it says something the display name does not", async () => {
    const database = freshDatabase();
    const traded = await createOrganization(
      database,
      { legalName: "Pemberton Holdings Incorporated", displayName: "Pemberton" },
      options("2026-06-01T00:00:00.000Z", "listing-f"),
    );
    await createOrganization(
      database,
      { legalName: "Quill and Seal Limited", displayName: null },
      options("2026-06-02T00:00:00.000Z", "listing-g"),
    );

    const page = await readEntityListing(database, { kind: "organization" });
    const pemberton = page.data.find((row) => row.entityId === traded);
    const quill = page.data.find((row) => row.displayName === "Quill and Seal Limited");

    expect(pemberton).toMatchObject({
      displayName: "Pemberton",
      legalName: "Pemberton Holdings Incorporated",
    });
    // The same word twice is noise, so it is not repeated.
    expect(quill?.legalName).toBeNull();
  });

  test("carries the parts a person's name was assembled from, so a book of names sorts by any of them", async () => {
    const database = freshDatabase();
    await createPerson(
      database,
      { given: "Ada", middle: "Byron", family: "Lovelace" },
      options("2026-06-01T00:00:00.000Z", "listing-h"),
    );

    const [row] = (await readEntityListing(database, { kind: "person" })).data;

    expect(row).toMatchObject({ givenName: "Ada", middleName: "Byron", familyName: "Lovelace" });
  });

  test("carries the default way to reach a record — one per channel, not a contact register", async () => {
    const database = freshDatabase();
    const person = await createPerson(
      database,
      { given: "Grace", family: "Hopper" },
      options("2026-06-01T00:00:00.000Z", "listing-i"),
    );
    const written = options("2026-06-02T00:00:00.000Z", "listing-j");
    await addEmail(database, { entityId: person, address: "spare@example.test" }, written);
    await addEmail(
      database,
      { entityId: person, address: "grace@example.test", isPrimary: true },
      options("2026-06-03T00:00:00.000Z", "listing-k"),
    );
    await addPhone(
      database,
      { entityId: person, number: "+17755550148", isPrimary: true },
      options("2026-06-04T00:00:00.000Z", "listing-l"),
    );
    await addAddress(
      database,
      { entityId: person, street: "1400 Meridian Way", city: "Reno", region: "NV", country: "US" },
      options("2026-06-05T00:00:00.000Z", "listing-m"),
    );

    const [row] = (await readEntityListing(database, { kind: "person" })).data;

    // The row a message would go to, not every row the record holds: the spare address is on the
    // record and is not what a directory column shows.
    expect(row).toMatchObject({
      emailAddress: "grace@example.test",
      phoneNumber: "+17755550148",
      city: "Reno",
      region: "NV",
      country: "US",
    });
  });

  test("states nothing rather than guessing where the firm holds no way to reach a record", async () => {
    const database = freshDatabase();
    await createPerson(
      database,
      { given: "Ada", family: "Lovelace" },
      options("2026-06-01T00:00:00.000Z", "listing-n"),
    );

    const [row] = (await readEntityListing(database, { kind: "person" })).data;

    expect(row).toMatchObject({
      emailAddress: null,
      phoneNumber: null,
      city: null,
      region: null,
      country: null,
    });
  });

  test("answers an empty directory with an empty page rather than a failure", async () => {
    const page = await readEntityListing(freshDatabase());

    expect(page.data).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.nextCursor).toBeNull();
  });
});
