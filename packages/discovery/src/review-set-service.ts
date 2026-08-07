import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { MatterId, ReviewSetId, UserId } from "@magna-carta/identifiers/types";
import { DEFAULT_DOCUMENT_CEILING } from "./limits.ts";
import {
  closeReviewSetStatement,
  insertReviewSetStatement,
  lockReviewSetStatement,
  markDerivedArtifactsReleasedStatement,
  readReviewSet,
  renameReviewSetStatement,
  reviewSetNameIsTaken,
  setSemanticIndexEnabledStatement,
} from "./review-set-statements.ts";
import { reviewSetDerivedPrefixes } from "./r2-keys.ts";
import type { ReviewSetState } from "./types.ts";
import {
  DiscoveryValidationError,
  assertReviewSetName,
  assertReviewSetTransition,
} from "./validation.ts";

// The review set: a named corpus under review, belonging to one matter, with its own index, its own
// lifecycle, and its own access story. The service validates in memory and composes statements into
// an effect batch; it holds no binding and no clock of its own, and it never touches R2 — closing
// tells the caller WHICH prefixes became collectable and lets the caller sweep them, because a domain
// package that deleted objects would be a domain package with a bucket.

export interface DiscoveryServiceOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId;
  readonly randomSource?: RandomSource;
}

export interface CreateReviewSetInput {
  readonly matterId: MatterId;
  readonly name: string;
  // Snapshotted onto the row. The caller resolves the firm's setting and passes it, so the domain
  // package reads no configuration of its own.
  readonly documentCeiling?: number;
  // Off unless a firm chooses it for this corpus: embedding a large corpus is a real metered cost
  // incurred whether or not anyone ever runs a semantic query.
  readonly semanticIndexEnabled?: boolean;
}

export async function createReviewSet(
  database: SqlDatabase,
  input: CreateReviewSetInput,
  options: DiscoveryServiceOptions,
): Promise<{ reviewSetId: ReviewSetId; effect: EffectWrite }> {
  const name = assertReviewSetName(input.name);
  const documentCeiling = input.documentCeiling ?? DEFAULT_DOCUMENT_CEILING;
  if (!Number.isInteger(documentCeiling) || documentCeiling <= 0) {
    throw new DiscoveryValidationError(
      "discovery-invalid-document-ceiling",
      "a review set's document ceiling is a whole number of documents, greater than zero",
    );
  }
  // Pre-checked so the caller gets a named refusal rather than a UNIQUE abort. The unique index is
  // still what arbitrates a race between two creations of the same name.
  if (await reviewSetNameIsTaken(database, input.matterId, name)) {
    throw new DiscoveryValidationError(
      "discovery-review-set-name-taken",
      `this matter already has a review set called ${JSON.stringify(name)}`,
    );
  }

  const reviewSetId = newIdentifier("reviewSet", options.randomSource);
  const now = options.clock.now();
  return {
    reviewSetId,
    effect: {
      statements: [
        insertReviewSetStatement(database, {
          id: reviewSetId,
          matterId: input.matterId,
          name,
          documentCeiling,
          semanticIndexEnabled: input.semanticIndexEnabled ?? false,
          createdBy: options.actorUserId,
          now,
        }),
        domainAuditStatement(database, {
          clock: options.clock,
          actorUserId: options.actorUserId,
          randomSource: options.randomSource,
          event: "discovery.reviewSetCreated",
          subjectId: reviewSetId,
          // Identifiers and the two scalars a reader needs. NEVER the name: a review set's name is
          // free text that routinely names a person or a case.
          metadata: JSON.stringify({
            matterId: input.matterId,
            documentCeiling,
            semanticIndexEnabled: input.semanticIndexEnabled ?? false,
          }),
        }),
      ],
      outboxMessages: [],
    },
  };
}

async function requireReviewSet(database: SqlDatabase, reviewSetId: ReviewSetId) {
  const row = await readReviewSet(database, reviewSetId);
  if (row === undefined) {
    throw new DiscoveryValidationError(
      "discovery-unknown-review-set",
      `no such review set: ${reviewSetId}`,
    );
  }
  return row;
}

