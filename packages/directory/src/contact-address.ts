/*
 * Postal addresses for a directory entity — the write and read paths the table never had.
 *
 * `directory_address` has been in the schema since the baseline migration with no domain module and
 * no route: not one statement anywhere in the repository inserted an address for a person. This
 * module is that capability.
 *
 * THE FIELD SET IS INTERNATIONAL. Nothing here assumes a state and a five-digit postal code —
 * postal-address.ts carries the reasoning, and the short version is that which fields a country
 * uses, what they are called and what order they read in are properties of the country. No field is
 * required beyond one of them being present: an address a firm holds only half of is still the
 * address it holds, and refusing it sends it into a free-text note where no envelope, no service
 * affidavit and no duplicate check can reach it.
 *
 * A FAILED VERIFICATION IS RECORDED AND SURFACED, AND BLOCKS NOTHING. Returned mail is the single
 * most important thing an address can carry — it is the difference between an affidavit of diligence
 * that stands and one that does not — and it is also frequently wrong about the future. So the
 * record holds it, the screen shows it beside the address, and a send proceeds.
 */
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { DirectoryAddressId } from "@magna-carta/identifiers/types";
import { directoryAuditStatement, type DirectoryWriteOptions } from "./audit.ts";
import {
  CONTACT_FIELD_SELECT,
  contactPointStateFromRow,
  resolveContactFields,
  type ContactPointState,
  type ContactPreferenceInput,
  type ContactVerificationInput,
  type StoredContactFields,
} from "./contact-preference.ts";
import { assertEntityExists } from "./entity-kind.ts";
import {
  EmptyPostalAddressError,
  normalizedAddressKey,
  postalAddressIsEmpty,
  trimmedPart,
  type PostalAddressParts,
} from "./postal-address.ts";
import { runDirectoryEffect } from "./run-directory-effect.ts";
import {
  demoteEntityPreferredContactStatements,
  demoteEntityPrimaryAddressesStatement,
  insertAddressStatement,
  softDeleteAddressStatement,
  updateAddressStatement,
} from "./statements.ts";
import { ADDRESS_TYPES, ADDRESS_USES, type AddressType, type AddressUse } from "./types.ts";

export { EmptyPostalAddressError } from "./postal-address.ts";

// Thrown when a use or type outside the catalog is supplied. The column CHECK is open at rest — a
// committed migration is immutable — so this is where the catalog is actually enforced.
export class InvalidAddressClassificationError extends Error {
  readonly code = "invalid-address-classification";
  constructor(field: string, value: string) {
    super(
      `directory: not a known address ${field}: ${JSON.stringify(value)} (invalid-address-classification)`,
    );
    this.name = "InvalidAddressClassificationError";
  }
}

// Thrown when an address id names no live row (missing or already soft-deleted).
export class DirectoryAddressNotFoundError extends Error {
  readonly code = "directory-address-not-found";
  constructor(addressId: string) {
    super(
      `directory: address not found or soft-deleted: ${addressId} (directory-address-not-found)`,
    );
    this.name = "DirectoryAddressNotFoundError";
  }
}

function assertClassification(addressUse: AddressUse | null, addressType: AddressType): void {
  if (addressUse !== null && !ADDRESS_USES.includes(addressUse)) {
    throw new InvalidAddressClassificationError("use", addressUse);
  }
  if (!ADDRESS_TYPES.includes(addressType)) {
    throw new InvalidAddressClassificationError("type", addressType);
  }
}

export interface AddAddressInput extends PostalAddressParts {
  readonly entityId: string;
  readonly addressUse?: AddressUse | null;
  /** Whether the place physically exists. Defaults to physical; a post office box is `postal`. */
  readonly addressType?: AddressType;
  readonly isPrimary?: boolean;
  readonly preference?: ContactPreferenceInput;
  readonly verification?: ContactVerificationInput;
}

/** The stored parts, trimmed, with a blank field treated as absent rather than as a stored space. */
function storedParts(parts: PostalAddressParts) {
  return {
    recipient: trimmedPart(parts.recipient),
    organizationName: trimmedPart(parts.organizationName),
    street: trimmedPart(parts.street),
    streetTwo: trimmedPart(parts.streetTwo),
    dependentLocality: trimmedPart(parts.dependentLocality),
    city: trimmedPart(parts.city),
    region: trimmedPart(parts.region),
    postal: trimmedPart(parts.postal),
    sortingCode: trimmedPart(parts.sortingCode),
    country: trimmedPart(parts.country),
  };
}

