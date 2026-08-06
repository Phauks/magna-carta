import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { DiscoveryLoadId, ReviewSetId } from "@magna-carta/identifiers/types";
import {
  advanceProcessingCountsStatement,
  completeDiscoveryLoadStatement,
  insertDiscoveryLoadStatement,
  readDiscoveryLoad,
  transitionDiscoveryLoadStatement,
} from "./load-statements.ts";
import {
  validateLoadSourceDeclaration,
  type LoadSourceDeclaration,
} from "./load-source.ts";
import { LOAD_SOURCE_DESCRIPTION_MAX_LENGTH } from "./types.ts";
import { loadExceptionReportKey, loadManifestKey } from "./r2-keys.ts";
import { assertRecordCustodianBelongsToReviewSet } from "./record-custodian-service.ts";
import { reviewSetAcceptsLoads, type DiscoveryServiceOptions } from "./review-set-service.ts";
import { readReviewSet } from "./review-set-statements.ts";
import {
  DISCOVERY_LOAD_FORWARD_TRANSITIONS,
  type DiscoveryLoadState,
  type ReviewSetState,
} from "./types.ts";
import { DiscoveryValidationError, assertWithinDocumentCeiling } from "./validation.ts";

// A load is DECLARED BEFORE THE MATERIAL ARRIVES. That ordering is what makes the manifest's
// declared-versus-actual reconciliation possible at all, and what makes a load resumable across a
// dropped connection: the load row and its coordinator survive, and the client re-enumerates what is
// already present rather than starting again.
//
// Loads are append-only. A load is never edited — only superseded by a later load, or reversed by an
// explicit removal that is itself a recorded act.

export interface DeclareLoadInput extends LoadSourceDeclaration {
  readonly reviewSetId: ReviewSetId;
}

export async function declareLoad(
  database: SqlDatabase,
  input: DeclareLoadInput,
  options: DiscoveryServiceOptions,
): Promise<{ loadId: DiscoveryLoadId; effect: EffectWrite }> {
  // The source contract first — the lane, the transcript scope, and the declared count are refused
  // by name before anything is read, so a caller learns which of them is wrong.
  validateLoadSourceDeclaration(input);

  if (
    input.sourceDescription !== null &&
    input.sourceDescription.length > LOAD_SOURCE_DESCRIPTION_MAX_LENGTH
  ) {
    throw new DiscoveryValidationError(
      "discovery-invalid-declared-count",
      `a source description is at most ${LOAD_SOURCE_DESCRIPTION_MAX_LENGTH} characters`,
    );
  }

  const reviewSet = await readReviewSet(database, input.reviewSetId);
  if (reviewSet === undefined) {
    throw new DiscoveryValidationError(
      "discovery-unknown-review-set",
      `no such review set: ${input.reviewSetId}`,
    );
  }
  if (!reviewSetAcceptsLoads(reviewSet.state as ReviewSetState)) {
    throw new DiscoveryValidationError(
      "discovery-review-set-not-open",
      `this review set is ${reviewSet.state} and takes no more material. A locked review set still ` +
        `serves every read; load into a new one.`,
    );
  }

  // THE CEILING IS REFUSED, NOT DEGRADED, and refused at DECLARATION rather than partway through a
  // fan-out — a load that stopped halfway would leave a corpus nobody could describe.
  assertWithinDocumentCeiling({
    currentDocumentCount: reviewSet.document_count,
    incomingDocumentCount: input.declaredDocumentCount,
    documentCeiling: reviewSet.document_ceiling,
  });

  if (input.defaultRecordCustodianId !== null) {
    await assertRecordCustodianBelongsToReviewSet(
      database,
      input.defaultRecordCustodianId,
      input.reviewSetId,
    );
  }

  const loadId = newIdentifier("discoveryLoad", options.randomSource);
  const now = options.clock.now();
  return {
    loadId,
    effect: {
      statements: [
        insertDiscoveryLoadStatement(database, {
          id: loadId,
          reviewSetId: input.reviewSetId,
          lane: input.lane,
          transcriptScope: input.transcriptScope,
          declaredDocumentCount: input.declaredDocumentCount,
          defaultRecordCustodianId: input.defaultRecordCustodianId,
          sourceDescription: input.sourceDescription,
          initiatedBy: options.actorUserId,
          now,
        }),
        domainAuditStatement(database, {
          clock: options.clock,
          actorUserId: options.actorUserId,
          randomSource: options.randomSource,
          event: "discovery.loadDeclared",
          subjectId: loadId,
          // The lane, the transcript scope, and the counts — the facts that shape the corpus. NEVER
          // the source description, which is free text a loader may have written a name into.
          metadata: JSON.stringify({
            reviewSetId: input.reviewSetId,
            lane: input.lane,
            transcriptScope: input.transcriptScope,
            declaredDocumentCount: input.declaredDocumentCount,
          }),
        }),
      ],
      outboxMessages: [],
    },
  };
}

