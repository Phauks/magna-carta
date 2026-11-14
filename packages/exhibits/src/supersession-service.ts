import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { ExhibitSetId, ExhibitSetMemberId, MatterId } from "@magna-carta/identifiers/types";
import { appendMemberStatement, readMemberRows } from "./member-statements.ts";
import type { ExhibitScheme } from "./scheme.ts";
import { insertExhibitSetStatement, schemeOf, type ExhibitSetRow } from "./set-statements.ts";
import { requireSet } from "./set-service.ts";
import { MAX_START_AT, type ExhibitServiceOptions } from "./types.ts";
import { ExhibitValidationError, assertScheme, assertSetName } from "./validation.ts";

// The two ways a new set follows an issued one.
//
// SUPERSEDING is the remedy for an issued set: an amended filing. The successor is a new draft that
// names its predecessor in supersedes_set_id, starts with the predecessor's active exhibits in the
// same order and the same scheme, and is edited freely until it is issued in turn. At most one set
// supersedes any set — a partial unique index refuses a fork even under two racing writes.
//
// CONTINUING is numbering that picks up where an issued set stopped: trial exhibits after a
// pretrial set. The new set starts one past the predecessor's highest CONSUMED ordinal, counting
// retired labels, so a withdrawn Exhibit 7 is never handed to a later document.

export interface SupersedeExhibitSetInput {
  readonly name?: unknown;
  /** When true, the successor also continues the predecessor's numbering rather than restarting. */
  readonly continueNumbering?: boolean;
}

/** The ordinal after the last one an issued set consumed, withdrawn labels included. */
export async function nextStartAfter(
  database: SqlDatabase,
  predecessor: ExhibitSetRow,
): Promise<number> {
  const members = await readMemberRows(database, predecessor.id);
  const highestPosition = members.reduce(
    (highest, member) => Math.max(highest, member.position),
    0,
  );
  return predecessor.start_number + highestPosition;
}

function requireIssued(set: ExhibitSetRow): void {
  if (set.state !== "issued") {
    throw new ExhibitValidationError(
      "exhibit-set-not-issued",
      "only an issued set can be superseded or continued; a draft is edited directly",
    );
  }
}

function continuingScheme(base: ExhibitScheme, startAt: number): ExhibitScheme {
  if (startAt > MAX_START_AT) {
    throw new ExhibitValidationError(
      "exhibit-scheme-out-of-range",
      `a continuing set would start past ${MAX_START_AT}`,
    );
  }
  return assertScheme({ ...base, startAt });
}

export async function supersedeExhibitSet(
  database: SqlDatabase,
  matterId: MatterId,
  setId: ExhibitSetId,
  input: SupersedeExhibitSetInput,
  options: ExhibitServiceOptions,
): Promise<{ setId: ExhibitSetId; memberIds: ExhibitSetMemberId[]; effect: EffectWrite }> {
  const predecessor = await requireSet(database, matterId, setId);
  requireIssued(predecessor);
  const { results } = await database
    .prepare(`SELECT id FROM exhibit_set WHERE supersedes_set_id = ?1`)
    .bind(setId)
    .all<{ id: ExhibitSetId }>();
  if (results.length > 0) {
    throw new ExhibitValidationError(
      "exhibit-set-already-superseded",
      "this set has already been superseded; amend the set that replaced it",
    );
  }
  const name = input.name === undefined ? predecessor.name : assertSetName(input.name);
  const continueNumbering = input.continueNumbering === true;
  const scheme = continueNumbering
    ? continuingScheme(schemeOf(predecessor), await nextStartAfter(database, predecessor))
    : schemeOf(predecessor);
  const members = (await readMemberRows(database, setId)).filter(
    (member) => member.status === "active",
  );
  const now = options.clock.now();
  const successorId = newIdentifier("exhibitSet", options.randomSource);
  const memberIds = members.map(() => newIdentifier("exhibitSetMember", options.randomSource));
  return {
    setId: successorId,
    memberIds,
    effect: {
      statements: [
        insertExhibitSetStatement(database, {
          id: successorId,
          matterId,
          name,
          scheme,
          continuesFromSetId: continueNumbering ? setId : null,
          supersedesSetId: setId,
          createdBy: options.actorUserId,
          now,
        }),
        ...members.map((member, index) =>
          appendMemberStatement(database, {
            id: memberIds[index] as ExhibitSetMemberId,
            setId: successorId,
            exhibitId: member.matter_exhibit_id,
            now,
          }),
        ),
        domainAuditStatement(database, {
          event: "exhibitSet.superseded",
          subjectId: successorId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId, supersedesSetId: setId, continueNumbering },
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface ContinueExhibitSetInput {
  readonly name: unknown;
}

/** A new, empty draft whose numbering continues from an issued set. */
export async function continueExhibitSet(
  database: SqlDatabase,
  matterId: MatterId,
  setId: ExhibitSetId,
  input: ContinueExhibitSetInput,
  options: ExhibitServiceOptions,
): Promise<{ setId: ExhibitSetId; effect: EffectWrite }> {
  const predecessor = await requireSet(database, matterId, setId);
  requireIssued(predecessor);
  const name = assertSetName(input.name);
  const scheme = continuingScheme(
    schemeOf(predecessor),
    await nextStartAfter(database, predecessor),
  );
  const successorId = newIdentifier("exhibitSet", options.randomSource);
  return {
    setId: successorId,
    effect: {
      statements: [
        insertExhibitSetStatement(database, {
          id: successorId,
          matterId,
          name,
          scheme,
          continuesFromSetId: setId,
          supersedesSetId: null,
          createdBy: options.actorUserId,
          now: options.clock.now(),
        }),
        domainAuditStatement(database, {
          event: "exhibitSet.continued",
          subjectId: successorId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId, continuesFromSetId: setId },
        }),
      ],
      outboxMessages: [],
    },
  };
}
