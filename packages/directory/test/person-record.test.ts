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
import { readContactPoints } from "../src/contact-points.ts";
import { readEdges } from "../src/edges.ts";
import { UnknownEntityError } from "../src/entity-kind.ts";
import { checkIdentifier } from "../src/identifier-shape.ts";
import { listIdentifierRecords, type DirectoryIdentifierContext } from "../src/identifiers.ts";
import { readNames } from "../src/name-history.ts";
import { createOrganization } from "../src/organization.ts";
import { InvalidPersonLifeDatesError, readPerson } from "../src/person.ts";
import { createPersonRecord } from "../src/person-record.ts";

const ROOT_KEK = "bWFnbmEtY2FydGEtbG9jYWwtZGV2LXJvb3Qta2VrISE=";
const FIRM = "firm_aaaaaaaaaaaaaaaaaaaaaa" as FirmId;
const ACTOR = "user_actor" as UserId;
const clock = { now: () => "2026-09-03T00:00:00.000Z" };

async function testContext(seed: string): Promise<{
  database: BatchDatabase;
  raw: ReturnType<typeof createMigratedNodeDatabase>["raw"];
  context: DirectoryIdentifierContext;
}> {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  const rootKek = await importRootKek(ROOT_KEK);
  const wrappedFirmKey = await wrapFirmKey(rootKek, generateFirmKeyBytes());
  const provider = createFirmKeyProvider({
    rootKekBase64: ROOT_KEK,
    readWrappedKey: async (firmId: FirmId): Promise<WrappedKeyRow | null> =>
      firmId === FIRM ? { wrappedFirmKey, firmKeyVersion: 1 } : null,
  });
  return {
    database,
    raw,
    context: {
      firmId: FIRM,
      firmKeyVersion: 1,
      firmKeyProvider: provider,
      database,
      effectivePermissions: new Set() as never,
      actorUserId: ACTOR,
      clock,
      randomSource: seededRandomSource(seed),
    },
  };
}

function count(raw: ReturnType<typeof createMigratedNodeDatabase>["raw"], table: string): number {
  const row = raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return Number(row.n);
}

test("one batch records the person with every section the draft carried", async () => {
  const t = await testContext("record-whole");
  const organizationId = await createOrganization(
    t.database,
    { legalName: "Okafor Actuarial LLC" },
    { clock, actorUserId: ACTOR, randomSource: t.context.randomSource },
  );
  const account = checkIdentifier("account", {
    label: "Cook County e-filing",
    number: "CC-2291-0087",
    username: "mokafor",
    secret: "hunter2",
  });
  if (!account.ok) throw new Error(account.reason);

  const personId = await createPersonRecord(t.context, {
    name: { prefix: "Dr.", given: "Margaret", family: "Okafor" },
    otherNames: [{ given: "Margaret", family: "Adeyemi", nameRole: "maiden" }],
    pronouns: {
      subject: "she",
      object: "her",
      possessiveDeterminer: "her",
      possessivePronoun: "hers",
      reflexive: "herself",
      verbNumber: "singular",
    },
    dateOfBirth: "1978-03-14",
    emails: [
      { address: "m.okafor@example.com", contactUse: "work", preference: { preferred: true } },
    ],
    phones: [
      { number: "+13125550148", contactUse: "mobile", countryRegionCode: "US" },
      { number: "+13125550190", contactSystem: "fax", contactUse: "work", countryRegionCode: "US" },
    ],
    addresses: [
      {
        street: "1 N State St",
        city: "Chicago",
        region: "IL",
        postal: "60602",
        country: "US",
        addressUse: "business",
      },
    ],
    identifiers: [
      { type: "ssn", value: "123-45-6789" },
      { type: "account", value: account.value, label: account.label },
    ],
    organizations: [
      { organizationId, edgeType: "employment", personIs: "from", role: "Principal" },
    ],
  });

  const person = await readPerson(t.database, personId);
  expect(person.displayName).toBe("Dr. Margaret Okafor");
  expect(person.pronouns?.subject).toBe("she");
  expect(person.dateOfBirth).toBe("1978-03-14");
  expect(person.deceased).toBe(false);

  const names = await readNames(t.database, personId);
  expect(names.data.map((name) => name.nameRole).toSorted()).toEqual(["current", "maiden"]);

  const points = await readContactPoints(t.database, personId);
  expect(points.emails.map((email) => email.address)).toEqual(["m.okafor@example.com"]);
  expect(points.emails[0]?.state.preferred).toBe(true);
  expect(points.phones.map((phone) => phone.contactSystem).toSorted()).toEqual(["fax", "voice"]);
  expect(points.phones.find((phone) => phone.contactSystem === "voice")?.countryCallingCode).toBe(
    "1",
  );
  expect(points.addresses[0]?.city).toBe("Chicago");

  const identifiers = await listIdentifierRecords(t.database, personId);
  expect(identifiers.map((record) => `${record.type}:${record.label ?? ""}`).toSorted()).toEqual([
    "account:Cook County e-filing",
    "ssn:",
  ]);

  const edges = await readEdges(t.database, personId);
  expect(edges.map((edge) => [edge.edgeType, edge.fromEntityId === personId, edge.role])).toEqual([
    ["employment", true, "Principal"],
  ]);
});

test("a draft that cannot be recorded records nothing at all", async () => {
  const t = await testContext("record-atomic");
  const before = {
    persons: count(t.raw, "directory_person"),
    emails: count(t.raw, "directory_email"),
    identifiers: count(t.raw, "directory_identifier"),
  };

  // An organization that does not exist is refused before any row is composed.
  await expect(
    createPersonRecord(t.context, {
      name: { given: "Nobody", family: "Here" },
      emails: [{ address: "nobody@example.com" }],
      identifiers: [{ type: "ssn", value: "123-45-6789" }],
      organizations: [
        {
          organizationId: "directoryOrganization_00000000000000000000000000",
          edgeType: "employment",
          personIs: "from",
        },
      ],
    }),
  ).rejects.toBeInstanceOf(UnknownEntityError);

  // A date of death before the date of birth is refused the same way.
  await expect(
    createPersonRecord(t.context, {
      name: { given: "Nobody", family: "Here" },
      dateOfBirth: "1990-01-01",
      dateOfDeath: "1980-01-01",
      emails: [{ address: "nobody@example.com" }],
    }),
  ).rejects.toBeInstanceOf(InvalidPersonLifeDatesError);

  expect({
    persons: count(t.raw, "directory_person"),
    emails: count(t.raw, "directory_email"),
    identifiers: count(t.raw, "directory_identifier"),
  }).toEqual(before);
});
