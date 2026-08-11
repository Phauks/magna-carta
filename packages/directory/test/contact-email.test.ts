import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { expect, test } from "vitest";
import { createPerson } from "../src/person.ts";
import {
  addEmail,
  DirectoryEmailNotFoundError,
  findEntitiesByEmailAddress,
  findEntitiesByEmailAddresses,
  InvalidEmailAddressError,
  MAXIMUM_BATCHED_EMAIL_LOOKUPS,
  readEmails,
  removeEmail,
  updateEmail,
} from "../src/contact-email.ts";

const clock = { now: () => "2026-07-14T00:00:00.000Z" };
const ACTOR = "user_actor" as UserId;

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

function writeOptions(seed: string) {
  return { clock, actorUserId: ACTOR, randomSource: seededRandomSource(seed) };
}

async function seedPerson(database: BatchDatabase, seed: string, given: string): Promise<string> {
  return createPerson(database, { given, family: "Doe" }, writeOptions(seed));
}

test("addEmail attaches an address and readEmails returns it", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "add-person", "Ada");

  const emailId = await addEmail(
    database,
    { entityId: personId, address: "Ada@Example.COM", label: "work", isPrimary: true },
    writeOptions("add-email"),
  );
  expect(emailId.startsWith("directoryEmail_")).toBe(true);

  const emails = await readEmails(database, personId);
  expect(emails).toHaveLength(1);
  // Stored as entered (trimmed), not lowercased — the normalized form is the internal match key only.
  expect(emails[0]?.address).toBe("Ada@Example.COM");
  expect(emails[0]?.label).toBe("work");
  expect(emails[0]?.isPrimary).toBe(true);
});

test("adding a second primary demotes the first (at most one primary per entity)", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "primary-person", "Grace");

  await addEmail(
    database,
    { entityId: personId, address: "grace.first@example.com", isPrimary: true },
    writeOptions("primary-1"),
  );
  await addEmail(
    database,
    { entityId: personId, address: "grace.second@example.com", isPrimary: true },
    writeOptions("primary-2"),
  );

  const emails = await readEmails(database, personId);
  const primaries = emails.filter((email) => email.isPrimary);
  expect(primaries).toHaveLength(1);
  expect(primaries[0]?.address).toBe("grace.second@example.com");
});

test("findEntitiesByEmailAddress resolves case- and whitespace-insensitively", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "lookup-person", "Alan");
  await addEmail(
    database,
    { entityId: personId, address: "alan.turing@example.com" },
    writeOptions("lookup-email"),
  );

  const matches = await findEntitiesByEmailAddress(database, "  ALAN.TURING@Example.com ");
  expect(matches).toHaveLength(1);
  expect(matches[0]?.entityId).toBe(personId);
});

test("findEntitiesByEmailAddress resolves a merged-away owner to its surviving master", async () => {
  const database = freshDatabase();
  const master = await seedPerson(database, "merge-master", "Master");
  const subordinate = await seedPerson(database, "merge-sub", "Sub");
  await addEmail(
    database,
    { entityId: subordinate, address: "shared@example.com" },
    writeOptions("merge-email"),
  );

  // Simulate the node-row effect of a merge: the subordinate is archived and points at the master.
  // The email row is deliberately LEFT on the subordinate (the directory's merge keeps contact rows in
  // place, resolving through merged_into_id), so the lookup must follow that pointer to the master.
  await database
    .prepare(
      `UPDATE directory_person SET status = 'merged_into', merged_into_id = ?2, updated_at = ?3 WHERE id = ?1`,
    )
    .bind(subordinate, master, clock.now())
    .run();

  const matches = await findEntitiesByEmailAddress(database, "shared@example.com");
  expect(matches).toHaveLength(1);
  expect(matches[0]?.entityId).toBe(master);
});

test("findEntitiesByEmailAddress excludes soft-deleted email rows", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "del-person", "Del");
  const emailId = await addEmail(
    database,
    { entityId: personId, address: "gone@example.com" },
    writeOptions("del-email"),
  );

  await removeEmail(database, emailId, writeOptions("del-remove"));
  expect(await findEntitiesByEmailAddress(database, "gone@example.com")).toEqual([]);
});

test("findEntitiesByEmailAddress drops a match whose entity is soft-deleted", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "softdel-person", "Faye");
  await addEmail(
    database,
    { entityId: personId, address: "faye@example.com" },
    writeOptions("softdel-email"),
  );
  await database
    .prepare(`UPDATE directory_person SET deleted_at = ?2 WHERE id = ?1`)
    .bind(personId, clock.now())
    .run();

  expect(await findEntitiesByEmailAddress(database, "faye@example.com")).toEqual([]);
});

test("one address on two entities returns both", async () => {
  const database = freshDatabase();
  const personA = await seedPerson(database, "shareA", "Anna");
  const personB = await seedPerson(database, "shareB", "Ben");
  await addEmail(
    database,
    { entityId: personA, address: "family@example.com" },
    writeOptions("shareA-e"),
  );
  await addEmail(
    database,
    { entityId: personB, address: "family@example.com" },
    writeOptions("shareB-e"),
  );

  const matches = await findEntitiesByEmailAddress(database, "family@example.com");
  expect(matches.map((match) => match.entityId).sort()).toEqual([personA, personB].sort());
});

