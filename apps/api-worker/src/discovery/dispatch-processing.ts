import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { readDispatchableDocuments } from "@magna-carta/discovery/processing-statements";
import type { DiscoveryLoadId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../bindings.ts";
import type { DiscoveryLoadCoordinator } from "./discovery-load-coordinator.ts";
import type {
  DiscoveryDispatchResult,
  DiscoveryProcessMessage,
} from "./discovery-process-types.ts";

// One turn of a load's PROCESSING fan-out: walk the documents that still need reading and put one
// message per document on the discovery lane.
//
// FROM A COORDINATOR, NOT FROM A REQUEST, and the difference is not style. A load at the ceiling is a
// quarter of a million documents; enqueuing that from an HTTP handler is not a fan-out, it is a
// timeout. The walk is keyset-paged and its cursor lives in the coordinator's durable storage, so an
// eviction, a deploy, or a hibernation costs a repeated page and never a skipped document.
//
// IT IS SAFE TO RUN TWICE. The walk selects only documents still `pending`, so a turn that enqueued a
// page and died before checkpointing re-enqueues that page — and the consumer converges, because its
// claim is guarded by the row's state and every key it writes is derived. A duplicate message costs a
// read; a skipped document costs a corpus nobody can certify.

// How many documents one page of the walk reads and enqueues. Bounded by the queue's own batch
// arithmetic rather than by taste: a Worker invocation may make 1,000 queries, and `sendBatch` takes
// at most 100 messages, so a page is one read plus one send and there is headroom for the checkpoint
// under both walls.
export const DISPATCH_PAGE_SIZE = 100;

// How many pages one turn walks before returning to its caller. Bounded so a turn ends well inside
// the invocation's wall clock with the cursor checkpointed, and the next turn picks up from there.
// The same shape, and the same reason, as the allocation walk's own per-turn ceiling.
const MAXIMUM_PAGES_PER_TURN = 10;

export interface DispatchOptions {
  readonly database: BatchDatabase;
  readonly coordinator: DurableObjectStub<DiscoveryLoadCoordinator>;
  readonly queue: Queue<DiscoveryProcessMessage>;
  readonly firmId: string;
  readonly bucketName: string;
  readonly matterId: string;
  readonly reviewSetId: string;
  readonly loadId: string;
  readonly engineGeneration: string;
}

export async function runProcessingDispatchTurn(
  options: DispatchOptions,
): Promise<DiscoveryDispatchResult> {
  const state = await options.coordinator.status();
  let cursor = state.dispatchCursor;
  let dispatched = 0;

  for (let page = 0; page < MAXIMUM_PAGES_PER_TURN; page++) {
    const documents = await readDispatchableDocuments(
      options.database,
      options.loadId as DiscoveryLoadId,
      cursor,
      DISPATCH_PAGE_SIZE,
    );
    if (documents.length === 0) {
      await options.coordinator.markDispatched();
      return { dispatched, cursor, complete: true };
    }

    const messages = documents
      // A document whose source object cannot be named is not dispatchable: there is nothing to point
      // the consumer at. It stays `pending` and the load's reconciliation refuses to complete over
      // it, which is louder than a message that would only fail on the other side.
      .filter((document) => document.sourceKey !== null && document.sourceKey !== "")
      .map((document) => ({
        body: {
          firmId: options.firmId,
          bucketName: options.bucketName,
          matterId: options.matterId,
          reviewSetId: options.reviewSetId,
          loadId: options.loadId,
          reviewDocumentId: document.id,
          sourceKey: document.sourceKey,
          contentType: document.contentType,
          sourceStatus: document.sourceStatus,
          emailDedupKey: document.emailDedupKey,
          engineGeneration: options.engineGeneration,
        } satisfies DiscoveryProcessMessage,
      }));
    if (messages.length > 0) await options.queue.sendBatch(messages);
    dispatched += messages.length;

    // The cursor advances to the last row the PAGE saw, including a row that produced no message —
    // otherwise a page of undispatchable documents would be re-read forever and the walk would never
    // reach the ones behind it. The page is non-empty here (the empty case returned above), so the
    // last row exists; the fallback keeps the cursor rather than inventing one.
    const pageEnd = documents[documents.length - 1]?.id;
    if (pageEnd !== undefined) {
      cursor = pageEnd;
      // Checkpointed AFTER the send, once per page. Before it, the cursor would move past documents
      // nothing was ever asked to read.
      await options.coordinator.checkpointDispatch(pageEnd);
    }

    // A short page is the end of the walk: the read asked for a full page and the table had fewer.
    if (documents.length < DISPATCH_PAGE_SIZE) {
      await options.coordinator.markDispatched();
      return { dispatched, cursor, complete: true };
    }
  }
  return { dispatched, cursor, complete: false };
}

export function discoveryEngineGeneration(env: Bindings): string {
  // Which extraction engines are bound, as a stable string. A deploy that binds an engine that was
  // missing changes this, which is how a document parked against the old pipeline is told from one
  // parked against the current one.
  return [
    env.DISCOVERY_SERVICE === undefined ? "" : "discovery",
    env.OCR_SERVICE === undefined ? "" : "recognition",
    env.CONVERT === undefined ? "" : "conversion",
  ]
    .filter((name) => name !== "")
    .join("+");
}
