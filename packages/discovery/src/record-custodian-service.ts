import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RecordCustodianId, ReviewSetId } from "@magna-carta/identifiers/types";
import {
  insertRecordCustodianStatement,
  readRecordCustodian,
  readRecordCustodianIdByName,
  updateRecordCustodianStatement,
} from "./record-custodian-statements.ts";
import type { DiscoveryServiceOptions } from "./review-set-service.ts";
import { readReviewSet } from "./review-set-statements.ts";
import { RECORD_CUSTODIAN_KINDS, type RecordCustodianKind } from "./types.ts";
import { DiscoveryValidationError, assertRecordCustodianName } from "./validation.ts";

// The record custodian: whose electronic records these were. Created WITHIN a review set rather than
// firm-wide, because "John Smith, custodian" in one matter is not assertably the same person as in
// another and asserting it wrongly is a defensibility problem, not a duplication problem.
//
// The unattributed case is a KIND, not a null. A production that arrives with no custodial
// attribution is a fact about the production; recording it as "we do not know whose these were" is a
// statement a firm can stand behind, and an empty column is not.

// The name every review set gets for material nobody attributed. Created on demand rather than
// seeded, so a review set whose material is all attributed carries no phantom row.
export const UNATTRIBUTED_RECORD_CUSTODIAN_NAME = "Unattributed";

export interface CreateRecordCustodianInput {
  readonly reviewSetId: ReviewSetId;
  readonly displayName: string;
  readonly kind: RecordCustodianKind;
  // Usually a Directory entity — but a production may name somebody the firm has never met, so this
  // is optional and carries no cross-domain foreign key (the matter_party precedent).
  readonly directoryEntityId?: string | null;
}

function assertKind(value: string): RecordCustodianKind {
  const kind = RECORD_CUSTODIAN_KINDS.find((candidate) => candidate === value);
  if (kind === undefined) {
    throw new DiscoveryValidationError(
      "discovery-unknown-record-custodian-kind",
      `a record custodian is a person, an organization, or unattributed; not ${JSON.stringify(value)}`,
    );
  }
  return kind;
}

export async function createRecordCustodian(
  database: SqlDatabase,
  input: CreateRecordCustodianInput,
  options: DiscoveryServiceOptions,
): Promise<{ recordCustodianId: RecordCustodianId; effect: EffectWrite }> {
  const displayName = assertRecordCustodianName(input.displayName);
  const kind = assertKind(input.kind);
  if ((await readReviewSet(database, input.reviewSetId)) === undefined) {
    throw new DiscoveryValidationError(
      "discovery-unknown-review-set",
      `no such review set: ${input.reviewSetId}`,
    );
  }
  if ((await readRecordCustodianIdByName(database, input.reviewSetId, displayName)) !== undefined) {
    throw new DiscoveryValidationError(
      "discovery-record-custodian-name-taken",
      `this review set already has a record custodian called ${JSON.stringify(displayName)}`,
    );
  }

  const recordCustodianId = newIdentifier("recordCustodian", options.randomSource);
  const now = options.clock.now();
  return {
    recordCustodianId,
    effect: {
      statements: [
        insertRecordCustodianStatement(database, {
          id: recordCustodianId,
          reviewSetId: input.reviewSetId,
          displayName,
          directoryEntityId: input.directoryEntityId ?? null,
          kind,
          now,
        }),
        domainAuditStatement(database, {
          clock: options.clock,
          actorUserId: options.actorUserId,
          randomSource: options.randomSource,
          event: "discovery.recordCustodianCreated",
          subjectId: recordCustodianId,
          // Handles and the kind. NEVER the display name — a custodian's name is a person's name.
          metadata: JSON.stringify({ reviewSetId: input.reviewSetId, kind }),
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Resolve a custodian by name within a review set, creating one if it is not there. This is what the
// load lanes use: a load names its custodians in the loader's own words, and forcing a firm to
// pre-register every name a production mentions is how a load stops being usable.
export async function resolveRecordCustodian(
  database: SqlDatabase,
  input: CreateRecordCustodianInput,
  options: DiscoveryServiceOptions,
): Promise<{ recordCustodianId: RecordCustodianId; effect: EffectWrite }> {
  const displayName = assertRecordCustodianName(input.displayName);
  const existing = await readRecordCustodianIdByName(database, input.reviewSetId, displayName);
  if (existing !== undefined) {
    return { recordCustodianId: existing, effect: { statements: [], outboxMessages: [] } };
  }
  return createRecordCustodian(database, { ...input, displayName }, options);
}

export interface UpdateRecordCustodianInput {
  readonly displayName?: string;
  readonly kind?: RecordCustodianKind;
  readonly directoryEntityId?: string | null;
}

// Editing a custodian re-points every document already attributed to it, and that is the intent: a
// production that named "J. Smith" and the person the firm later identified are ONE custodian, and a
// second row would split the attribution of documents already loaded under the first.
export async function updateRecordCustodian(
  database: SqlDatabase,
  recordCustodianId: RecordCustodianId,
  patch: UpdateRecordCustodianInput,
  options: DiscoveryServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readRecordCustodian(database, recordCustodianId);
  if (existing === undefined) {
    throw new DiscoveryValidationError(
      "discovery-unknown-record-custodian",
      `no such record custodian: ${recordCustodianId}`,
    );
  }
  const displayName =
    patch.displayName === undefined
      ? existing.display_name
      : assertRecordCustodianName(patch.displayName);
  const kind = patch.kind === undefined ? existing.kind : assertKind(patch.kind);
  const directoryEntityId =
    patch.directoryEntityId === undefined ? existing.directory_entity_id : patch.directoryEntityId;

  if (displayName !== existing.display_name) {
    const clash = await readRecordCustodianIdByName(database, existing.review_set_id, displayName);
    if (clash !== undefined && clash !== recordCustodianId) {
      throw new DiscoveryValidationError(
        "discovery-record-custodian-name-taken",
        `this review set already has a record custodian called ${JSON.stringify(displayName)}`,
      );
    }
  }

  const now = options.clock.now();
  return {
    effect: {
      statements: [
        updateRecordCustodianStatement(database, recordCustodianId, {
          displayName,
          directoryEntityId,
          kind,
          now,
        }),
        domainAuditStatement(database, {
          clock: options.clock,
          actorUserId: options.actorUserId,
          randomSource: options.randomSource,
          event: "discovery.recordCustodianUpdated",
          subjectId: recordCustodianId,
          metadata: JSON.stringify({ reviewSetId: existing.review_set_id, kind }),
        }),
      ],
      outboxMessages: [],
    },
  };
}

// A custodian must belong to the review set the load is going into. Checked by hand because a
// foreign key cannot see the review set on the other side of it.
export async function assertRecordCustodianBelongsToReviewSet(
  database: SqlDatabase,
  recordCustodianId: RecordCustodianId,
  reviewSetId: ReviewSetId,
): Promise<void> {
  const existing = await readRecordCustodian(database, recordCustodianId);
  if (existing === undefined) {
    throw new DiscoveryValidationError(
      "discovery-unknown-record-custodian",
      `no such record custodian: ${recordCustodianId}`,
    );
  }
  if (existing.review_set_id !== reviewSetId) {
    throw new DiscoveryValidationError(
      "discovery-record-custodian-review-set-mismatch",
      "that record custodian belongs to a different review set. Custodians are review-set-scoped " +
        "on purpose: the same name in two matters is not assertably the same person.",
    );
  }
}
