import { guarded } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  ReviewDocumentId,
  ReviewSetId,
  ReviewTagEventId,
  ReviewTagId,
} from "@magna-carta/identifiers/types";
import { resolveApplicableTag } from "./coding-panel-service.ts";
import {
  applyDocumentTagStatement,
  clearSingleChoiceGroupStatement,
  completeTagEventStatement,
  insertTagEventStatement,
  markTagEventUndoneStatement,
  readFamilyDocumentIds,
  readReachableDocumentIds,
  readTagEvent,
  removeDocumentTagStatement,
  undoAppliedRowsStatement,
  undoRemovedRowsStatement,
  type ReviewTagEventRow,
} from "./coding-statements.ts";
import { BULK_CODING_CHUNK_SIZE, BULK_CODING_MAX_DOCUMENTS } from "./limits.ts";
import { codingSelectionKey } from "./r2-keys.ts";
import type { ReviewSetAccessPredicate } from "./review-set-visibility.ts";
import type { DiscoveryServiceOptions } from "./review-set-service.ts";
import type { ReviewTagEventKind, ReviewTagEventScope } from "./types.ts";
import {
  assertCodingCriteria,
  assertCodingSelectionSize,
  DiscoveryValidationError,
} from "./validation.ts";

// Coding: applying and removing tags, over one document, a family, or a frozen selection — and taking
// any of it back exactly.
//
// THE EVENT RECORDS THE GESTURE; THE ROWS RECORD THE RESULT. Whatever a reviewer clicked, what lands
// in the database is one row per (document, tag) application. A production later reads rows and only
// rows, so there is no inheritance rule for an inheritance bug to live in.
//
// THIS SUBSYSTEM WRITES NO GENERIC AUDIT ROW FOR CODING. The journal IS the audit, and it is richer
// than the generic row would be — scope, criteria, frozen selection, reversal. Writing both would be
// two homes for one fact, and they would drift. Changes to the PANEL and to the ACCESS LIST do write
// audit rows, because neither is a coding decision.

export interface CodingResult {
  readonly reviewTagEventId: ReviewTagEventId;
  readonly documentCount: number;
  readonly effect: EffectWrite;
}

// Applying to one document, or to a family. A single-choice answer is remove-plus-apply in ONE batch:
// the previous answer's row is closed and the new one written together, so two concurrent writers
// cannot leave a document both responsive and non-responsive — and if they raced anyway, the partial
// unique index refuses the second row rather than the service noticing afterwards.
export async function applyTag(
  database: SqlDatabase,
  input: {
    reviewSetId: ReviewSetId;
    reviewDocumentId: ReviewDocumentId;
    reviewTagId: ReviewTagId;
    scope: Extract<ReviewTagEventScope, "document" | "family">;
  },
  access: ReviewSetAccessPredicate,
  options: DiscoveryServiceOptions,
): Promise<CodingResult> {
  const { tag, group } = await resolveApplicableTag(
    database,
    input.reviewTagId,
    input.reviewSetId,
    access,
  );
  const documentIds = await resolveGestureDocuments(database, input, access);
  const reviewTagEventId = newIdentifier("reviewTagEvent", options.randomSource);
  const now = options.clock.now();
  const singleChoice = group.cardinality === "single";

  const statements = [
    insertTagEventStatement(database, {
      id: reviewTagEventId,
      reviewSetId: input.reviewSetId,
      kind: "apply",
      reviewTagId: tag.id,
      scope: input.scope,
      documentCount: documentIds.length,
      criteria: null,
      selectionR2Key: null,
      // A document or family gesture completes in the batch that starts it, so it is never observed
      // running. Bulk is the shape that needs the intermediate state.
      state: "complete",
      reversesEventId: null,
      actorUserId: options.actorUserId,
      now,
      completedAt: now,
    }),
  ];
  for (const reviewDocumentId of documentIds) {
    if (singleChoice) {
      statements.push(
        clearSingleChoiceGroupStatement(
          database,
          {
            reviewSetId: input.reviewSetId,
            reviewDocumentId,
            reviewTagGroupId: group.id,
            removedByEventId: reviewTagEventId,
            now,
          },
          access,
        ),
      );
    }
    statements.push(
      applyDocumentTagStatement(
        database,
        {
          id: newIdentifier("reviewDocumentTag", options.randomSource),
          reviewSetId: input.reviewSetId,
          reviewDocumentId,
          reviewTagId: tag.id,
          reviewTagGroupId: group.id,
          singleChoice,
          appliedByEventId: reviewTagEventId,
          now,
        },
        access,
      ),
    );
  }
  return {
    reviewTagEventId,
    documentCount: documentIds.length,
    effect: { statements, outboxMessages: [] },
  };
}

