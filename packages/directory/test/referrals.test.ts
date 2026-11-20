import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import {
  createFirmKeyProvider,
  type WrappedKeyRow,
} from "@magna-carta/data-access/firm-key-provider";
import { generateFirmKeyBytes, importRootKek, wrapFirmKey } from "@magna-carta/encryption/keys";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { expect, test } from "vitest";
import { MergedEntityError, UnknownEntityError } from "../src/entity-kind.ts";
import { assertNoDanglingToSubordinate } from "../src/fitness.ts";
import type { DirectoryIdentifierContext } from "../src/identifiers.ts";
import { mergeEntities } from "../src/merge.ts";
import { createOrganization } from "../src/organization.ts";
import { createPerson } from "../src/person.ts";
import {
  createReferralSource,
  listReferralSources,
  readEntityReferral,
  readEntityReferrals,
  ReferralSourceNameError,
  ReferralSourceNotFoundError,
  ReferralSourceRetiredError,
  SelfReferralError,
  setEntityReferral,
  updateReferralSource,
} from "../src/referrals.ts";

// How a client found the firm: the firm's list of sources, and each client's source, referrer, or
// both, every change filed in the audit trail.

const ACTOR = "user_actor" as UserId;
const ANOTHER_ATTORNEY = "directoryReferralSource_anotherAttorney000000";
const WEBSITE = "directoryReferralSource_website00000000000000";

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

function writeOptions(seed: string, at = "2026-11-20T00:00:00.000Z") {
  return { clock: { now: () => at }, actorUserId: ACTOR, randomSource: seededRandomSource(seed) };
}

async function auditEvents(database: BatchDatabase, subjectId: string): Promise<string[]> {
  const { results } = await database
    .prepare("SELECT event FROM audit_log WHERE subject_id = ?1 ORDER BY rowid")
    .bind(subjectId)
    .all<{ event: string }>();
  return results.map((row) => row.event);
}

test("the list arrives seeded, in order, and nothing on it is retired", async () => {
  const database = freshDatabase();
  const sources = await listReferralSources(database);
  expect(sources.map((source) => source.name)).toEqual([
    "Past Client",
    "Another Attorney",
    "Friend or Family",
    "Website",
    "Search Engine",
    "Advertisement",
    "Other",
  ]);
  expect(sources.every((source) => !source.archived)).toBe(true);
});

test("a new source joins the end; a move closes the list up around it", async () => {
  const database = freshDatabase();
  const created = await createReferralSource(
    database,
    { name: "  Bar Association  " },
    writeOptions("create"),
  );
  expect(created.name).toBe("Bar Association");
  expect(created.position).toBe(7);
  expect(await auditEvents(database, created.id)).toEqual(["directory.referralSource.created"]);

  const moved = await updateReferralSource(
    database,
    created.id,
    { position: 1 },
    writeOptions("move"),
  );
  expect(moved.position).toBe(1);
  const names = (await listReferralSources(database)).map((source) => source.name);
  expect(names.slice(0, 3)).toEqual(["Past Client", "Bar Association", "Another Attorney"]);
  const positions = (await listReferralSources(database)).map((source) => source.position);
  expect(positions).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

  await expect(
    createReferralSource(database, { name: "   " }, writeOptions("blank")),
  ).rejects.toBeInstanceOf(ReferralSourceNameError);
  await expect(
    updateReferralSource(
      database,
      "directoryReferralSource_missing0000000000000",
      { name: "X" },
      writeOptions("missing"),
    ),
  ).rejects.toBeInstanceOf(ReferralSourceNotFoundError);
});

test("a source is renamed, retired and restored, each audited", async () => {
  const database = freshDatabase();
  await updateReferralSource(database, WEBSITE, { name: "Our Website" }, writeOptions("rename"));
  await updateReferralSource(database, WEBSITE, { archived: true }, writeOptions("retire"));
  const retired = (await listReferralSources(database)).find((source) => source.id === WEBSITE);
  expect(retired).toMatchObject({ name: "Our Website", archived: true });
  await updateReferralSource(database, WEBSITE, { archived: false }, writeOptions("restore"));
  expect(await auditEvents(database, WEBSITE)).toEqual([
    "directory.referralSource.changed",
    "directory.referralSource.retired",
    "directory.referralSource.restored",
  ]);
});