test("updateEmail changes fields and preserves omitted ones", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "upd-person", "Uma");
  const emailId = await addEmail(
    database,
    { entityId: personId, address: "old@example.com", label: "work", isPrimary: true },
    writeOptions("upd-add"),
  );

  // Change only the address; label and primary are preserved.
  await updateEmail(database, { emailId, address: "new@example.com" }, writeOptions("upd-run"));

  const emails = await readEmails(database, personId);
  expect(emails).toHaveLength(1);
  expect(emails[0]?.address).toBe("new@example.com");
  expect(emails[0]?.label).toBe("work");
  expect(emails[0]?.isPrimary).toBe(true);
  // The new address is findable; the old one is not.
  expect((await findEntitiesByEmailAddress(database, "new@example.com"))[0]?.entityId).toBe(
    personId,
  );
  expect(await findEntitiesByEmailAddress(database, "old@example.com")).toEqual([]);
});

test("addEmail rejects a malformed address; lookup of one returns empty", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "bad-person", "Bad");

  await expect(
    addEmail(database, { entityId: personId, address: "not-an-email" }, writeOptions("bad-add")),
  ).rejects.toBeInstanceOf(InvalidEmailAddressError);
  await expect(
    addEmail(database, { entityId: personId, address: "two@@ats.com" }, writeOptions("bad-add2")),
  ).rejects.toBeInstanceOf(InvalidEmailAddressError);

  expect(await findEntitiesByEmailAddress(database, "not-an-email")).toEqual([]);
});

// The batched twin the email-capture path uses. Same semantics as the single-address form — the point
// of these cases is that batching did not quietly change any of them.

test("findEntitiesByEmailAddresses resolves many addresses in one call, keyed as the caller passed them", async () => {
  const database = freshDatabase();
  const alan = await seedPerson(database, "batch-alan", "Alan");
  const grace = await seedPerson(database, "batch-grace", "Grace");
  await addEmail(database, { entityId: alan, address: "alan@example.com" }, writeOptions("b-1"));
  await addEmail(database, { entityId: grace, address: "grace@example.com" }, writeOptions("b-2"));

  const matches = await findEntitiesByEmailAddresses(database, [
    "  ALAN@Example.com ",
    "grace@example.com",
    "nobody@example.com",
  ]);

  expect(matches.get("  ALAN@Example.com ")?.[0]?.entityId).toBe(alan);
  expect(matches.get("grace@example.com")?.[0]?.entityId).toBe(grace);
  // An address with no match is absent rather than present-and-empty, so membership reads as "resolved".
  expect(matches.has("nobody@example.com")).toBe(false);
});

test("findEntitiesByEmailAddresses agrees with the single-address form on merges and deletions", async () => {
  const database = freshDatabase();
  const master = await seedPerson(database, "batch-master", "Master");
  const subordinate = await seedPerson(database, "batch-sub", "Sub");
  const deletedOwner = await seedPerson(database, "batch-del", "Del");
  await addEmail(
    database,
    { entityId: subordinate, address: "merged@example.com" },
    writeOptions("b-3"),
  );
  const removedId = await addEmail(
    database,
    { entityId: master, address: "removed@example.com" },
    writeOptions("b-4"),
  );
  await addEmail(
    database,
    { entityId: deletedOwner, address: "deleted-owner@example.com" },
    writeOptions("b-5"),
  );
  await database
    .prepare(
      `UPDATE directory_person SET status = 'merged_into', merged_into_id = ?2, updated_at = ?3 WHERE id = ?1`,
    )
    .bind(subordinate, master, clock.now())
    .run();
  await removeEmail(database, removedId, writeOptions("b-6"));
  await database
    .prepare(`UPDATE directory_person SET deleted_at = ?2 WHERE id = ?1`)
    .bind(deletedOwner, clock.now())
    .run();

  const addresses = ["merged@example.com", "removed@example.com", "deleted-owner@example.com"];
  const batched = await findEntitiesByEmailAddresses(database, addresses);
  for (const address of addresses) {
    const single = await findEntitiesByEmailAddress(database, address);
    expect(batched.get(address) ?? []).toEqual(single);
  }
  expect(batched.get("merged@example.com")?.[0]?.entityId).toBe(master);
});

test("findEntitiesByEmailAddresses bounds the address list it will resolve", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "batch-bound", "Bound");
  await addEmail(
    database,
    { entityId: personId, address: "bounded@example.com" },
    writeOptions("b-7"),
  );

  // The address set comes from a captured message's recipients, so its size is not this platform's
  // choice. The bounded prefix is resolved and the rest is simply not asked about — never an
  // unbounded IN list built from a message.
  const flood = Array.from({ length: 500 }, (_unused, index) => `filler${index}@example.com`);
  const matches = await findEntitiesByEmailAddresses(database, [...flood, "bounded@example.com"]);

  expect(matches.size).toBeLessThanOrEqual(MAXIMUM_BATCHED_EMAIL_LOOKUPS);
});

test("updateEmail and removeEmail reject an unknown email id", async () => {
  const database = freshDatabase();
  await expect(
    updateEmail(
      database,
      { emailId: "directoryEmail_missing", label: "x" },
      writeOptions("miss-upd"),
    ),
  ).rejects.toBeInstanceOf(DirectoryEmailNotFoundError);
  await expect(
    removeEmail(database, "directoryEmail_missing", writeOptions("miss-rm")),
  ).rejects.toBeInstanceOf(DirectoryEmailNotFoundError);
});