export async function removeTag(
  database: SqlDatabase,
  input: {
    reviewSetId: ReviewSetId;
    reviewDocumentId: ReviewDocumentId;
    reviewTagId: ReviewTagId;
    scope: Extract<ReviewTagEventScope, "document" | "family">;
  },
  access: ReviewSetAccessPredicate,
  options: DiscoveryServiceOptions,
): Promise<CodingResult> {
  // Resolved through the same path an application takes, INCLUDING the active check — a deactivated
  // tag is not removed through the panel either, because the panel no longer offers it. Rows carrying
  // one are cleared by undoing the act that applied them, which is attributed rather than anonymous.
  const { tag } = await resolveApplicableTag(
    database,
    input.reviewTagId,
    input.reviewSetId,
    access,
  );
  const documentIds = await resolveGestureDocuments(database, input, access);
  const reviewTagEventId = newIdentifier("reviewTagEvent", options.randomSource);
  const now = options.clock.now();
  return {
    reviewTagEventId,
    documentCount: documentIds.length,
    effect: {
      statements: [
        insertTagEventStatement(database, {
          id: reviewTagEventId,
          reviewSetId: input.reviewSetId,
          kind: "remove",
          reviewTagId: tag.id,
          scope: input.scope,
          documentCount: documentIds.length,
          criteria: null,
          selectionR2Key: null,
          state: "complete",
          reversesEventId: null,
          actorUserId: options.actorUserId,
          now,
          completedAt: now,
        }),
        ...documentIds.map((reviewDocumentId) =>
          removeDocumentTagStatement(
            database,
            {
              reviewSetId: input.reviewSetId,
              reviewDocumentId,
              reviewTagId: tag.id,
              removedByEventId: reviewTagEventId,
              now,
            },
            access,
          ),
        ),
      ],
      outboxMessages: [],
    },
  };
}

// A `family` gesture writes a row per family member; a `document` gesture writes one. Either way the
// documents are resolved through an access-scoped read first, so nothing is written to a corpus the
// actor cannot reach even if a later statement's own predicate were somehow satisfied.
async function resolveGestureDocuments(
  database: SqlDatabase,
  input: {
    reviewSetId: ReviewSetId;
    reviewDocumentId: ReviewDocumentId;
    scope: Extract<ReviewTagEventScope, "document" | "family">;
  },
  access: ReviewSetAccessPredicate,
): Promise<readonly ReviewDocumentId[]> {
  const documentIds =
    input.scope === "family"
      ? await readFamilyDocumentIds(
          database,
          input.reviewSetId,
          input.reviewDocumentId,
          access,
          BULK_CODING_MAX_DOCUMENTS,
        )
      : await readReachableDocumentIds(
          database,
          input.reviewSetId,
          [input.reviewDocumentId],
          access,
          1,
        );
  if (documentIds.length === 0) {
    throw new DiscoveryValidationError(
      "discovery-unknown-review-document",
      `no such review document in this review set: ${input.reviewDocumentId}`,
    );
  }
  return documentIds;
}

// ---------------------------------------------------------------------------------------------
// Bulk — over a selection frozen at initiation.

export interface BulkCodingPlan {
  readonly reviewTagEventId: ReviewTagEventId;
  readonly reviewSetId: ReviewSetId;
  readonly documentIds: readonly ReviewDocumentId[];
  // Where the caller must write the frozen list BEFORE executing a chunk. The route owns the bucket;
  // this package never touches one.
  readonly selectionR2Key: string;
  // The event insert, committed on its own so the selection has something to belong to and a partial
  // run has something to be attributed to.
  readonly openEffect: EffectWrite;
  readonly chunks: readonly (readonly ReviewDocumentId[])[];
}

