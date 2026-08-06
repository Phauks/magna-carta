import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { OutboxMessage } from "@magna-carta/data-access/outbox-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { LocationId, UserId } from "@magna-carta/identifiers/types";
import {
  clearLetterheadLogoStatement,
  closeLocationStatement,
  deleteLocationAddressesStatement,
  deleteMemberLocationsStatement,
  insertLocationAddressStatement,
  insertLocationStatement,
  insertMemberLocationStatement,
  type LocationFields,
  selectLocationStatement,
  setLetterheadLogoStatement,
  updateLocationFieldsStatement,
} from "./statements.ts";
import { LocationValidationError } from "./validation.ts";

// The locations module mirrors the ledger pattern: validate in memory, read what the batch needs
// before composing (D1 has no interactive transactions), and return an EffectWrite the caller runs
// through composeEffectBatch. It never imports another domain package and performs no I/O of its own.

// Wall-clock and actor arrive from the caller — the service reads no clock and trusts no ambient
// identity. randomSource lets fixtures mint byte-deterministic ids.
export interface ClockPort {
  now(): string;
}

export interface LocationServiceOptions {
  readonly clock: ClockPort;
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

export interface CreateLocationInput {
  readonly name: string;
  readonly jurisdiction?: string | null;
  // An IANA identifier (America/Los_Angeles). Validated as one a runtime can resolve, because a zone
  // nothing can render is a date nothing can print.
  readonly timeZone?: string | null;
  readonly numberCode?: string | null;
  readonly addressBlock?: string | null;
  readonly footer?: string | null;
  readonly remitTo?: string | null;
}

export interface AddressInput {
  readonly kind: "physical" | "mailing";
  readonly street?: string | null;
  readonly city?: string | null;
  readonly region?: string | null;
  readonly postal?: string | null;
  readonly phone?: string | null;
}

export interface MemberLocationInput {
  readonly locationId: LocationId;
  readonly isPrimary: boolean;
}

interface StoredLocation extends LocationFields {
  readonly id: LocationId;
  readonly status: "active" | "closed";
  // The object the office's current logo lives at, so a replace or a clear can hand the caller the key
  // it is about to stop pointing at.
  readonly letterheadLogoObjectKey: string | null;
}

function auditStatement(
  database: SqlDatabase,
  options: LocationServiceOptions,
  event: string,
  subjectId: string,
) {
  return domainAuditStatement(database, {
    event,
    subjectId,
    actorUserId: options.actorUserId,
    clock: options.clock,
    randomSource: options.randomSource,
  });
}

function requireNonEmptyName(name: string): void {
  if (name.trim().length === 0) {
    throw new LocationValidationError("empty-location-name", "a location needs a name");
  }
}

// Checked by construction against the runtime rather than against a shipped list: the IANA list
// changes under us (zones are added, renamed, and merged), and the only question that matters is
// whether this runtime can render a date in it. A fixed offset is refused outright — an offset is
// wrong for half the year wherever daylight saving is observed.
function requireResolvableTimeZone(timeZone: string | null): void {
  if (timeZone === null) return;
  if (/^[+-]\d{2}:?\d{2}$/.test(timeZone)) {
    throw new LocationValidationError(
      "unknown-time-zone",
      "a location's time zone is an IANA identifier such as America/Los_Angeles, never a fixed offset",
    );
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new LocationValidationError(
      "unknown-time-zone",
      `${timeZone} is not a time zone this platform can resolve`,
    );
  }
}

async function loadLocation(
  database: SqlDatabase,
  id: LocationId,
): Promise<StoredLocation | undefined> {
  const { results } = await selectLocationStatement(database, id).all<{
    id: LocationId;
    name: string;
    status: "active" | "closed";
    jurisdiction: string | null;
    time_zone: string | null;
    number_code: string | null;
    address_block: string | null;
    footer: string | null;
    remit_to: string | null;
    letterhead_logo_object_key: string | null;
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    jurisdiction: row.jurisdiction,
    timeZone: row.time_zone,
    numberCode: row.number_code,
    addressBlock: row.address_block,
    footer: row.footer,
    remitTo: row.remit_to,
    letterheadLogoObjectKey: row.letterhead_logo_object_key ?? null,
  };
}

export interface CreatedLocation {
  readonly locationId: LocationId;
  readonly effect: EffectWrite;
}

export async function createLocation(
  database: SqlDatabase,
  input: CreateLocationInput,
  options: LocationServiceOptions,
): Promise<CreatedLocation> {
  requireNonEmptyName(input.name);
  requireResolvableTimeZone(input.timeZone ?? null);
  const locationId = newIdentifier("location", options.randomSource);
  const createdAt = options.clock.now();
  const message: OutboxMessage = {
    topic: "location.created",
    payload: { locationId, name: input.name },
  };
  return {
    locationId,
    effect: {
      statements: [
        insertLocationStatement(database, {
          id: locationId,
          name: input.name,
          jurisdiction: input.jurisdiction ?? null,
          timeZone: input.timeZone ?? null,
          numberCode: input.numberCode ?? null,
          addressBlock: input.addressBlock ?? null,
          footer: input.footer ?? null,
          remitTo: input.remitTo ?? null,
          createdAt,
        }),
        auditStatement(database, options, "location.created", locationId),
      ],
      outboxMessages: [message],
    },
  };
}

export type LocationPatch = Partial<CreateLocationInput>;

export async function updateLocation(
  database: SqlDatabase,
  locationId: LocationId,
  patch: LocationPatch,
  options: LocationServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await loadLocation(database, locationId);
  if (existing === undefined) {
    throw new LocationValidationError("unknown-location", `no such location: ${locationId}`);
  }
  // Merge the patch onto the stored fields: a key present (even null, to clear) wins; an absent key
  // keeps the stored value. The full-row UPDATE keeps the statement static.
  const merged: LocationFields = {
    name: patch.name ?? existing.name,
    jurisdiction: patch.jurisdiction !== undefined ? patch.jurisdiction : existing.jurisdiction,
    timeZone: patch.timeZone !== undefined ? patch.timeZone : existing.timeZone,
    numberCode: patch.numberCode !== undefined ? patch.numberCode : existing.numberCode,
    addressBlock: patch.addressBlock !== undefined ? patch.addressBlock : existing.addressBlock,
    footer: patch.footer !== undefined ? patch.footer : existing.footer,
    remitTo: patch.remitTo !== undefined ? patch.remitTo : existing.remitTo,
  };
  requireNonEmptyName(merged.name);
  requireResolvableTimeZone(merged.timeZone);
  return {
    effect: {
      statements: [
        updateLocationFieldsStatement(database, locationId, merged, options.clock.now()),
        auditStatement(database, options, "location.updated", locationId),
      ],
      outboxMessages: [{ topic: "location.updated", payload: { locationId } }],
    },
  };
}

// The image formats a letterhead logo may be, restated as the enforceable rule at the write.
//
// The list is the assembly engine's — PNG and JPEG, and nothing else, because those are the two formats
// every word processor draws identically and neither of them is a document that can carry markup or a
// script. It is restated rather than imported because this package depends on no other domain package
// by design; the format the ROUTE sniffed out of the bytes is what arrives here, and this is the check
// that a caller cannot store a mark the engine will refuse to draw.
export const SUPPORTED_LETTERHEAD_LOGO_CONTENT_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
];

