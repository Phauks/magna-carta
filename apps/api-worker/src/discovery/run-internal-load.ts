import {
  commitEffectBatch,
  type BatchDatabase,
  guarded,
} from "@magna-carta/data-access/effect-batch";
import {
  allocationChunkEffect,
  chunkAllocations,
  planEmailAllocations,
  planFileAllocations,
  type AllocationContext,
} from "@magna-carta/discovery/allocation";
import {
  assertSelectionMatchesMatter,
  assertVersionsAreClean,
  resolveEmailAttachments,
  resolveEmailSelection,
  resolveFileSelection,
} from "@magna-carta/discovery/internal-lane";
import {
  readDiscoveryLoad,
  transitionDiscoveryLoadStatement,
} from "@magna-carta/discovery/load-statements";
import type { ReviewDocumentAllocation } from "@magna-carta/discovery/review-document-statements";
import type {
  DiscoveryLoadId,
  EmailMessageId,
  FileId,
  MatterId,
  RecordCustodianId,
  ReviewSetId,
} from "@magna-carta/identifiers/types";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { DiscoveryLoadCoordinator } from "./discovery-load-coordinator.ts";
import type { DiscoveryLoadPlanMessage } from "./discovery-load-types.ts";

// One turn of an internal load's fan-out, driven by the coordinator's cursor.
//
// The division of labour is the point: the Durable Object holds the cursor and nothing else, and this
// module does the database work through the firm-scoped data-access layer. A Durable Object that
// wrote the firm's rows would be a second write path with its own idea of what a chunk is; a fan-out
// with no Durable Object would have no place to survive an eviction.
//
// The plan is RE-DERIVED on every turn rather than stored. The selection is a list of handles and the
// resolution is deterministic, so a turn resumed after a deploy plans the same rows in the same
// order — and because the identifiers are freshly minted, the insert converging on what is already
// there is what keeps a repeat from becoming a duplicate.

export interface InternalLoadTurnResult {
  readonly plannedCount: number;
  readonly allocatedCount: number;
  readonly cursor: number;
  readonly complete: boolean;
}

// How many chunks one turn commits before returning. Bounded so a turn ends well inside the
// invocation's wall clock with the cursor checkpointed, and the next turn picks up from there.
const MAX_CHUNKS_PER_TURN = 10;

export async function runInternalLoadTurn(options: {
  readonly database: BatchDatabase;
  readonly coordinator: DurableObjectStub<DiscoveryLoadCoordinator>;
  readonly message: DiscoveryLoadPlanMessage;
  readonly now: () => string;
  readonly randomSource?: RandomSource;
}): Promise<InternalLoadTurnResult> {
  const { database, coordinator, message } = options;
  const context: AllocationContext = {
    reviewSetId: message.reviewSetId as ReviewSetId,
    discoveryLoadId: message.loadId as DiscoveryLoadId,
    recordCustodianId: message.recordCustodianId as RecordCustodianId,
    randomSource: options.randomSource,
  };

  const allocations = await planAllocations(database, message, context);
  await coordinator.setPlannedCount(allocations.length);

  const state = await coordinator.status();
  // Resume from the durable cursor, never from zero and never from a number this process remembered.
  let cursor = Math.min(state.cursor, allocations.length);
  let allocatedCount = state.allocatedCount;

  const chunks = chunkAllocations(allocations.slice(cursor));
  const now = options.now();
  for (const chunk of chunks.slice(0, MAX_CHUNKS_PER_TURN)) {
    await commitEffectBatch(
      database,
      allocationChunkEffect(database, chunk, {
        reviewSetId: context.reviewSetId,
        discoveryLoadId: context.discoveryLoadId,
        now,
      }),
      { now: options.now },
    );
    cursor += chunk.length;
    allocatedCount += chunk.length;
    // Checkpointed AFTER the commit, once per chunk. A checkpoint before the commit would advance
    // past rows that never landed; one per row would make the coordinator the bottleneck chunking
    // exists to remove.
    await coordinator.checkpoint({ cursor, allocatedCount });
  }

  const complete = cursor >= allocations.length;
  if (complete) {
    await coordinator.markAllocated(allocatedCount);
    // The load moves on to processing only once every row it will ever hold is committed. A load
    // that advanced mid-fan-out would report a count nobody could reconcile against.
    //
    // THE TRANSITION IS ASKED FOR ONLY WHILE THERE IS ONE TO MAKE, which is what lets a re-run of
    // the same selection converge instead of being refused. A retried run re-derives the same plan,
    // finds the cursor already at its end, writes no rows — and used to arrive here anyway and
    // attempt `loading -> processing` a second time. The guard is doing its job when it refuses
    // that, because the load is already `processing`; the fault is asking. The refusal surfaced as
    // a 409 on the one path the whole cursor design exists to make safe to repeat.
    //
    // The read is on the completion path only, and only where the alternative is a wrong answer.
    // The guard stays on the statement: a load that is neither `loading` nor already past it has
    // had something happen to it that this turn must not paper over.
    const load = await readDiscoveryLoad(database, context.discoveryLoadId);
    if (load?.state === "loading") {
      await commitEffectBatch(
        database,
        {
          statements: [
            guarded(
              transitionDiscoveryLoadStatement(
                database,
                context.discoveryLoadId,
                "loading",
                "processing",
                now,
              ),
              "discovery-load.transition",
            ),
          ],
          outboxMessages: [],
        },
        { now: options.now },
      );
    }
  }
  return { plannedCount: allocations.length, allocatedCount, cursor, complete };
}

async function planAllocations(
  database: BatchDatabase,
  message: DiscoveryLoadPlanMessage,
  context: AllocationContext,
): Promise<ReviewDocumentAllocation[]> {
  if (message.lane === "internal-files") {
    const versions = await resolveFileSelection(database, message.fileIds as FileId[]);
    // Refused by NAME rather than skipped. A firm that selected fifty files and silently got
    // forty-eight review documents has a corpus it cannot certify the contents of.
    assertSelectionMatchesMatter(versions, message.matterId as MatterId);
    assertVersionsAreClean(versions);
    return planFileAllocations(versions, context);
  }
  const messages = await resolveEmailSelection(
    database,
    message.matterId as MatterId,
    message.emailMessageIds as EmailMessageId[],
  );
  const attachments = await resolveEmailAttachments(
    database,
    messages.map((resolved) => resolved.emailMessageId),
  );
  // An attachment whose version is not clean does not enter the corpus, and its absence is not
  // silent: the refusal names it, exactly as the file lane's does.
  assertVersionsAreClean(
    attachments.map((attachment) => ({
      fileId: attachment.fileId,
      fileVersionId: attachment.fileVersionId,
      matterId: message.matterId as MatterId,
      name: attachment.filename ?? "",
      sizeBytes: attachment.sizeBytes,
      contentSha256: attachment.contentSha256,
      status: attachment.status,
    })),
  );
  return planEmailAllocations(messages, attachments, context);
}