// Planning and executing are separate because the selection has to be MATERIALIZED between them. The
// criteria that produced a selection are recorded for humans and never re-run: the corpus moves under
// a long operation, and criteria re-resolved per chunk would apply a tag to documents the operator
// never saw.
//
// The chunks are committed as several batches rather than one. A ceiling-sized selection cannot be
// one atomic write anywhere, and the event's `running` state is what makes a partial run honest
// rather than silent — the rows written so far are attributed to it, and an undo reverses exactly
// those.
export async function planBulkCoding(
  database: SqlDatabase,
  input: {
    reviewSetId: ReviewSetId;
    reviewTagId: ReviewTagId;
    reviewDocumentIds: readonly ReviewDocumentId[];
    kind: Extract<ReviewTagEventKind, "bulk-apply" | "bulk-remove">;
    criteria: string | null;
  },
  access: ReviewSetAccessPredicate,
  options: DiscoveryServiceOptions,
): Promise<BulkCodingPlan> {
  assertCodingSelectionSize(input.reviewDocumentIds.length);
  const criteria = assertCodingCriteria(input.criteria);
  const { tag } = await resolveApplicableTag(
    database,
    input.reviewTagId,
    input.reviewSetId,
    access,
  );

  // Resolved once, in SQL, against the access list. A document id naming another corpus VANISHES from
  // the selection rather than being refused by name — refusing it by name would confirm the id exists
  // to somebody who cannot see it.
  const documentIds = await readReachableDocumentIds(
    database,
    input.reviewSetId,
    input.reviewDocumentIds,
    access,
    BULK_CODING_MAX_DOCUMENTS,
  );
  if (documentIds.length === 0) {
    throw new DiscoveryValidationError(
      "discovery-coding-selection-empty",
      "none of the documents in that selection are in this review set",
    );
  }

  const reviewTagEventId = newIdentifier("reviewTagEvent", options.randomSource);
  const now = options.clock.now();
  const selectionR2Key = codingSelectionKey(input.reviewSetId, reviewTagEventId);
  const chunks: ReviewDocumentId[][] = [];
  for (let start = 0; start < documentIds.length; start += BULK_CODING_CHUNK_SIZE) {
    chunks.push(documentIds.slice(start, start + BULK_CODING_CHUNK_SIZE));
  }

  return {
    reviewTagEventId,
    reviewSetId: input.reviewSetId,
    documentIds,
    selectionR2Key,
    chunks,
    openEffect: {
      statements: [
        insertTagEventStatement(database, {
          id: reviewTagEventId,
          reviewSetId: input.reviewSetId,
          kind: input.kind,
          reviewTagId: tag.id,
          scope: "selection",
          // Filled in at completion. Recording the intended count here would make a partial run look
          // finished.
          documentCount: 0,
          criteria,
          selectionR2Key,
          state: "running",
          reversesEventId: null,
          actorUserId: options.actorUserId,
          now,
          completedAt: null,
        }),
      ],
      outboxMessages: [],
    },
  };
}

// One chunk of a planned bulk operation. Every statement carries the access predicate, so a chunk
// executed after the actor's access was revoked mid-operation writes nothing.
export async function buildBulkCodingChunk(
  database: SqlDatabase,
  plan: BulkCodingPlan,
  chunk: readonly ReviewDocumentId[],
  input: {
    reviewTagId: ReviewTagId;
    kind: Extract<ReviewTagEventKind, "bulk-apply" | "bulk-remove">;
  },
  access: ReviewSetAccessPredicate,
  options: DiscoveryServiceOptions,
): Promise<EffectWrite> {
  const { tag, group } = await resolveApplicableTag(
    database,
    input.reviewTagId,
    plan.reviewSetId,
    access,
  );
  const now = options.clock.now();
  const singleChoice = group.cardinality === "single";
  const statements = [];
  for (const reviewDocumentId of chunk) {
    if (input.kind === "bulk-remove") {
      statements.push(
        removeDocumentTagStatement(
          database,
          {
            reviewSetId: plan.reviewSetId,
            reviewDocumentId,
            reviewTagId: tag.id,
            removedByEventId: plan.reviewTagEventId,
            now,
          },
          access,
        ),
      );
      continue;
    }
    if (singleChoice) {
      statements.push(
        clearSingleChoiceGroupStatement(
          database,
          {
            reviewSetId: plan.reviewSetId,
            reviewDocumentId,
            reviewTagGroupId: group.id,
            removedByEventId: plan.reviewTagEventId,
            now,
          },
          access,
        ),
      );
    }
    statements.push(
      applyDocumentTagStatement(
        database,
        {
          id: newIdentifier("reviewDocumentTag", options.randomSource),
          reviewSetId: plan.reviewSetId,
          reviewDocumentId,
          reviewTagId: tag.id,
          reviewTagGroupId: group.id,
          singleChoice,
          appliedByEventId: plan.reviewTagEventId,
          now,
        },
        access,
      ),
    );
  }
  return { statements, outboxMessages: [] };
}