/**
 * Attach a postal address to a directory entity, in one atomic batch with its audit row.
 *
 * Rejects a missing, soft-deleted or merged-away entity and a wholly empty address before any write.
 * Setting `isPrimary` demotes the entity's other live primary ADDRESSES; setting the preference
 * `preferred` demotes the entity's preferred contact point across all three channels at once.
 */
export async function addAddress(
  database: BatchDatabase,
  input: AddAddressInput,
  options: DirectoryWriteOptions,
): Promise<DirectoryAddressId> {
  await assertEntityExists(database, input.entityId);
  if (postalAddressIsEmpty(input)) throw new EmptyPostalAddressError();

  const addressUse = input.addressUse ?? null;
  const addressType = input.addressType ?? "physical";
  assertClassification(addressUse, addressType);

  const parts = storedParts(input);
  const addressId = newIdentifier("directoryAddress", options.randomSource);
  const now = options.clock.now();
  const isPrimary: 0 | 1 = input.isPrimary ? 1 : 0;
  const contactFields = resolveContactFields(input, null, options, now);

  const statements: SqlStatement[] = [];
  if (isPrimary === 1) {
    statements.push(demoteEntityPrimaryAddressesStatement(database, input.entityId, now));
  }
  if (contactFields.contactPreferred === 1) {
    statements.push(...demoteEntityPreferredContactStatements(database, input.entityId, now));
  }
  statements.push(
    insertAddressStatement(database, {
      id: addressId,
      entityId: input.entityId,
      ...parts,
      addressUse,
      addressType,
      normalizedKey: normalizedAddressKey(parts),
      isPrimary,
      createdAt: now,
      ...contactFields,
    }),
    directoryAuditStatement(database, options, "directory.address.added", addressId),
  );

  return runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements,
    outboxMessages: [],
    responseCode: 201,
    responseBody: { id: addressId },
    value: addressId,
    fromBody: (body) => (body as { id: DirectoryAddressId }).id,
  }));
}

interface AddressRow extends StoredContactFields {
  readonly id: DirectoryAddressId;
  readonly entity_id: string;
  readonly label: string | null;
  readonly recipient: string | null;
  readonly organization_name: string | null;
  readonly street: string | null;
  readonly street_two: string | null;
  readonly dependent_locality: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly postal: string | null;
  readonly sorting_code: string | null;
  readonly country: string | null;
  readonly address_use: string | null;
  readonly address_type: string | null;
  readonly is_primary: number;
  readonly deleted_at: string | null;
}

const ADDRESS_SELECT = `id, entity_id, label, recipient, organization_name, street, street_two, dependent_locality, city, region, postal, sorting_code, country, address_use, address_type, is_primary, ${CONTACT_FIELD_SELECT}`;

async function readLiveAddressRow(
  database: BatchDatabase,
  addressId: string,
): Promise<AddressRow | null> {
  const { results } = await database
    .prepare(`SELECT ${ADDRESS_SELECT}, deleted_at FROM directory_address WHERE id = ?1`)
    .bind(addressId)
    .all<AddressRow>();
  const row = results[0];
  if (row === undefined || row.deleted_at !== null) return null;
  return row;
}

export interface UpdateAddressInput extends PostalAddressParts {
  readonly addressId: string;
  readonly addressUse?: AddressUse | null;
  readonly addressType?: AddressType;
  readonly isPrimary?: boolean;
  readonly preference?: ContactPreferenceInput;
  readonly verification?: ContactVerificationInput;
}

/**
 * Update a live address in one atomic batch. Reads the current row first — D1 has no interactive
 * transaction — so an omitted field keeps its current value rather than being nulled.
 */
