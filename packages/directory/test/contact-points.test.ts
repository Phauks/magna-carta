import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { expect, test } from "vitest";
import {
  addAddress,
  DirectoryAddressNotFoundError,
  EmptyPostalAddressError,
  InvalidAddressClassificationError,
  readAddresses,
  removeAddress,
  updateAddress,
} from "../src/contact-address.ts";
import { addEmail, readEmails } from "../src/contact-email.ts";
import {
  addPhone,
  DirectoryPhoneNotFoundError,
  InvalidPhoneClassificationError,
  InvalidPhoneNumberError,
  readPhones,
  removePhone,
  updatePhone,
} from "../src/contact-phone.ts";
import { readContactPoints } from "../src/contact-points.ts";
import { normalizedAddressKey } from "../src/postal-address.ts";
import { internationalPhoneNumber, structurePhoneNumber } from "../src/phone-number.ts";
import { createPerson } from "../src/person.ts";
import { UnknownEntityError } from "../src/entity-kind.ts";

const clock = { now: () => "2026-08-30T00:00:00.000Z" };
const ACTOR = "user_actor" as UserId;

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

function writeOptions(seed: string) {
  return { clock, actorUserId: ACTOR, randomSource: seededRandomSource(seed) };
}

async function seedPerson(database: BatchDatabase, seed: string): Promise<string> {
  return createPerson(database, { given: "Ada", family: "Doe" }, writeOptions(seed));
}

// ---- the capability that did not exist -----------------------------------------------------------

test("a firm can record a telephone number and read it back", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "phone-person");

  const phoneId = await addPhone(
    database,
    {
      entityId: personId,
      number: "+1 (702) 555-0143 ext. 22",
      contactSystem: "voice",
      contactUse: "work",
    },
    writeOptions("add-phone"),
  );
  expect(phoneId.startsWith("directoryPhone_")).toBe(true);

  const phones = await readPhones(database, personId);
  expect(phones).toHaveLength(1);
  // The number as entered survives verbatim; the split sits beside it.
  expect(phones[0]?.number).toBe("+1 (702) 555-0143 ext. 22");
  expect(phones[0]?.countryCallingCode).toBe("1");
  expect(phones[0]?.nationalNumber).toBe("7025550143");
  expect(phones[0]?.extension).toBe("22");
  expect(phones[0]?.contactSystem).toBe("voice");
  expect(phones[0]?.contactUse).toBe("work");
});

test("a firm can record a postal address and read it back", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "address-person");

  const addressId = await addAddress(
    database,
    {
      entityId: personId,
      street: "12 Rue de la Paix",
      streetTwo: "Bâtiment C",
      city: "Paris",
      postal: "75002",
      sortingCode: "CEDEX 09",
      country: "FR",
      addressUse: "business",
      isPrimary: true,
    },
    writeOptions("add-address"),
  );
  expect(addressId.startsWith("directoryAddress_")).toBe(true);

  const addresses = await readAddresses(database, personId);
  expect(addresses).toHaveLength(1);
  expect(addresses[0]?.streetTwo).toBe("Bâtiment C");
  expect(addresses[0]?.sortingCode).toBe("CEDEX 09");
  // No state and no five-digit postal code anywhere in the way this is stored.
  expect(addresses[0]?.region).toBeNull();
  expect(addresses[0]?.isPrimary).toBe(true);
});

test("an address with no parts at all is refused", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "empty-address-person");
  await expect(
    addAddress(database, { entityId: personId }, writeOptions("empty-address")),
  ).rejects.toBeInstanceOf(EmptyPostalAddressError);
});

test("a number with no digits is refused; one the parser cannot split is kept", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "odd-number-person");

  await expect(
    addPhone(
      database,
      { entityId: personId, number: "call the office" },
      writeOptions("no-digits"),
    ),
  ).rejects.toBeInstanceOf(InvalidPhoneNumberError);

  await addPhone(
    database,
    { entityId: personId, number: "0207 946 0018" },
    writeOptions("national-form"),
  );
  const phones = await readPhones(database, personId);
  // A national-form number carries no country, and the record says so rather than inventing one.
  expect(phones[0]?.countryCallingCode).toBeNull();
  expect(phones[0]?.nationalNumber).toBe("02079460018");
  expect(phones[0]?.number).toBe("0207 946 0018");
});

