import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { guarded, type EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  ExhibitSetId,
  ExhibitSetMemberId,
  MatterExhibitId,
  MatterId,
} from "@magna-carta/identifiers/types";
import { readMatterExhibit } from "./exhibit-statements.ts";
import { labelMoves, type LabelMove } from "./label-moves.ts";
import {
  appendMemberStatement,
  closeGapStatements,
  deleteDraftMemberStatement,
  readMemberRows,
  reorderStatements,
} from "./member-statements.ts";
import { schemeOf } from "./set-statements.ts";
import { DRAFT_SET_GUARD, assertDraft, requireSet } from "./set-service.ts";
import { MAX_MEMBERS_PER_SET, type ExhibitServiceOptions } from "./types.ts";
import { ExhibitValidationError } from "./validation.ts";

// Membership of a DRAFT set: adding, removing, and reordering. A draft's positions run 1..n with no
// gap, because a draft label is a function of the position and a gap would skip a letter. Every
// operation here is refused by name on an issued set, and by the database's triggers if a stale
// read gets that far.

/** The guard a reorder is refused under when the set's membership moved since it was read. */
export const ORDER_GUARD = "exhibit-order-current";

export async function addMembers(
  database: SqlDatabase,
  matterId: MatterId,
  setId: ExhibitSetId,
  exhibitIds: readonly MatterExhibitId[],
  options: ExhibitServiceOptions,
): Promise<{ memberIds: ExhibitSetMemberId[]; effect: EffectWrite }> {
  const set = await requireSet(database, matterId, setId);
  assertDraft(set);
  if (exhibitIds.length === 0) {
    throw new ExhibitValidationError("exhibit-invalid-input", "name at least one exhibit to add");
  }
  if (new Set(exhibitIds).size !== exhibitIds.length) {
    throw new ExhibitValidationError("exhibit-already-in-set", "an exhibit is named twice");
  }
  const members = await readMemberRows(database, setId);
  if (members.length + exhibitIds.length > MAX_MEMBERS_PER_SET) {
    throw new ExhibitValidationError(
      "exhibit-bound-exceeded",
      `a set holds at most ${MAX_MEMBERS_PER_SET} exhibits`,
    );
  }
  const present = new Set(members.map((member) => member.matter_exhibit_id));
  for (const exhibitId of exhibitIds) {
    const exhibit = await readMatterExhibit(database, exhibitId);
    if (exhibit === undefined || exhibit.matter_id !== matterId || exhibit.archived_at !== null) {
      throw new ExhibitValidationError("exhibit-unknown-exhibit", "no such exhibit on this matter");
    }
    if (present.has(exhibitId)) {
      throw new ExhibitValidationError(
        "exhibit-already-in-set",
        "that exhibit is already in the set",
      );
    }
  }
  const now = options.clock.now();
  const memberIds = exhibitIds.map(() => newIdentifier("exhibitSetMember", options.randomSource));
  return {
    memberIds,
    effect: {
      statements: [
        ...exhibitIds.map((exhibitId, index) =>
          appendMemberStatement(database, {
            id: memberIds[index] as ExhibitSetMemberId,
            setId,
            exhibitId,
            now,
          }),
        ),
        domainAuditStatement(database, {
          event: "exhibitSet.membersAdded",
          subjectId: setId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId, exhibitIds, memberIds },
        }),
      ],
      outboxMessages: [],
    },
  };
}

export async function removeMember(
  database: SqlDatabase,
  matterId: MatterId,
  setId: ExhibitSetId,
  memberId: ExhibitSetMemberId,
  options: ExhibitServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const set = await requireSet(database, matterId, setId);
  assertDraft(set);
  const members = await readMemberRows(database, setId);
  const member = members.find((candidate) => candidate.id === memberId);
  if (member === undefined) {
    throw new ExhibitValidationError("exhibit-unknown-member", "no such member in this set");
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        guarded(deleteDraftMemberStatement(database, setId, memberId), DRAFT_SET_GUARD),
        ...closeGapStatements(database, setId, member.position, now),
        domainAuditStatement(database, {
          event: "exhibitSet.memberRemoved",
          subjectId: setId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId, memberId, exhibitId: member.matter_exhibit_id },
        }),
      ],
      outboxMessages: [],
    },
  };
}

export async function reorderMembers(
  database: SqlDatabase,
  matterId: MatterId,
  setId: ExhibitSetId,
  orderedMemberIds: readonly ExhibitSetMemberId[],
  options: ExhibitServiceOptions,
): Promise<{ moves: LabelMove<ExhibitSetMemberId>[]; effect: EffectWrite }> {
  const set = await requireSet(database, matterId, setId);
  assertDraft(set);
  const members = await readMemberRows(database, setId);
  const current = members.map((member) => member.id);
  const proposed = new Set(orderedMemberIds);
  if (
    proposed.size !== orderedMemberIds.length ||
    orderedMemberIds.length !== current.length ||
    current.some((memberId) => !proposed.has(memberId))
  ) {
    throw new ExhibitValidationError(
      "exhibit-order-mismatch",
      "the order must name every member of the set exactly once",
    );
  }
  const moves = labelMoves(current, orderedMemberIds, schemeOf(set));
  const now = options.clock.now();
  if (current.length === 0) return { moves, effect: { statements: [], outboxMessages: [] } };
  const { park, settle } = reorderStatements(database, setId, orderedMemberIds, now);
  return {
    moves,
    effect: {
      statements: [
        guarded(park, ORDER_GUARD),
        settle,
        domainAuditStatement(database, {
          event: "exhibitSet.reordered",
          subjectId: setId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId, movedMemberIds: moves.map((move) => move.memberId) },
        }),
      ],
      outboxMessages: [],
    },
  };
}
