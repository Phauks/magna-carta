import { z } from "zod";
import { identifierField } from "@magna-carta/identifiers/field";
import {
  IN_OUT_ENTRY_STATUSES,
  MAX_DESCRIPTION_LENGTH,
  MAX_KEPT_AT_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_RECIPIENTS,
} from "./types.ts";

// The In/Out Log's contract: what its API accepts in a request body and returns in a response, as
// plain zod named with `.meta({ id })` so the route module in apps/api-worker declares its routes
// over these without restating a field. Path and query parameters stay with the routes.

export const InOutPartyKindField = z.enum(["member", "entity", "external"]);
export const InOutEntryStatusField = z.enum(IN_OUT_ENTRY_STATUSES as [string, ...string[]]);

// One person on an entry: a member of the firm, a Directory person or organization, or just a name.
// The name is always sent, because the log keeps who it was at the time.
export const InOutParty = z
  .object({
    kind: InOutPartyKindField,
    userId: z.string().min(1).max(64).nullable().optional(),
    entityId: z.string().min(1).max(64).nullable().optional(),
    name: z.string().min(1).max(MAX_NAME_LENGTH),
  })
  .meta({ id: "InOutParty" });

export const DropOffRequest = z
  .object({
    description: z.string().min(1).max(MAX_DESCRIPTION_LENGTH),
    from: InOutParty,
    // Anybody listed here may collect it.
    to: z.array(InOutParty).min(1).max(MAX_RECIPIENTS),
    matterId: identifierField("matter").nullable().optional(),
    keptAt: z.string().max(MAX_KEPT_AT_LENGTH).nullable().optional(),
    notes: z.string().max(MAX_NOTES_LENGTH).nullable().optional(),
    // The draft number the Drop Off window holds (POST /api/v1/number-reservations).
    numberReservation: z.string().min(1).max(100).optional(),
  })
  .meta({ id: "InOutDropOffRequest" });

export const PickUpRequest = z
  .object({
    // One of the people the entry is To, by the id of their place on it.
    recipientId: identifierField("inOutEntryRecipient").nullable().optional(),
    // Or somebody who is not listed, by name. Exactly one of the two.
    collector: InOutParty.optional(),
    identityChecked: z.boolean(),
  })
  .meta({ id: "InOutPickUpRequest" });

export const MoveToCustodianRequest = z
  .object({ packetId: identifierField("custodyPacket") })
  .meta({ id: "InOutMoveToCustodianRequest" });

export const InOutRecipient = z
  .object({
    id: z.string(),
    kind: InOutPartyKindField,
    userId: z.string().nullable(),
    entityId: z.string().nullable(),
    name: z.string(),
  })
  .meta({ id: "InOutRecipient" });

export const InOutEntry = z
  .object({
    id: z.string(),
    number: z.string(),
    description: z.string(),
    from: z.object({
      kind: InOutPartyKindField,
      userId: z.string().nullable(),
      entityId: z.string().nullable(),
      name: z.string(),
    }),
    to: z.array(InOutRecipient),
    matter: z
      .object({ id: z.string(), title: z.string(), number: z.string().nullable() })
      .nullable(),
    keptAt: z.string().nullable(),
    notes: z.string().nullable(),
    status: InOutEntryStatusField,
    droppedOffAt: z.string(),
    recordedByUserId: z.string(),
    pickedUp: z
      .object({
        at: z.string(),
        by: z.object({
          kind: InOutPartyKindField,
          userId: z.string().nullable(),
          entityId: z.string().nullable(),
          name: z.string(),
        }),
        identityChecked: z.boolean(),
        handedOverByUserId: z.string().nullable(),
      })
      .nullable(),
    movedToCustodian: z
      .object({
        at: z.string(),
        packetId: z.string(),
        custodyNumber: z.string().nullable(),
        movedByUserId: z.string().nullable(),
      })
      .nullable(),
  })
  .meta({ id: "InOutEntry" });

export const InOutEntryPage = z
  .object({ entries: z.array(InOutEntry), nextCursor: z.string().nullable() })
  .meta({ id: "InOutEntryPage" });

export const InOutEntryCreated = z
  .object({ id: z.string(), number: z.string() })
  .meta({ id: "InOutEntryCreated" });
