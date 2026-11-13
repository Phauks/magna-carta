import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { insertMatterPartyStatement } from "@magna-carta/directory/statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { LocationId, MatterId, MatterTypeId, UserId } from "@magna-carta/identifiers/types";
import { URL_SAFE_PATTERN } from "@magna-carta/sequence-numbering/segments";
import { matterAuditStatement, type AuditContext } from "./audit.ts";
import { MATTER_PARTY_CLIENT_ROLE } from "./matter-party.ts";
import { closeMatterStatement, insertMatterStatement } from "./matter-statements.ts";
import { MatterValidationError } from "./validation.ts";

// A matter that arrives from the system a firm is leaving. It differs from a matter created here in
// three ways, and each is the reason this is its own composition and not a call to createMatter:
//
//   - It already has a number. The number is the one the firm, its clients and the courts have been
//     quoting for years, so it is written as given and no counter is drawn. It gets no allocation
//     row, exactly as a number entered by hand gets none, and a later draw that renders the same
//     string steps past it on the matter-number index.
//   - It was opened, and perhaps closed, in the past. Those instants come from the source, where
//     createMatter and closeMatter would stamp the moment of the transfer.
//   - It announces nothing. A matter created here asks for a conflicts check and may notify people;
//     several thousand arriving in an afternoon must do neither. So the composition returns no
//     outbox messages, and whatever accepts a finished transfer is what tells the rest of the
//     product the matters exist.
//
// A close written here runs no close precondition. The preconditions ask whether a matter still
// holds money or property in this system, and a matter being written for the first time holds none.

export interface TransferredMatterParty {
  readonly entityId: string;
  readonly role: string;
}

export interface TransferredMatterInput {
  readonly title: string;
  readonly description: string | null;
  readonly matterNumber: string;
  readonly matterTypeId: MatterTypeId | null;
  readonly locationId: LocationId | null;
  readonly responsibleMemberId: UserId;
  readonly clientDisplayName: string | null;
  // Stored instants. `closedAt` null means the matter arrives open.
  readonly openedAt: string;
  readonly closedAt: string | null;
  // The Directory record the firm acts for, written as the matter's client party in the same batch.
  readonly clientEntityId: string | null;
  // Everyone else on the matter. Each entity must already be a live Directory record: the caller
  // resolves that, because this function reads nothing.
  readonly parties: readonly TransferredMatterParty[];
}

export interface ComposedTransferredMatter {
  readonly matterId: MatterId;
  readonly statements: SqlStatement[];
}

export function composeTransferredMatter(
  database: SqlDatabase,
  input: TransferredMatterInput,
  context: AuditContext,
): ComposedTransferredMatter {
  if (input.title.trim().length === 0) {
    throw new MatterValidationError("empty-matter-title", "a matter needs a title");
  }
  // The same rule a number entered by hand meets: the number rides in addresses.
  if (!URL_SAFE_PATTERN.test(input.matterNumber)) {
    throw new MatterValidationError(
      "matter-number-not-url-safe",
      "a transferred matter's number may hold only letters, digits, and the characters . _ ~ -",
    );
  }
  for (const party of input.parties) {
    if (party.role.trim().length === 0) {
      throw new MatterValidationError("empty-party-role", "a transferred party needs a role");
    }
  }

  const matterId = newIdentifier("matter", context.randomSource);
  const now = context.clock.now();
  const statements: SqlStatement[] = [
    insertMatterStatement(database, {
      id: matterId,
      title: input.title,
      description: input.description,
      matterTypeId: input.matterTypeId,
      locationId: input.locationId,
      physicalFileLocationId: null,
      responsibleMemberId: input.responsibleMemberId,
      clientDisplayName: input.clientDisplayName,
      clientCode: null,
      status: "open",
      matterNumber: input.matterNumber,
      consultationNumber: null,
      intakeNumber: null,
      // The source assigned the number when it opened the matter; it records no separate instant.
      numberedAt: input.openedAt,
      openedAt: input.openedAt,
      createdAt: now,
    }),
    // Its own event, so the audit trail never reads as though somebody typed this matter in. The
    // number is recorded because it was chosen by another system and nothing here drew it.
    matterAuditStatement(database, context, "matter.transferred", matterId, {
      matterNumber: input.matterNumber,
      openedAt: input.openedAt,
      closedAt: input.closedAt,
    }),
  ];

  const parties: TransferredMatterParty[] = [
    ...(input.clientEntityId === null
      ? []
      : [{ entityId: input.clientEntityId, role: MATTER_PARTY_CLIENT_ROLE }]),
    ...input.parties,
  ];
  for (const party of parties) {
    const matterPartyId = newIdentifier("matterParty", context.randomSource);
    statements.push(
      insertMatterPartyStatement(database, {
        id: matterPartyId,
        matterId,
        entityId: party.entityId,
        role: party.role,
        capacity: null,
        createdAt: now,
      }),
      matterAuditStatement(database, context, "matter.party_transferred", matterId, {
        matterPartyId,
        entityId: party.entityId,
        role: party.role,
      }),
    );
  }

  if (input.closedAt !== null) {
    statements.push(closeMatterStatement(database, matterId, input.closedAt));
  }
  return { matterId, statements };
}