export async function updateAddress(
  database: BatchDatabase,
  input: UpdateAddressInput,
  options: DirectoryWriteOptions,
): Promise<DirectoryAddressId> {
  const current = await readLiveAddressRow(database, input.addressId);
  if (current === null) throw new DirectoryAddressNotFoundError(input.addressId);

  const merged: PostalAddressParts = {
    recipient: input.recipient === undefined ? current.recipient : input.recipient,
    organizationName:
      input.organizationName === undefined ? current.organization_name : input.organizationName,
    street: input.street === undefined ? current.street : input.street,
    streetTwo: input.streetTwo === undefined ? current.street_two : input.streetTwo,
    dependentLocality:
      input.dependentLocality === undefined ? current.dependent_locality : input.dependentLocality,
    city: input.city === undefined ? current.city : input.city,
    region: input.region === undefined ? current.region : input.region,
    postal: input.postal === undefined ? current.postal : input.postal,
    sortingCode: input.sortingCode === undefined ? current.sorting_code : input.sortingCode,
    country: input.country === undefined ? current.country : input.country,
  };
  if (postalAddressIsEmpty(merged)) throw new EmptyPostalAddressError();

  const addressUse =
    input.addressUse === undefined ? (current.address_use as AddressUse | null) : input.addressUse;
  const addressType = input.addressType ?? ((current.address_type ?? "physical") as AddressType);
  assertClassification(addressUse, addressType);

  const parts = storedParts(merged);
  const now = options.clock.now();
  const addressId = current.id;
  const isPrimary: 0 | 1 =
    input.isPrimary === undefined ? (current.is_primary === 1 ? 1 : 0) : input.isPrimary ? 1 : 0;
  const contactFields = resolveContactFields(input, current, options, now);

  const statements: SqlStatement[] = [];
  if (isPrimary === 1 && current.is_primary !== 1) {
    statements.push(demoteEntityPrimaryAddressesStatement(database, current.entity_id, now));
  }
  if (contactFields.contactPreferred === 1 && current.contact_preferred !== 1) {
    statements.push(...demoteEntityPreferredContactStatements(database, current.entity_id, now));
  }
  statements.push(
    updateAddressStatement(
      database,
      addressId,
      {
        ...parts,
        addressUse,
        addressType,
        normalizedKey: normalizedAddressKey(parts),
        isPrimary,
        ...contactFields,
      },
      now,
    ),
    directoryAuditStatement(database, options, "directory.address.updated", addressId),
  );

  return runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements,
    outboxMessages: [],
    responseCode: 200,
    responseBody: { id: addressId },
    value: addressId,
    fromBody: (body) => (body as { id: DirectoryAddressId }).id,
  }));
}

/** Soft-delete an address (never a hard delete). A missing or already-deleted id fails loudly. */
export async function removeAddress(
  database: BatchDatabase,
  addressId: string,
  options: DirectoryWriteOptions,
): Promise<DirectoryAddressId> {
  const current = await readLiveAddressRow(database, addressId);
  if (current === null) throw new DirectoryAddressNotFoundError(addressId);

  const now = options.clock.now();
  const id = current.id;
  return runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements: [
      softDeleteAddressStatement(database, id, now),
      directoryAuditStatement(database, options, "directory.address.removed", id),
    ],
    outboxMessages: [],
    responseCode: 200,
    responseBody: { id },
    value: id,
    fromBody: (body) => (body as { id: DirectoryAddressId }).id,
  }));
}

/** One postal address as the directory holds it. */
export interface DirectoryAddressRow {
  readonly id: DirectoryAddressId;
  readonly entityId: string;
  readonly recipient: string | null;
  readonly organizationName: string | null;
  readonly street: string | null;
  readonly streetTwo: string | null;
  readonly dependentLocality: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly postal: string | null;
  readonly sortingCode: string | null;
  readonly country: string | null;
  readonly addressUse: AddressUse | null;
  readonly addressType: AddressType;
  readonly isPrimary: boolean;
  readonly state: ContactPointState;
  /** The legacy free-text label, retained read-only until it is dropped. */
  readonly label: string | null;
}

function toAddressRow(row: AddressRow): DirectoryAddressRow {
  return {
    id: row.id,
    entityId: row.entity_id,
    recipient: row.recipient,
    organizationName: row.organization_name,
    street: row.street,
    streetTwo: row.street_two,
    dependentLocality: row.dependent_locality,
    city: row.city,
    region: row.region,
    postal: row.postal,
    sortingCode: row.sorting_code,
    country: row.country,
    addressUse: row.address_use as AddressUse | null,
    addressType: (row.address_type ?? "physical") as AddressType,
    isPrimary: row.is_primary === 1,
    state: contactPointStateFromRow(row),
    label: row.label,
  };
}

/** The live addresses on an entity, primary first, then oldest first for a stable read. */
export async function readAddresses(
  database: BatchDatabase,
  entityId: string,
): Promise<DirectoryAddressRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${ADDRESS_SELECT} FROM directory_address WHERE entity_id = ?1 AND deleted_at IS NULL ORDER BY is_primary DESC, created_at ASC, id ASC`,
    )
    .bind(entityId)
    .all<AddressRow>();
  return results.map(toAddressRow);
}