test("a referral records a source, a referrer, or both, and is replaced in place", async () => {
  const database = freshDatabase();
  const client = await createPerson(
    database,
    { given: "Margaret", family: "Ellison" },
    writeOptions("client"),
  );
  const referrer = await createPerson(
    database,
    { given: "Daniel", family: "Okafor" },
    writeOptions("referrer"),
  );

  expect(await readEntityReferral(database, client)).toBeNull();

  const both = await setEntityReferral(
    database,
    client,
    { sourceId: ANOTHER_ATTORNEY, referrerEntityId: referrer },
    writeOptions("both"),
  );
  expect(both).toEqual({
    entityId: client,
    source: { id: ANOTHER_ATTORNEY, name: "Another Attorney", archived: false },
    referrer: { entityId: referrer, displayName: "Daniel Okafor", mergedIntoId: null },
  });
  expect(await readEntityReferral(database, client)).toEqual(both);

  const sourceOnly = await setEntityReferral(
    database,
    client,
    { sourceId: WEBSITE, referrerEntityId: null },
    writeOptions("source-only"),
  );
  expect(sourceOnly?.referrer).toBeNull();
  expect(sourceOnly?.source?.name).toBe("Website");

  const organization = await createOrganization(
    database,
    { legalName: "Harbor Supply Co." },
    writeOptions("organization"),
  );
  const personOnly = await setEntityReferral(
    database,
    organization,
    { sourceId: null, referrerEntityId: referrer },
    writeOptions("person-only"),
  );
  expect(personOnly?.source).toBeNull();
  expect(personOnly?.referrer?.displayName).toBe("Daniel Okafor");

  expect(await auditEvents(database, client)).toEqual(
    expect.arrayContaining(["directory.referral.recorded"]),
  );
});

test("both fields empty removes the referral; removing nothing audits nothing", async () => {
  const database = freshDatabase();
  const client = await createPerson(
    database,
    { given: "Margaret", family: "Ellison" },
    writeOptions("client"),
  );
  await setEntityReferral(
    database,
    client,
    { sourceId: WEBSITE, referrerEntityId: null },
    writeOptions("set"),
  );
  expect(
    await setEntityReferral(
      database,
      client,
      { sourceId: null, referrerEntityId: null },
      writeOptions("clear"),
    ),
  ).toBeNull();
  expect(await readEntityReferral(database, client)).toBeNull();
  const before = (await auditEvents(database, client)).length;
  await setEntityReferral(
    database,
    client,
    { sourceId: null, referrerEntityId: null },
    writeOptions("clear-again"),
  );
  expect((await auditEvents(database, client)).length).toBe(before);
  expect(await auditEvents(database, client)).toContain("directory.referral.removed");
});

test("a retired source is kept where it stands and refused as a new choice", async () => {
  const database = freshDatabase();
  const client = await createPerson(
    database,
    { given: "Margaret", family: "Ellison" },
    writeOptions("client"),
  );
  const other = await createPerson(
    database,
    { given: "Priya", family: "Raman" },
    writeOptions("other"),
  );
  await setEntityReferral(
    database,
    client,
    { sourceId: WEBSITE, referrerEntityId: null },
    writeOptions("set"),
  );
  await updateReferralSource(database, WEBSITE, { archived: true }, writeOptions("retire"));

  // Saving the record again with its standing source is allowed.
  const kept = await setEntityReferral(
    database,
    client,
    { sourceId: WEBSITE, referrerEntityId: other },
    writeOptions("keep"),
  );
  expect(kept?.source).toEqual({ id: WEBSITE, name: "Website", archived: true });

  await expect(
    setEntityReferral(
      database,
      other,
      { sourceId: WEBSITE, referrerEntityId: null },
      writeOptions("refused"),
    ),
  ).rejects.toBeInstanceOf(ReferralSourceRetiredError);
});

