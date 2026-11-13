import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { guarded, type EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { ExhibitSetId, MatterId } from "@magna-carta/identifiers/types";
import { DEFAULT_EXHIBIT_SCHEME } from "./presets.ts";
import type { ExhibitScheme } from "./scheme.ts";
import {
  archiveDraftExhibitSetStatement,
  insertExhibitSetStatement,
  readExhibitSetRow,
  schemeOf,
  updateDraftExhibitSetStatement,
  type ExhibitSetRow,
} from "./set-statements.ts";
import type { ExhibitServiceOptions } from "./types.ts";
import { ExhibitValidationError, assertScheme, assertSetName } from "./validation.ts";

// An exhibit set: the ordered membership for one filing, and the scheme its labels are written in.

/** The guard label a stale write against a set that has since been issued is refused under. */
export const DRAFT_SET_GUARD = "exhibit-set-draft";

export async function requireSet(
  database: SqlDatabase,
  matterId: MatterId,
  setId: ExhibitSetId,
): Promise<ExhibitSetRow> {
  const set = await readExhibitSetRow(database, setId);
  if (set === undefined || set.matter_id !== matterId) {
    throw new ExhibitValidationError("exhibit-unknown-set", "no such exhibit set on this matter");
  }
  return set;
}

/** Refuse, by name, an operation that needs a draft. */
export function assertDraft(set: ExhibitSetRow): void {
  if (set.state !== "draft") {
    throw new ExhibitValidationError(
      "exhibit-set-issued",
      "this set has been issued, so its order, members and numbering are fixed",
    );
  }
}

export interface CreateExhibitSetInput {
  readonly matterId: MatterId;
  readonly name: unknown;
  /** Absent takes the default scheme: Exhibit A, B, C. */
  readonly scheme?: Partial<Record<keyof ExhibitScheme, unknown>>;
}

export async function createExhibitSet(
  database: SqlDatabase,
  input: CreateExhibitSetInput,
  options: ExhibitServiceOptions,
): Promise<{ setId: ExhibitSetId; effect: EffectWrite }> {
  const name = assertSetName(input.name);
  const scheme = assertScheme({ ...DEFAULT_EXHIBIT_SCHEME, ...input.scheme });
  const setId = newIdentifier("exhibitSet", options.randomSource);
  return {
    setId,
    effect: {
      statements: [
        insertExhibitSetStatement(database, {
          id: setId,
          matterId: input.matterId,
          name,
          scheme,
          continuesFromSetId: null,
          supersedesSetId: null,
          createdBy: options.actorUserId,
          now: options.clock.now(),
        }),
        domainAuditStatement(database, {
          event: "exhibitSet.created",
          subjectId: setId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId: input.matterId },
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface EditExhibitSetInput {
  readonly name?: unknown;
  readonly scheme?: Partial<Record<keyof ExhibitScheme, unknown>>;
}

// Renaming or renumbering a draft. Every label follows at once, because a draft's labels are
// computed from the scheme on read and none is stored. An issued set is refused by name here and by
// the trigger in the database.
export async function editExhibitSet(
  database: SqlDatabase,
  matterId: MatterId,
  setId: ExhibitSetId,
  input: EditExhibitSetInput,
  options: ExhibitServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const set = await requireSet(database, matterId, setId);
  assertDraft(set);
  const name = input.name === undefined ? set.name : assertSetName(input.name);
  const scheme = assertScheme({ ...schemeOf(set), ...input.scheme });
  return {
    effect: {
      statements: [
        guarded(
          updateDraftExhibitSetStatement(database, setId, {
            name,
            scheme,
            now: options.clock.now(),
          }),
          DRAFT_SET_GUARD,
        ),
        domainAuditStatement(database, {
          event: "exhibitSet.edited",
          subjectId: setId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId, sequence: scheme.sequence },
        }),
      ],
      outboxMessages: [],
    },
  };
}

export async function archiveExhibitSet(
  database: SqlDatabase,
  matterId: MatterId,
  setId: ExhibitSetId,
  options: ExhibitServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const set = await requireSet(database, matterId, setId);
  assertDraft(set);
  return {
    effect: {
      statements: [
        guarded(
          archiveDraftExhibitSetStatement(database, setId, options.clock.now()),
          DRAFT_SET_GUARD,
        ),
        domainAuditStatement(database, {
          event: "exhibitSet.archived",
          subjectId: setId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId },
        }),
      ],
      outboxMessages: [],
    },
  };
}