async function requireLoad(database: SqlDatabase, loadId: DiscoveryLoadId) {
  const row = await readDiscoveryLoad(database, loadId);
  if (row === undefined) {
    throw new DiscoveryValidationError("discovery-unknown-load", `no such load: ${loadId}`);
  }
  return row;
}

export function assertLoadTransition(from: DiscoveryLoadState, to: DiscoveryLoadState): void {
  if (from === to) return;
  if (!DISCOVERY_LOAD_FORWARD_TRANSITIONS[from].includes(to)) {
    throw new DiscoveryValidationError(
      "discovery-load-transition-refused",
      `a load moves declared -> loading -> processing -> complete, fails before it completes, and ` +
        `is reversed only once complete; ${from} -> ${to} is not a move it makes`,
    );
  }
}

export async function transitionLoad(
  database: SqlDatabase,
  loadId: DiscoveryLoadId,
  to: DiscoveryLoadState,
  options: DiscoveryServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await requireLoad(database, loadId);
  assertLoadTransition(existing.state, to);
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        transitionDiscoveryLoadStatement(database, loadId, existing.state, to, now),
        domainAuditStatement(database, {
          clock: options.clock,
          actorUserId: options.actorUserId,
          randomSource: options.randomSource,
          event: "discovery.loadTransitioned",
          subjectId: loadId,
          metadata: JSON.stringify({ from: existing.state, to }),
        }),
      ],
      outboxMessages: [],
    },
  };
}

// THE RECONCILIATION: a load completes only when what arrived equals what was processed plus what
// was excepted. The row CHECK refuses the write if it does not hold; this refuses it earlier and by
// name, so a caller is told the counts rather than shown an abort.
export async function completeLoad(
  database: SqlDatabase,
  loadId: DiscoveryLoadId,
  options: DiscoveryServiceOptions,
): Promise<{ effect: EffectWrite; manifestR2Key: string; exceptionReportR2Key: string }> {
  const existing = await requireLoad(database, loadId);
  assertLoadTransition(existing.state, "complete");
  const accountedFor = existing.processed_count + existing.exception_count;
  if (accountedFor !== existing.loaded_document_count) {
    throw new DiscoveryValidationError(
      "discovery-load-transition-refused",
      `this load has not reconciled: ${existing.loaded_document_count} documents were loaded and ` +
        `${accountedFor} are accounted for (${existing.processed_count} processed, ` +
        `${existing.exception_count} excepted). A load does not complete while a document is in ` +
        `neither column — that is a document that fell out of the corpus with nobody able to tell.`,
    );
  }
  const manifestR2Key = loadManifestKey(existing.review_set_id, loadId);
  const exceptionReportR2Key = loadExceptionReportKey(existing.review_set_id, loadId);
  const now = options.clock.now();
  return {
    manifestR2Key,
    exceptionReportR2Key,
    effect: {
      statements: [
        completeDiscoveryLoadStatement(
          database,
          loadId,
          { manifestR2Key, exceptionReportR2Key },
          now,
        ),
        domainAuditStatement(database, {
          clock: options.clock,
          actorUserId: options.actorUserId,
          randomSource: options.randomSource,
          event: "discovery.loadCompleted",
          subjectId: loadId,
          metadata: JSON.stringify({
            reviewSetId: existing.review_set_id,
            declaredDocumentCount: existing.declared_document_count,
            loadedDocumentCount: existing.loaded_document_count,
            processedCount: existing.processed_count,
            exceptionCount: existing.exception_count,
          }),
        }),
      ],
      outboxMessages: [],
    },
  };
}

// What the manifest states about a load that has finished: what was claimed, what arrived, and
// whether they agree. A mismatch is REPORTED, never corrected — a load file is not trusted over the
// bytes, and a declared count is not trusted over what committed.
export interface LoadReconciliation {
  readonly declaredDocumentCount: number;
  readonly loadedDocumentCount: number;
  readonly processedCount: number;
  readonly exceptionCount: number;
  readonly declarationMatched: boolean;
  readonly accountedFor: boolean;
}

export function reconcileLoad(row: {
  declared_document_count: number;
  loaded_document_count: number;
  processed_count: number;
  exception_count: number;
}): LoadReconciliation {
  return {
    declaredDocumentCount: row.declared_document_count,
    loadedDocumentCount: row.loaded_document_count,
    processedCount: row.processed_count,
    exceptionCount: row.exception_count,
    declarationMatched: row.declared_document_count === row.loaded_document_count,
    accountedFor: row.loaded_document_count === row.processed_count + row.exception_count,
  };
}

// Used by the processing lane as each document reaches a terminal state.
export function advanceLoadProcessingCounts(
  database: SqlDatabase,
  loadId: DiscoveryLoadId,
  deltas: { processed: number; excepted: number },
  options: DiscoveryServiceOptions,
): EffectWrite {
  return {
    statements: [
      advanceProcessingCountsStatement(database, loadId, deltas, options.clock.now()),
    ],
    outboxMessages: [],
  };
}