test("a record is never its own referrer, and both records must exist", async () => {
  const database = freshDatabase();
  const client = await createPerson(
    database,
    { given: "Margaret", family: "Ellison" },
    writeOptions("client"),
  );
  await expect(
    setEntityReferral(
      database,
      client,
      { sourceId: null, referrerEntityId: client },
      writeOptions("self"),
    ),
  ).rejects.toBeInstanceOf(SelfReferralError);
  await expect(
    setEntityReferral(
      database,
      client,
      { sourceId: null, referrerEntityId: "directoryPerson_missing00000000000000" },
      writeOptions("missing-referrer"),
    ),
  ).rejects.toBeInstanceOf(UnknownEntityError);
  await expect(
    setEntityReferral(
      database,
      "directoryPerson_missing00000000000000",
      { sourceId: WEBSITE, referrerEntityId: null },
      writeOptions("missing-client"),
    ),
  ).rejects.toBeInstanceOf(UnknownEntityError);
  await expect(
    setEntityReferral(
      database,
      client,
      { sourceId: "directoryReferralSource_missing0000000000000", referrerEntityId: null },
      writeOptions("missing-source"),
    ),
  ).rejects.toBeInstanceOf(ReferralSourceNotFoundError);
});

test("many clients' referrals are read at once, a client with none absent", async () => {
  const database = freshDatabase();
  const referrer = await createPerson(
    database,
    { given: "Daniel", family: "Okafor" },
    writeOptions("referrer"),
  );
  const clients: string[] = [];
  for (let index = 0; index < 120; index += 1) {
    const client = await createPerson(
      database,
      { given: `Client${index}`, family: "Sample" },
      writeOptions(`client-${index}`),
    );
    clients.push(client);
    if (index % 2 === 0) {
      await setEntityReferral(
        database,
        client,
        { sourceId: ANOTHER_ATTORNEY, referrerEntityId: referrer },
        writeOptions(`referral-${index}`),
      );
    }
  }
  const referrals = await readEntityReferrals(database, clients);
  expect(referrals).toHaveLength(60);
  expect(referrals.every((referral) => referral.referrer?.displayName === "Daniel Okafor")).toBe(
    true,
  );
});

async function mergeContext(database: BatchDatabase): Promise<DirectoryIdentifierContext> {
  const rootKekBase64 = "bWFnbmEtY2FydGEtbG9jYWwtZGV2LXJvb3Qta2VrISE=";
  const firmId = "firm_aaaaaaaaaaaaaaaaaaaaaa" as FirmId;
  const wrappedFirmKey = await wrapFirmKey(
    await importRootKek(rootKekBase64),
    generateFirmKeyBytes(),
  );
  return {
    firmId,
    firmKeyVersion: 1,
    firmKeyProvider: createFirmKeyProvider({
      rootKekBase64,
      readWrappedKey: async (asked: FirmId): Promise<WrappedKeyRow | null> =>
        asked === firmId ? { wrappedFirmKey, firmKeyVersion: 1 } : null,
    }),
    database,
    effectivePermissions: new Set() as never,
    actorUserId: ACTOR,
    clock: { now: () => "2026-11-20T01:00:00.000Z" },
    randomSource: seededRandomSource("merge"),
  };
}

test("a merge moves referrals onto the surviving record and leaves none behind", async () => {
  const database = freshDatabase();
  const master = await createPerson(
    database,
    { given: "Daniel", family: "Okafor" },
    writeOptions("master"),
  );
  const duplicate = await createPerson(
    database,
    { given: "Daniel", family: "Okafor" },
    writeOptions("duplicate"),
  );
  const client = await createPerson(
    database,
    { given: "Margaret", family: "Ellison" },
    writeOptions("client"),
  );
  // The client was referred by the duplicate, and the duplicate's own referral is recorded.
  await setEntityReferral(
    database,
    client,
    { sourceId: ANOTHER_ATTORNEY, referrerEntityId: duplicate },
    writeOptions("client-referral"),
  );
  await setEntityReferral(
    database,
    duplicate,
    { sourceId: WEBSITE, referrerEntityId: null },
    writeOptions("duplicate-referral"),
  );

  await mergeEntities(await mergeContext(database), {
    masterId: master,
    subordinateId: duplicate,
    survivorship: {},
  });
  await assertNoDanglingToSubordinate(database, duplicate);

  expect((await readEntityReferral(database, client))?.referrer?.entityId).toBe(master);
  expect((await readEntityReferral(database, master))?.source?.id).toBe(WEBSITE);
  await expect(
    setEntityReferral(
      database,
      client,
      { sourceId: null, referrerEntityId: duplicate },
      writeOptions("to-merged"),
    ),
  ).rejects.toBeInstanceOf(MergedEntityError);
});
