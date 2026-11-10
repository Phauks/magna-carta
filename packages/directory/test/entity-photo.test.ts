import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { expect, test } from "vitest";
import { UnknownEntityError } from "../src/entity-kind.ts";
import { readEntityPhoto, removeEntityPhoto, setEntityPhoto } from "../src/entity-photo.ts";
import { createOrganization } from "../src/organization.ts";
import { createPerson } from "../src/person.ts";

// A record's picture: one row per record, replaced in place, removed outright, and every change
// filed in the directory's audit trail against the record it changed.

const ACTOR = "user_actor" as UserId;

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

function writeOptions(seed: string, at = "2026-11-09T00:00:00.000Z") {
  return { clock: { now: () => at }, actorUserId: ACTOR, randomSource: seededRandomSource(seed) };
}

const PICTURE = {
  sha256: "a".repeat(64),
  objectKey: "directory-photo/x/aaaa.png",
  contentType: "image/png",
  sizeBytes: 1024,
  widthPixels: 512,
  heightPixels: 512,
};

async function auditEvents(database: BatchDatabase, subjectId: string): Promise<string[]> {
  const { results } = await database
    .prepare("SELECT event FROM audit_log WHERE subject_id = ?1 ORDER BY rowid")
    .bind(subjectId)
    .all<{ event: string }>();
  return results.map((row) => row.event);
}

test("a picture is set, replaced in place, and read back", async () => {
  const database = freshDatabase();
  const personId = await createPerson(database, { given: "Ada", family: "Doe" }, writeOptions("p"));

  expect(await readEntityPhoto(database, personId)).toBeUndefined();
  await setEntityPhoto(
    database,
    personId,
    PICTURE,
    writeOptions("one", "2026-11-09T01:00:00.000Z"),
  );
  await setEntityPhoto(
    database,
    personId,
    { ...PICTURE, sha256: "b".repeat(64), objectKey: "directory-photo/x/bbbb.jpg" },
    writeOptions("two", "2026-11-09T02:00:00.000Z"),
  );

  const row = await readEntityPhoto(database, personId);
  expect(row?.objectKey).toBe("directory-photo/x/bbbb.jpg");
  // The record has had a picture since the first one; these bytes since the second.
  expect(row?.createdAt).toBe("2026-11-09T01:00:00.000Z");
  expect(row?.updatedAt).toBe("2026-11-09T02:00:00.000Z");
  expect(await auditEvents(database, personId)).toEqual(
    expect.arrayContaining(["directory.entity.photo_changed"]),
  );
});

test("removing hands back the row it removed, and removing nothing changes nothing", async () => {
  const database = freshDatabase();
  const organizationId = await createOrganization(
    database,
    { legalName: "Acme Holdings LLC" },
    writeOptions("o"),
  );
  await setEntityPhoto(database, organizationId, PICTURE, writeOptions("set"));

  const removed = await removeEntityPhoto(database, organizationId, writeOptions("remove"));
  expect(removed?.objectKey).toBe(PICTURE.objectKey);
  expect(await readEntityPhoto(database, organizationId)).toBeUndefined();
  expect(await removeEntityPhoto(database, organizationId, writeOptions("again"))).toBeUndefined();

  const events = await auditEvents(database, organizationId);
  expect(events.filter((event) => event === "directory.entity.photo_removed")).toHaveLength(1);
});

test("a picture cannot be set on a record that does not exist", async () => {
  const database = freshDatabase();
  await expect(
    setEntityPhoto(database, "directoryPerson_missing", PICTURE, writeOptions("missing")),
  ).rejects.toBeInstanceOf(UnknownEntityError);
});