test("a value outside the catalog is refused at the domain, not stored", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "catalog-person");
  await expect(
    addPhone(
      database,
      { entityId: personId, number: "+1 702 555 0143", contactSystem: "telex" as never },
      writeOptions("bad-system"),
    ),
  ).rejects.toBeInstanceOf(InvalidPhoneClassificationError);
  await expect(
    addAddress(
      database,
      { entityId: personId, street: "1 High Street", addressType: "holographic" as never },
      writeOptions("bad-type"),
    ),
  ).rejects.toBeInstanceOf(InvalidAddressClassificationError);
});

// ---- can and should ------------------------------------------------------------------------------

test("a contact point can be permitted and still not be the preferred one", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "preference-person");

  await addEmail(
    database,
    { entityId: personId, address: "ada@example.com", preference: { permitted: true } },
    writeOptions("permitted-email"),
  );
  await addPhone(
    database,
    {
      entityId: personId,
      number: "+1 702 555 0143",
      preference: { preferred: true },
    },
    writeOptions("preferred-phone"),
  );

  const points = await readContactPoints(database, personId);
  expect(points.emails[0]?.state.permitted).toBe(true);
  expect(points.emails[0]?.state.preferred).toBe(false);
  expect(points.phones[0]?.state.permitted).toBe(true);
  expect(points.phones[0]?.state.preferred).toBe(true);
});

test("a withdrawn permission is recorded with its reason rather than deleting the value", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "withdrawn-person");
  const phoneId = await addPhone(
    database,
    { entityId: personId, number: "+1 702 555 0143" },
    writeOptions("withdrawn-phone"),
  );

  await updatePhone(
    database,
    {
      phoneId,
      preference: { permitted: false, note: "Asked us never to ring this line during the week." },
    },
    writeOptions("withdraw"),
  );

  const phones = await readPhones(database, personId);
  expect(phones).toHaveLength(1);
  expect(phones[0]?.state.permitted).toBe(false);
  expect(phones[0]?.state.note).toBe("Asked us never to ring this line during the week.");
  // The number itself is untouched — deleting it would lose the instruction along with the value.
  expect(phones[0]?.number).toBe("+1 702 555 0143");
});

test("the preferred contact point is one answer across all three channels", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "one-preference-person");

  await addEmail(
    database,
    { entityId: personId, address: "ada@example.com", preference: { preferred: true } },
    writeOptions("first-preferred"),
  );
  await addAddress(
    database,
    {
      entityId: personId,
      street: "1 High Street",
      city: "Ayr",
      country: "GB",
      preference: { preferred: true },
    },
    writeOptions("second-preferred"),
  );

  const points = await readContactPoints(database, personId);
  // Promoting the address demoted the email, across a table boundary.
  expect(points.emails[0]?.state.preferred).toBe(false);
  expect(points.addresses[0]?.state.preferred).toBe(true);
});

test("re-saving the already-preferred row does not demote itself", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "resave-person");
  const phoneId = await addPhone(
    database,
    {
      entityId: personId,
      number: "+1 702 555 0143",
      isPrimary: true,
      preference: { preferred: true },
    },
    writeOptions("resave-phone"),
  );

  await updatePhone(database, { phoneId, contactUse: "home" }, writeOptions("resave-edit"));

  const phones = await readPhones(database, personId);
  expect(phones[0]?.state.preferred).toBe(true);
  expect(phones[0]?.isPrimary).toBe(true);
  expect(phones[0]?.contactUse).toBe("home");
});

// ---- verification --------------------------------------------------------------------------------

test("a failed verification is recorded with when and what, and nothing is blocked", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "verification-person");
  const addressId = await addAddress(
    database,
    { entityId: personId, street: "1 High Street", city: "Ayr", country: "GB" },
    writeOptions("verify-address"),
  );

  const addresses = await readAddresses(database, personId);
  expect(addresses[0]?.state.verificationStatus).toBe("unverified");

  await updateAddress(
    database,
    {
      addressId,
      verification: {
        status: "failed",
        detail: "Returned by the carrier: no such number in street.",
      },
    },
    writeOptions("verify-fail"),
  );

  const afterFailure = await readAddresses(database, personId);
  expect(afterFailure[0]?.state.verificationStatus).toBe("failed");
  expect(afterFailure[0]?.state.verifiedAt).toBe("2026-08-30T00:00:00.000Z");
  expect(afterFailure[0]?.state.verificationDetail).toBe(
    "Returned by the carrier: no such number in street.",
  );
  // The address is still readable, still permitted, and still primary-eligible: a failure is a
  // record and a warning, never a gate.
  expect(afterFailure[0]?.state.permitted).toBe(true);
  expect(afterFailure[0]?.street).toBe("1 High Street");
});

