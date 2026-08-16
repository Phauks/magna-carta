import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { dedupGroupIdentifier } from "@magna-carta/discovery/dedup";
import {
  claimDedupPrimaryStatement,
  clearDedupGroupStatement,
  insertReviewDocumentOccurrenceStatement,
  markReviewDocumentDuplicateStatement,
  readDedupPrimary,
  type DedupPrimaryRow,
} from "@magna-carta/discovery/dedup-statements";
import { advanceProcessingCountsStatement } from "@magna-carta/discovery/load-statements";
import {
  markReviewDocumentExceptedStatement,
  markReviewDocumentExpandedStatement,
  markReviewDocumentProcessedStatement,
} from "@magna-carta/discovery/processing-statements";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { ReviewDocumentRow } from "@magna-carta/discovery/review-document-statements";
import { deriveIdentifier } from "@magna-carta/identifiers/generate";
import type {
  DiscoveryLoadId,
  ReviewDocumentId,
  ReviewSetId,
} from "@magna-carta/identifiers/types";

// DEDUPLICATION, RUN BEFORE A SINGLE BYTE IS READ, because what it decides is whether this document
// is read at all.
//
// WHAT IT SUPPRESSES AND WHAT IT KEEPS. A duplicate is suppressed from EXTRACTION — the text, the
// index entry and eventually the embedding are produced once per group rather than once per copy.
// Nothing else about it is suppressed: the row stays, its record custodian stays, its load stays, it
// is counted in the load's reconciliation, it appears in the manifest, and an occurrence row names
// the primary it sits behind. "Which custodians held this document" is a question asked under oath,
// and it is answered by one indexed read over those occurrence rows.
//
// THE IDENTITY IS A CONTENT HASH, NEVER THE NEAR-DUPLICATE FINGERPRINT. The fingerprint on the same
// row is a similarity score that collides by design; suppressing a document from review on the
// strength of one would be deciding on a heuristic that a reviewer never sees a document. Clustering
// over the fingerprint is a reviewer-facing surface a later slice builds, and it shows documents
// rather than hiding them.
//
// A DOCUMENT WITH NO IDENTITY IS NOT A GROUP OF ONE. Bytes whose hash nobody recorded are bytes the
// platform cannot assert anything about, so the group stays null and the document is read on its own
// terms. That is the honest failure direction: the cost is an extraction that might have been
// avoided, and the alternative cost is evidence nobody reads.

export type DedupDecision =
  | { readonly outcome: "extract"; readonly dedupGroupId: string | null }
  // The primary of this document's group has not reached a terminal state yet. Not an error and not
  // a verdict: the caller parks the row and lets the queue bring the message back, by which time the
  // primary — which the dispatch walk enqueued ahead of this one, because it walks in identifier
  // order — has almost always finished.
  | { readonly outcome: "await-primary"; readonly primaryId: ReviewDocumentId }
  | { readonly outcome: "suppressed"; readonly primaryId: ReviewDocumentId };

export interface DedupContext {
  readonly database: BatchDatabase;
  readonly document: ReviewDocumentRow;
  readonly emailDedupKey: string | null;
  readonly now: () => string;
}

// Resolve this document's place in its group, and write that decision down before returning it. The
// caller acts on the outcome; the row already states it either way, so a crash between the two
// leaves a corpus that is readable rather than one mid-decision.
export async function resolveDeduplication(context: DedupContext): Promise<DedupDecision> {
  const { database, document } = context;
  const dedupGroupId = dedupGroupIdentifier({
    sourceKind: document.source_kind,
    contentSha256: document.content_sha256,
    emailDedupKey: context.emailDedupKey,
  });
  const now = context.now();

  if (dedupGroupId === null) {
    await commit(database, [clearDedupGroupStatement(database, document.id, now)], context.now);
    return { outcome: "extract", dedupGroupId: null };
  }

  // Take primacy, or take nothing, in one statement — the guard and the write have to be the same
  // act, or two consumers each read "nobody holds it" and the group ends up with two primaries.
  await commit(
    database,
    [claimDedupPrimaryStatement(database, document.id, document.review_set_id, dedupGroupId, now)],
    context.now,
  );

  // Read the group back rather than trusting a row count: the answer has to be the same whether this
  // process wrote the holder or a concurrent one did.
  const holder = await readDedupPrimary(database, document.review_set_id, dedupGroupId);
  if (holder === undefined || holder.id === document.id) {
    return { outcome: "extract", dedupGroupId };
  }

  await commit(
    database,
    [markReviewDocumentDuplicateStatement(database, document.id, dedupGroupId, now)],
    context.now,
  );
  return holder.processing_state === "processed" || holder.processing_state === "excepted"
    ? { outcome: "suppressed", primaryId: holder.id }
    : { outcome: "await-primary", primaryId: holder.id };
}