export async function renameReviewSet(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  name: string,
  options: DiscoveryServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const trimmed = assertReviewSetName(name);
  const existing = await requireReviewSet(database, reviewSetId);
  if (
    trimmed !== existing.name &&
    (await reviewSetNameIsTaken(database, existing.matter_id, trimmed))
  ) {
    throw new DiscoveryValidationError(
      "discovery-review-set-name-taken",
      `this matter already has a review set called ${JSON.stringify(trimmed)}`,
    );
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        renameReviewSetStatement(database, reviewSetId, trimmed, now),
        domainAuditStatement(database, {
          clock: options.clock,
          actorUserId: options.actorUserId,
          randomSource: options.randomSource,
          event: "discovery.reviewSetRenamed",
          subjectId: reviewSetId,
          metadata: null,
        }),
      ],
      outboxMessages: [],
    },
  };
}

export async function setReviewSetSemanticIndexing(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  enabled: boolean,
  options: DiscoveryServiceOptions,
): Promise<{ effect: EffectWrite }> {
  await requireReviewSet(database, reviewSetId);
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        setSemanticIndexEnabledStatement(database, reviewSetId, enabled, now),
        domainAuditStatement(database, {
          clock: options.clock,
          actorUserId: options.actorUserId,
          randomSource: options.randomSource,
          event: "discovery.reviewSetSemanticIndexingSet",
          subjectId: reviewSetId,
          metadata: JSON.stringify({ semanticIndexEnabled: enabled }),
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Locking refuses new loads and changes nothing else: every read still serves, and every derived
// artifact stays where it is.
export async function lockReviewSet(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  options: DiscoveryServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await requireReviewSet(database, reviewSetId);
  assertReviewSetTransition(existing.state, "locked");
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        lockReviewSetStatement(database, reviewSetId, now),
        domainAuditStatement(database, {
          clock: options.clock,
          actorUserId: options.actorUserId,
          randomSource: options.randomSource,
          event: "discovery.reviewSetLocked",
          subjectId: reviewSetId,
          metadata: null,
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface CloseReviewSetResult {
  readonly effect: EffectWrite;
  // The R2 prefixes whose objects became eligible for collection. The manifests and exception
  // reports under `loads/` are deliberately absent: they are records, and a close never touches one.
  readonly collectablePrefixes: readonly string[];
}

// Closing destroys a derived cache and never a record. Every row survives, every manifest survives,
// every exception report survives; what becomes collectable is extracted text, metadata sidecars,
// and the index splits — all three rebuildable from source at any time.
export async function closeReviewSet(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  options: DiscoveryServiceOptions,
): Promise<CloseReviewSetResult> {
  const existing = await requireReviewSet(database, reviewSetId);
  assertReviewSetTransition(existing.state, "closed");
  const now = options.clock.now();
  return {
    collectablePrefixes: reviewSetDerivedPrefixes(reviewSetId),
    effect: {
      statements: [
        closeReviewSetStatement(database, reviewSetId, now),
        domainAuditStatement(database, {
          clock: options.clock,
          actorUserId: options.actorUserId,
          randomSource: options.randomSource,
          event: "discovery.reviewSetClosed",
          subjectId: reviewSetId,
          metadata: JSON.stringify({ documentCount: existing.document_count }),
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Recorded once the sweep has actually run. Separate from the close because the sweep is
// asynchronous, and "closed but not yet swept" is a state a firm can genuinely be in.
export function markReviewSetDerivedArtifactsReleased(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  options: DiscoveryServiceOptions,
): EffectWrite {
  const now = options.clock.now();
  return {
    statements: [markDerivedArtifactsReleasedStatement(database, reviewSetId, now)],
    outboxMessages: [],
  };
}

// Whether a review set will accept material. Read by the load declaration before anything else, so a
// firm is told the destination is shut rather than told a transition failed.
export function reviewSetAcceptsLoads(state: ReviewSetState): boolean {
  return state === "open";
}
