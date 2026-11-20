import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { guarded, type EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  CustodyPacketId,
  InOutEntryId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { ObservedDraw } from "@magna-carta/sequence-numbering/bounded-retry";
import {
  planSchemeDraw,
  schemeDrawOpeningStatements,
} from "@magna-carta/sequence-numbering/scheme-draw";
import {
  deleteAllocationStatement,
  deleteRecipientsStatement,
  deleteWaitingEntryStatement,
  insertEntryStatement,
  insertIdentityScanStatement,
  insertRecipientStatement,
  matterIsVisible,
  moveEntryToCustodianStatement,
  packetExists,
  pickUpEntryStatement,
  readEntry,
  readKnownMembers,
  readRecipients,
  type IdentityScanInput,
  type InOutEntryRow,
} from "./entry-statements.ts";
import { allocateEntryNumberStatement, IN_OUT_ENTRY_NUMBERING_TABLES } from "./numbering.ts";
import type { InOutParty, InOutPartyInput } from "./types.ts";
import {
  InOutValidationError,
  normalizeDescription,
  normalizeKeptAt,
  normalizeNotes,
  normalizeParty,
  normalizeRecipients,
} from "./validation.ts";

// The In/Out Log's write paths: Drop Off, Pick Up, the link to the custody packet an entry became,
// and deleting a mistaken entry while it is still waiting.
//
// Nothing here reads a clock, holds a database binding, or calls anything external: the clock, the
// actor and the random source arrive as options, which is what lets a test mint a byte-identical
// batch. Every write carries its audit row in the same batch, and the audit row carries identifiers
// and the entry's number, never what the entry is or whose it is: a description of somebody's
// papers is the client's business, and the audit log has its own readers and retention.

export interface InOutServiceOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId;
  readonly randomSource?: RandomSource;
  readonly visibility: VisibleMatterPredicate;
  /** Reports what the number draw observed, for the caller's bounded retry. */
  readonly observeDraw?: (draw: ObservedDraw) => void;
}

export interface DropOffInput {
  readonly description: string;
  readonly from: InOutPartyInput;
  readonly to: readonly InOutPartyInput[];
  readonly matterId?: string | null;
  readonly keptAt?: string | null;
  readonly notes?: string | null;
  /** The draft number the Drop Off window held, which this save is filed under where it still can be. */
  readonly numberReservation?: string;
}

async function assertMembersKnown(
  database: SqlDatabase,
  parties: readonly InOutParty[],
): Promise<void> {
  const userIds = [
    ...new Set(parties.flatMap((party) => (party.userId === null ? [] : [party.userId]))),
  ];
  const known = await readKnownMembers(database, userIds);
  for (const userId of userIds) {
    if (!known.has(userId)) {
      throw new InOutValidationError(
        "in-out-unknown-member",
        "that person is not a member of the firm",
      );
    }
  }
}

// DROP OFF: something has arrived at the desk, or has been set out there for somebody to collect.
// The entry is numbered in the same batch it is written in, so the record and its number are one
// write or neither.
export async function recordDropOff(
  database: SqlDatabase,
  input: DropOffInput,
  options: InOutServiceOptions,
): Promise<{ entryId: InOutEntryId; number: string; effect: EffectWrite }> {
  const description = normalizeDescription(input.description);
  const from = normalizeParty(input.from);
  const recipients = normalizeRecipients(input.to);
  const keptAt = normalizeKeptAt(input.keptAt);
  const notes = normalizeNotes(input.notes);
  const matterId = (input.matterId ?? null) as MatterId | null;
  if (matterId !== null && !(await matterIsVisible(database, matterId, options.visibility))) {
    throw new InOutValidationError("in-out-unknown-matter", "that matter is not one in this firm");
  }
  await assertMembersKnown(database, [from, ...recipients]);

  const now = options.clock.now();
  const plan = await planSchemeDraw(
    database,
    "in_out_entry",
    IN_OUT_ENTRY_NUMBERING_TABLES,
    { openedDate: civilDateOf(now) },
    { reservationToken: input.numberReservation, now },
  );
  options.observeDraw?.({
    scopeKey: plan.scopeKey,
    observedValue: plan.observedValue,
    startValue: plan.startValue,
  });

  const entryId = newIdentifier("inOutEntry", options.randomSource);
  return {
    entryId,
    number: plan.number,
    effect: {
      statements: [
        ...schemeDrawOpeningStatements(database, IN_OUT_ENTRY_NUMBERING_TABLES, plan),
        insertEntryStatement(database, {
          id: entryId,
          number: plan.number,
          description,
          from,
          matterId,
          keptAt,
          notes,
          recordedByUserId: options.actorUserId,
          now,
        }),
        ...recipients.map((recipient, position) =>
          insertRecipientStatement(database, {
            id: newIdentifier("inOutEntryRecipient", options.randomSource),
            entryId,
            position,
            recipient,
          }),
        ),
        allocateEntryNumberStatement(database, plan.scopeKey, plan.observedValue, entryId, now),
        domainAuditStatement(database, {
          event: "inOutLog.entry.droppedOff",
          subjectId: entryId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { number: plan.number, matterId, recipientCount: recipients.length },
        }),
      ],
      outboxMessages: [],
    },
  };
}