test("an edit that does not mention verification does not read as a confirmation", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "no-false-verify-person");
  const phoneId = await addPhone(
    database,
    { entityId: personId, number: "+1 702 555 0143", verification: { status: "verified" } },
    writeOptions("verified-phone"),
  );

  await updatePhone(database, { phoneId, contactUse: "mobile" }, writeOptions("unrelated-edit"));
  const phones = await readPhones(database, personId);
  expect(phones[0]?.state.verificationStatus).toBe("verified");
  expect(phones[0]?.state.verifiedAt).toBe("2026-08-30T00:00:00.000Z");
});

// ---- the rest of the write path ------------------------------------------------------------------

test("removing a contact point is a soft delete and a second removal fails loudly", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "remove-person");
  const phoneId = await addPhone(
    database,
    { entityId: personId, number: "+1 702 555 0143" },
    writeOptions("remove-phone"),
  );
  const addressId = await addAddress(
    database,
    { entityId: personId, street: "1 High Street" },
    writeOptions("remove-address"),
  );

  await removePhone(database, phoneId, writeOptions("remove-phone-act"));
  await removeAddress(database, addressId, writeOptions("remove-address-act"));

  expect(await readPhones(database, personId)).toHaveLength(0);
  expect(await readAddresses(database, personId)).toHaveLength(0);

  const { results } = await database
    .prepare("SELECT deleted_at FROM directory_phone WHERE id = ?1")
    .bind(phoneId)
    .all<{ deleted_at: string | null }>();
  expect(results[0]?.deleted_at).toBe("2026-08-30T00:00:00.000Z");

  await expect(removePhone(database, phoneId, writeOptions("again"))).rejects.toBeInstanceOf(
    DirectoryPhoneNotFoundError,
  );
  await expect(removeAddress(database, addressId, writeOptions("again"))).rejects.toBeInstanceOf(
    DirectoryAddressNotFoundError,
  );
});

test("a contact write against an unknown entity is refused before anything is stored", async () => {
  const database = freshDatabase();
  await expect(
    addPhone(
      database,
      { entityId: "directoryPerson_nobody", number: "+1 702 555 0143" },
      writeOptions("no-entity"),
    ),
  ).rejects.toBeInstanceOf(UnknownEntityError);
  await expect(readContactPoints(database, "directoryPerson_nobody")).rejects.toBeInstanceOf(
    UnknownEntityError,
  );
});

test("one read answers all three channels", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "all-three-person");
  await addEmail(database, { entityId: personId, address: "ada@example.com" }, writeOptions("e"));
  await addPhone(database, { entityId: personId, number: "+44 20 7946 0018" }, writeOptions("p"));
  await addAddress(database, { entityId: personId, street: "1 High Street" }, writeOptions("a"));

  const points = await readContactPoints(database, personId);
  expect(points.emails).toHaveLength(1);
  expect(points.phones).toHaveLength(1);
  expect(points.addresses).toHaveLength(1);
  expect(await readEmails(database, personId)).toHaveLength(1);
});

// ---- the pure parts ------------------------------------------------------------------------------

test("the country calling code splits by the E.164 assignment rule", () => {
  expect(structurePhoneNumber("+17025550143").countryCallingCode).toBe("1");
  expect(structurePhoneNumber("+442079460018").countryCallingCode).toBe("44");
  expect(structurePhoneNumber("+35312345678").countryCallingCode).toBe("353");
  // The other way people write the international form.
  expect(structurePhoneNumber("0044 20 7946 0018").countryCallingCode).toBe("44");
  // A national trunk prefix written inside an international number is NOT stripped: knowing that a
  // leading 0 is a trunk code rather than part of the number is per-country knowledge, and this
  // module deliberately holds none. The digits are kept as given rather than silently edited.
  expect(internationalPhoneNumber(structurePhoneNumber("+44 (0)20 7946 0018"))).toBe(
    "+4402079460018",
  );
  expect(internationalPhoneNumber(structurePhoneNumber("0207 946 0018"))).toBeNull();
});

test("the address key survives a field boundary moving", () => {
  const split = normalizedAddressKey({ street: "12 High St", city: "Ayr" });
  const run = normalizedAddressKey({ street: "12 High St Ayr" });
  // Two different records stay two different keys — the separator is what makes that true.
  expect(split).not.toBe(run);
  // Punctuation, case and accents fold away, so the same address entered twice collides.
  expect(normalizedAddressKey({ street: "12, High St.", city: "AYR" })).toBe(
    normalizedAddressKey({ street: "12 high st", city: "ayr" }),
  );
});