export interface SuppressionInput {
  readonly database: BatchDatabase;
  readonly document: ReviewDocumentRow;
  readonly primary: DedupPrimaryRow;
  readonly now: () => string;
}

export interface SuppressedTerminal {
  readonly statements: readonly SqlStatement[];
  readonly excepted: boolean;
}

// The suppressed copy's own ending, which it must have: every review document ends in exactly one
// terminal state, and "we did not look at this one" is not one of them.
//
// IT MIRRORS THE PRIMARY, because the two are the same bytes and any other answer would be the
// corpus saying two different things about one document. A copy of a document that was read points
// at the SAME text object — a derived key over the primary's identifier, so nothing is written twice
// and a reader following the pointer lands on the reading that was actually performed. A copy of a
// document that could not be read is excepted for the same named reason, on its own row, so it is
// counted for its own custodian in the exception report rather than vanishing behind the primary.
export function suppressedTerminalEffect(input: SuppressionInput): SuppressedTerminal {
  const { database, document, primary } = input;
  const now = input.now();
  if (primary.processing_state === "processed" && primary.text_r2_key === null) {
    // The primary is a CONTAINER: it processed, and what it produced was a family rather than text.
    // The copy mirrors that ending and points at the primary's entry listing. It does NOT become a
    // family parent — the children hang off the copy that was actually opened, and a second parent
    // with no children would be a family read that returns one row and means nothing.
    return {
      excepted: false,
      statements: [
        markReviewDocumentExpandedStatement(
          database,
          document.id,
          {
            metadataR2Key: primary.metadata_r2_key ?? "",
            formatIdentified: primary.format_identified ?? "unknown",
            extractionRoute: primary.extraction_route ?? "",
            childCount: 0,
          },
          now,
        ),
      ],
    };
  }
  if (primary.processing_state === "processed") {
    return {
      excepted: false,
      statements: [
        markReviewDocumentProcessedStatement(
          database,
          document.id,
          {
            // Both keys are the PRIMARY's. Deriving a second text object for identical bytes would
            // double the largest derived-storage line in the subsystem to hold a byte-identical copy.
            textR2Key: primary.text_r2_key ?? "",
            metadataR2Key: primary.metadata_r2_key ?? "",
            formatIdentified: primary.format_identified ?? "unknown",
            pageCount: primary.page_count,
            pagesRecognized: primary.pages_recognized ?? 0,
            extractionRoute: primary.extraction_route ?? "",
            textFingerprint: primary.text_fingerprint,
            sortDate: primary.sort_date,
            sortDateSource: primary.sort_date_source,
            contentMd5: primary.content_md5,
            contentSha1: primary.content_sha1,
          },
          now,
        ),
      ],
    };
  }
  return {
    excepted: true,
    statements: [
      markReviewDocumentExceptedStatement(database, document.id, primary.format_identified, now),
    ],
  };
}

// The occurrence row and the load's counter, written in the same batch as the terminal state so a
// suppressed copy can never be counted without being attributed or attributed without being counted.
export async function commitSuppression(input: {
  readonly database: BatchDatabase;
  readonly document: ReviewDocumentRow;
  readonly primary: DedupPrimaryRow;
  readonly terminal: SuppressedTerminal;
  // The inherited exception rows, when the primary is one nothing could read. Built by the caller,
  // which is where the exception vocabulary is joined to the extraction port's.
  readonly extraStatements: readonly SqlStatement[];
  readonly now: () => string;
}): Promise<void> {
  const { database, document, primary } = input;
  const now = input.now();
  const occurrenceId = await deriveIdentifier(
    "reviewDocumentOccurrence",
    // DERIVED from the copy alone, because a copy sits behind exactly one primary and the unique
    // index on the duplicate says so. A redelivery writes the same identifier and the insert
    // converges instead of stacking a second attribution for one document.
    `${document.review_set_id}:${document.id}`,
  );
  await commitEffectBatch(
    database,
    {
      statements: [
        ...input.terminal.statements,
        ...input.extraStatements,
        insertReviewDocumentOccurrenceStatement(
          database,
          {
            id: occurrenceId,
            reviewSetId: document.review_set_id,
            primaryReviewDocumentId: primary.id,
            duplicateReviewDocumentId: document.id,
            // The two facts deduplication would otherwise destroy.
            recordCustodianId: document.record_custodian_id,
            discoveryLoadId: document.discovery_load_id,
          },
          now,
        ),
        advanceProcessingCountsStatement(
          database,
          document.discovery_load_id,
          input.terminal.excepted ? { processed: 0, excepted: 1 } : { processed: 1, excepted: 0 },
          now,
        ),
      ],
      outboxMessages: [],
    },
    { now: input.now },
  );
}

async function commit(
  database: BatchDatabase,
  statements: readonly SqlStatement[],
  now: () => string,
): Promise<void> {
  await commitEffectBatch(database, { statements: [...statements], outboxMessages: [] }, { now });
}
