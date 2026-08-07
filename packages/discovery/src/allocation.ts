import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  DiscoveryLoadId,
  RecordCustodianId,
  ReviewDocumentId,
  ReviewSetId,
} from "@magna-carta/identifiers/types";
import { REVIEW_DOCUMENT_INSERT_BATCH_SIZE } from "./limits.ts";
import type {
  ResolvedEmailAttachment,
  ResolvedEmailMessage,
  ResolvedFileVersion,
} from "./internal-lane.ts";
import { advanceLoadedDocumentCountStatement } from "./load-statements.ts";
import {
  insertReviewDocumentStatement,
  type ReviewDocumentAllocation,
} from "./review-document-statements.ts";
import { advanceReviewSetDocumentCountStatement } from "./review-set-statements.ts";

// Turning a resolved selection into review documents. Pure planning: this module composes rows and
// batches, reads nothing, and touches no clock of its own — which is what lets the coordinator plan a
// chunk, commit it, and re-plan the same chunk after an eviction without a different answer.

export interface AllocationContext {
  readonly reviewSetId: ReviewSetId;
  readonly discoveryLoadId: DiscoveryLoadId;
  readonly recordCustodianId: RecordCustodianId;
  readonly randomSource?: RandomSource;
}

// A file selection becomes standalone documents: each is its own family, so every document has one
// and no read has a special case for the lonely ones.
export function planFileAllocations(
  versions: readonly ResolvedFileVersion[],
  context: AllocationContext,
): ReviewDocumentAllocation[] {
  return versions.map((version) => {
    const id = newIdentifier("reviewDocument", context.randomSource);
    return {
      id,
      reviewSetId: context.reviewSetId,
      discoveryLoadId: context.discoveryLoadId,
      recordCustodianId: context.recordCustodianId,
      sourceKind: "file_version" as const,
      fileVersionId: version.fileVersionId,
      emailMessageId: null,
      // A standalone document IS its own family. The schema CHECK holds it, and this is where it
      // becomes true.
      familyId: id,
      familyRole: "standalone" as const,
      familySequence: 0,
      sourceName: version.name,
      sourcePath: null,
      sizeBytes: version.sizeBytes,
      contentSha256: version.contentSha256,
    };
  });
}

// An email selection becomes FAMILIES: the message is the parent and its own family identifier, and
// each attachment is a child carrying that identifier and its position. An email and its attachments
// must stay together — a responsive attachment makes its parent responsive, a privileged parent
// taints its attachments, and a production that breaks a family will be challenged.
export function planEmailAllocations(
  messages: readonly ResolvedEmailMessage[],
  attachments: readonly ResolvedEmailAttachment[],
  context: AllocationContext,
): ReviewDocumentAllocation[] {
  const attachmentsByMessage = new Map<string, ResolvedEmailAttachment[]>();
  for (const attachment of attachments) {
    const bucket = attachmentsByMessage.get(attachment.emailMessageId);
    if (bucket === undefined) attachmentsByMessage.set(attachment.emailMessageId, [attachment]);
    else bucket.push(attachment);
  }

  const allocations: ReviewDocumentAllocation[] = [];
  for (const message of messages) {
    const parentId = newIdentifier("reviewDocument", context.randomSource);
    const children = attachmentsByMessage.get(message.emailMessageId) ?? [];
    // A message with no extracted attachments is standalone rather than a parent of nothing: a
    // family role of `parent` on a one-member family would make every family read ask "is this a
    // real family", which is a question the role exists to answer.
    const parentRole = children.length === 0 ? ("standalone" as const) : ("parent" as const);
    allocations.push({
      id: parentId,
      reviewSetId: context.reviewSetId,
      discoveryLoadId: context.discoveryLoadId,
      recordCustodianId: context.recordCustodianId,
      sourceKind: "email_message",
      fileVersionId: null,
      emailMessageId: message.emailMessageId,
      familyId: parentId,
      familyRole: parentRole,
      familySequence: 0,
      sourceName: message.subject,
      sourcePath: null,
      sizeBytes: null,
      // The message's own content hash. Exact dedup for MESSAGES is the email subsystem's dedup key
      // rather than this, because two copies of one message differ in their transport headers and a
      // raw-bytes hash would call them different documents; the hash is carried because the manifest
      // states it.
      contentSha256: message.contentSha256,
    });
    children.forEach((attachment, position) => {
      allocations.push({
        id: newIdentifier("reviewDocument", context.randomSource),
        reviewSetId: context.reviewSetId,
        discoveryLoadId: context.discoveryLoadId,
        recordCustodianId: context.recordCustodianId,
        sourceKind: "email_attachment",
        fileVersionId: attachment.fileVersionId,
        emailMessageId: null,
        familyId: parentId,
        familyRole: "attachment",
        // One-based, so the parent's zero is unambiguous and a family reads in the order the message
        // carried its parts.
        familySequence: position + 1,
        sourceName: attachment.filename,
        sourcePath: null,
        sizeBytes: attachment.sizeBytes,
        contentSha256: attachment.contentSha256,
      });
    });
  }
  return allocations;
}

// Split into commit-sized chunks. A load must never be N single-row commits and must never be one
// giant batch either; both walls are real, and the constant carries its derivation beside it in
// limits.ts.
export function chunkAllocations(
  allocations: readonly ReviewDocumentAllocation[],
  batchSize: number = REVIEW_DOCUMENT_INSERT_BATCH_SIZE,
): ReviewDocumentAllocation[][] {
  const chunks: ReviewDocumentAllocation[][] = [];
  for (let offset = 0; offset < allocations.length; offset += batchSize) {
    chunks.push(allocations.slice(offset, offset + batchSize));
  }
  return chunks;
}

// One chunk's effect: the rows, plus the two counters advanced in the SAME batch so the counts and
// the rows can never disagree. Relative rather than absolute, so two chunks committing concurrently
// cannot lose each other's work.
export function allocationChunkEffect(
  database: SqlDatabase,
  chunk: readonly ReviewDocumentAllocation[],
  context: { reviewSetId: ReviewSetId; discoveryLoadId: DiscoveryLoadId; now: string },
): EffectWrite {
  if (chunk.length === 0) return { statements: [], outboxMessages: [] };
  return {
    statements: [
      ...chunk.map((row) => insertReviewDocumentStatement(database, row, context.now)),
      advanceLoadedDocumentCountStatement(
        database,
        context.discoveryLoadId,
        chunk.length,
        context.now,
      ),
      advanceReviewSetDocumentCountStatement(
        database,
        context.reviewSetId,
        chunk.length,
        context.now,
      ),
    ],
    outboxMessages: [],
  };
}

// The identifiers a chunk allocated, in order — what the coordinator enqueues for processing and
// what its cursor advances past.
export function allocatedIdentifiers(
  chunk: readonly ReviewDocumentAllocation[],
): ReviewDocumentId[] {
  return chunk.map((row) => row.id);
}