export interface LetterheadLogoInput {
  readonly objectKey: string;
  // Sniffed from the bytes by the caller, never taken from an upload's declared type.
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly widthPixels: number;
  readonly heightPixels: number;
  // The width the mark prints at, in English Metric Units. The height is not stored: it follows from
  // the intrinsic proportions, so a document has no way to print a stretched logo.
  readonly widthEmu: number;
}

export async function setLetterheadLogo(
  database: SqlDatabase,
  locationId: LocationId,
  logo: LetterheadLogoInput,
  options: LocationServiceOptions,
): Promise<{ effect: EffectWrite; replacedObjectKey: string | null }> {
  const existing = await loadLocation(database, locationId);
  if (existing === undefined) {
    throw new LocationValidationError("unknown-location", `no such location: ${locationId}`);
  }
  if (!SUPPORTED_LETTERHEAD_LOGO_CONTENT_TYPES.includes(logo.contentType)) {
    throw new LocationValidationError(
      "unsupported-logo-format",
      `a letterhead logo is a PNG or a JPEG; ${logo.contentType} is neither`,
    );
  }
  if (!Number.isSafeInteger(logo.widthEmu) || logo.widthEmu <= 0) {
    throw new LocationValidationError(
      "invalid-logo-width",
      "a letterhead logo needs a printed width to be drawn at",
    );
  }
  return {
    effect: {
      statements: [
        setLetterheadLogoStatement(database, locationId, logo, options.clock.now()),
        auditStatement(database, options, "location.letterhead_logo_set", locationId),
      ],
      outboxMessages: [{ topic: "location.updated", payload: { locationId } }],
    },
    // The object the office was using until now, returned so the caller can remove it from the bucket
    // in the same operation that stops pointing at it. Reported rather than deleted here: this package
    // performs no I/O, and an orphaned object is a cost, not a correctness problem, so the caller is
    // free to leave it if a delete fails.
    replacedObjectKey: existing.letterheadLogoObjectKey,
  };
}

