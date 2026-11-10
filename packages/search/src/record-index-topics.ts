// The per-firm outbox topic a rebuild of the record index is asked for on.
//
// A REBUILD IS QUEUE-DISPATCHED, because it is work in proportion to what a firm holds: it counts
// every indexed record to find the places that have fallen behind, then empties and derives each of
// those again. The request that asks for it writes this message in the same atomic batch as its
// audit row, so a rebuild that was asked for is one that will run, and a request that rolled back
// asked for nothing.
//
// It travels on the shared per-firm job queue for the reason the natural-language lifecycle topics
// do (natural-language-topics.ts): a rare, small message, on a lane that already carries the relay,
// the dispatch table and the dead-letter discipline.
//
// THE PAYLOAD IS EMPTY, on purpose. The message does not say which places to rebuild: the consumer
// counts again when it runs and rebuilds the places that are behind at that moment. A list carried
// from the request would be a statement about the past by the time it arrived, and a redelivered
// message with one would rebuild a place a first delivery had already put right.
export const RECORD_INDEX_REBUILD_REQUESTED_TOPIC = "recordIndex.rebuildRequested";

export type RecordIndexRebuildRequestedPayload = Record<string, never>;