async function waitingEntry(
  database: SqlDatabase,
  entryId: InOutEntryId,
  visibility: VisibleMatterPredicate,
): Promise<InOutEntryRow> {
  const entry = await readEntry(database, entryId, visibility);
  if (entry === undefined) {
    throw new InOutValidationError(
      "in-out-unknown-entry",
      "that entry is not one in this firm's log",
    );
  }
  if (entry.status !== "waiting") {
    throw new InOutValidationError(
      "in-out-not-waiting",
      entry.status === "picked_up"
        ? "that entry has already been picked up"
        : "that entry has already been moved to Custodian",
    );
  }
  return entry;
}

export interface PickUpInput {
  // One of the people the entry is To, by the id of their place on it. Anybody listed may collect.
  readonly recipientId?: string | null;
  // Or somebody who is not listed (a courier sent for it), by name. Exactly one of the two.
  readonly collector?: InOutPartyInput | null;
  readonly identityChecked: boolean;
  // The picture of the ID they showed, already stored in the firm's bucket by the caller. Saved only
  // where the ID was checked.
  readonly identityScan?: IdentityScanInput | null;
}

// PICK UP: the entry has left the desk. Who collected it is either one of the people it was To or
// somebody the desk names; the person handing it over is the member recording it, from the session.
export async function recordPickUp(
  database: SqlDatabase,
  entryId: InOutEntryId,
  input: PickUpInput,
  options: InOutServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const entry = await waitingEntry(database, entryId, options.visibility);
  const identityScan = input.identityScan ?? null;
  if (identityScan !== null && !input.identityChecked) {
    throw new InOutValidationError(
      "in-out-scan-without-check",
      "a picture of an ID is saved only where the ID was checked",
    );
  }
  const hasRecipient = input.recipientId !== undefined && input.recipientId !== null;
  const hasCollector = input.collector !== undefined && input.collector !== null;
  if (hasRecipient === hasCollector) {
    throw new InOutValidationError(
      "in-out-invalid-party",
      "say who picked it up: one of the people it is to, or somebody else by name",
    );
  }
  let collector: InOutParty;
  if (hasRecipient) {
    const recipients = await readRecipients(database, [entryId]);
    const match = recipients.find((recipient) => recipient.id === input.recipientId);
    if (match === undefined) {
      throw new InOutValidationError(
        "in-out-unknown-recipient",
        "that person is not listed on this entry",
      );
    }
    collector = {
      kind: match.kind,
      userId: match.user_id,
      entityId: match.entity_id,
      name: match.name,
    };
  } else {
    collector = normalizeParty(input.collector as InOutPartyInput);
    await assertMembersKnown(database, [collector]);
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        guarded(
          pickUpEntryStatement(database, {
            id: entryId,
            collector,
            identityChecked: input.identityChecked,
            handedOverByUserId: options.actorUserId,
            now,
          }),
          "inOutLog.entry.pickUp",
        ),
        ...(identityScan === null
          ? []
          : [
              insertIdentityScanStatement(database, {
                ...identityScan,
                id: newIdentifier("inOutIdentityScan", options.randomSource),
                entryId,
                recordedByUserId: options.actorUserId,
                now,
              }),
            ]),
        domainAuditStatement(database, {
          event: "inOutLog.entry.pickedUp",
          subjectId: entryId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {
            number: entry.number,
            matterId: entry.matter_id,
            collectorKind: collector.kind,
            identityChecked: input.identityChecked,
            identityScanned: identityScan !== null,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// MOVE TO CUSTODIAN, the log's half: the entry now points at the packet it became and leaves Waiting
// for Pickup. The packet itself is logged through Custodian's own New Packet path first, under
// Custodian's own permission and rules; this records the link and nothing about the packet.
export async function recordMovedToCustodian(
  database: SqlDatabase,
  entryId: InOutEntryId,
  packetId: CustodyPacketId,
  options: InOutServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const entry = await waitingEntry(database, entryId, options.visibility);
  if (!(await packetExists(database, packetId))) {
    throw new InOutValidationError(
      "in-out-unknown-packet",
      "that packet is not one in this firm's register",
    );
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        guarded(
          moveEntryToCustodianStatement(database, {
            id: entryId,
            packetId,
            movedByUserId: options.actorUserId,
            now,
          }),
          "inOutLog.entry.moveToCustodian",
        ),
        domainAuditStatement(database, {
          event: "inOutLog.entry.movedToCustodian",
          subjectId: entryId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { number: entry.number, matterId: entry.matter_id, packetId },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// DELETE, for an entry recorded by mistake. Only while it is waiting: once it has been handed over or
// put into custody, the row is the record of that. The number it drew is not given back, so the
// run shows a gap where a mistake was, which the audit row explains.
export async function deleteWaitingEntry(
  database: SqlDatabase,
  entryId: InOutEntryId,
  options: InOutServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const entry = await waitingEntry(database, entryId, options.visibility);
  return {
    effect: {
      statements: [
        deleteRecipientsStatement(database, entryId),
        deleteAllocationStatement(database, entryId),
        guarded(deleteWaitingEntryStatement(database, entryId), "inOutLog.entry.delete"),
        domainAuditStatement(database, {
          event: "inOutLog.entry.deleted",
          subjectId: entryId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { number: entry.number, matterId: entry.matter_id },
        }),
      ],
      outboxMessages: [],
    },
  };
}