export async function clearLetterheadLogo(
  database: SqlDatabase,
  locationId: LocationId,
  options: LocationServiceOptions,
): Promise<{ effect: EffectWrite; replacedObjectKey: string | null }> {
  const existing = await loadLocation(database, locationId);
  if (existing === undefined) {
    throw new LocationValidationError("unknown-location", `no such location: ${locationId}`);
  }
  return {
    effect: {
      statements: [
        clearLetterheadLogoStatement(database, locationId, options.clock.now()),
        auditStatement(database, options, "location.letterhead_logo_cleared", locationId),
      ],
      outboxMessages: [{ topic: "location.updated", payload: { locationId } }],
    },
    replacedObjectKey: existing.letterheadLogoObjectKey,
  };
}

export interface CloseLocationOptions extends LocationServiceOptions {
  readonly firmDefaultLocationId: LocationId | null;
}

export async function closeLocation(
  database: SqlDatabase,
  locationId: LocationId,
  options: CloseLocationOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await loadLocation(database, locationId);
  if (existing === undefined) {
    throw new LocationValidationError("unknown-location", `no such location: ${locationId}`);
  }
  if (options.firmDefaultLocationId === locationId) {
    throw new LocationValidationError(
      "location-is-firm-default",
      "the firm-default location cannot be closed; set another default first",
    );
  }
  return {
    effect: {
      statements: [
        closeLocationStatement(database, locationId, options.clock.now()),
        auditStatement(database, options, "location.closed", locationId),
      ],
      outboxMessages: [{ topic: "location.updated", payload: { locationId } }],
    },
  };
}

export async function setLocationAddresses(
  database: SqlDatabase,
  locationId: LocationId,
  addresses: readonly AddressInput[],
  options: LocationServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await loadLocation(database, locationId);
  if (existing === undefined) {
    throw new LocationValidationError("unknown-location", `no such location: ${locationId}`);
  }
  // At most one physical and one mailing address (the letterhead reads "the" address of each kind).
  const kinds = new Set<string>();
  for (const address of addresses) {
    if (kinds.has(address.kind)) {
      throw new LocationValidationError(
        "duplicate-address-kind",
        `more than one ${address.kind} address for one location`,
      );
    }
    kinds.add(address.kind);
  }
  const createdAt = options.clock.now();
  return {
    effect: {
      statements: [
        // Replace-set: drop the whole set, then insert the new one.
        deleteLocationAddressesStatement(database, locationId),
        ...addresses.map((address) =>
          insertLocationAddressStatement(database, {
            id: newIdentifier("locationAddress", options.randomSource),
            locationId,
            kind: address.kind,
            street: address.street ?? null,
            city: address.city ?? null,
            region: address.region ?? null,
            postal: address.postal ?? null,
            phone: address.phone ?? null,
            createdAt,
          }),
        ),
        auditStatement(database, options, "location.addresses_set", locationId),
      ],
      outboxMessages: [{ topic: "location.updated", payload: { locationId } }],
    },
  };
}

export async function assignMemberLocations(
  database: SqlDatabase,
  memberUserId: UserId,
  assignments: readonly MemberLocationInput[],
  options: LocationServiceOptions,
): Promise<{ effect: EffectWrite }> {
  // Exactly one primary when the member has any assignment; clearing all (empty set) needs none.
  if (assignments.length > 0) {
    const primaries = assignments.filter((assignment) => assignment.isPrimary).length;
    if (primaries !== 1) {
      throw new LocationValidationError(
        "member-needs-one-primary",
        `a member's assignments need exactly one primary location (found ${primaries})`,
      );
    }
  }
  const createdAt = options.clock.now();
  return {
    effect: {
      statements: [
        // Replace-set per member.
        deleteMemberLocationsStatement(database, memberUserId),
        ...assignments.map((assignment) =>
          insertMemberLocationStatement(database, {
            id: newIdentifier("memberLocation", options.randomSource),
            memberUserId,
            locationId: assignment.locationId,
            isPrimary: assignment.isPrimary,
            createdAt,
          }),
        ),
        auditStatement(database, options, "member.locations_assigned", memberUserId),
      ],
      // No external consequence — member↔location assignment is audited, not published.
      outboxMessages: [],
    },
  };
}