export function completeBulkCoding(
  database: SqlDatabase,
  plan: BulkCodingPlan,
  documentCount: number,
  options: DiscoveryServiceOptions,
): EffectWrite {
  return {
    statements: [
      guarded(
        completeTagEventStatement(
          database,
          plan.reviewTagEventId,
          documentCount,
          options.clock.now(),
        ),
        "tag-event.complete",
      ),
    ],
    outboxMessages: [],
  };
}

// ---------------------------------------------------------------------------------------------
// Undo — compensation, not deletion, and exact.

// Undoing an apply removes PRECISELY the rows that event wrote and which are still live. A tag
// somebody else applied independently afterwards has its own row and its own event and is untouched;
// a row already removed keeps its original removal attribution. Undoing a remove re-applies by the
// same rule. The undone event stays in the journal in state `undone`, pointing at its reversal —
// history never shortens.
export async function undoTagEvent(
  database: SqlDatabase,
  reviewTagEventId: ReviewTagEventId,
  access: ReviewSetAccessPredicate,
  options: DiscoveryServiceOptions,
): Promise<{ reviewTagEventId: ReviewTagEventId; effect: EffectWrite }> {
  const undone = await requireUndoableEvent(database, reviewTagEventId, access);
  const undoEventId = newIdentifier("reviewTagEvent", options.randomSource);
  const now = options.clock.now();
  const reversesAnApply = undone.kind === "apply" || undone.kind === "bulk-apply";
  return {
    reviewTagEventId: undoEventId,
    effect: {
      statements: [
        insertTagEventStatement(database, {
          id: undoEventId,
          reviewSetId: undone.review_set_id,
          kind: "undo",
          reviewTagId: undone.review_tag_id,
          scope: undone.scope,
          documentCount: undone.document_count,
          criteria: null,
          selectionR2Key: null,
          state: "complete",
          reversesEventId: undone.id,
          actorUserId: options.actorUserId,
          now,
          completedAt: now,
        }),
        reversesAnApply
          ? undoAppliedRowsStatement(
              database,
              { undoneEventId: undone.id, undoEventId, now },
              access,
            )
          : undoRemovedRowsStatement(database, { undoneEventId: undone.id }, access),
        // Ordered after the row work so a failure anywhere above leaves the event still `complete`
        // and still undoable, rather than marked undone over rows that never moved.
        guarded(markTagEventUndoneStatement(database, undone.id), "tag-event.undo"),
      ],
      outboxMessages: [],
    },
  };
}

async function requireUndoableEvent(
  database: SqlDatabase,
  reviewTagEventId: ReviewTagEventId,
  access: ReviewSetAccessPredicate,
): Promise<ReviewTagEventRow> {
  const event = await readTagEvent(database, reviewTagEventId, access);
  if (event === undefined) {
    throw new DiscoveryValidationError(
      "discovery-unknown-tag-event",
      `no such coding act: ${reviewTagEventId}`,
    );
  }
  if (event.kind === "undo") {
    throw new DiscoveryValidationError(
      "discovery-event-not-undoable",
      "an undo is itself a recorded act and is not undone. Apply or remove the tag again — that " +
        "is a new decision, and the journal should say so.",
    );
  }
  if (event.state !== "complete") {
    throw new DiscoveryValidationError(
      "discovery-event-not-undoable",
      event.state === "undone"
        ? "that coding act has already been reversed"
        : "that coding act is still running, so what it would reverse is still moving",
    );
  }
  return event;
}
