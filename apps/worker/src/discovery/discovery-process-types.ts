// The processing lane's message and the vocabulary both sides read. One home so the dispatch walk and
// the consumer cannot drift on a field name (the index-types.ts and discovery-load-types.ts precedent).

// A MESSAGE CARRIES POINTERS, NEVER CONTENT. Identifiers and R2 keys only: no bytes, no extracted
// text, no file name a person wrote a client's name into. The queue's 128 KB ceiling is generous for
// that and absurd for content, and a message body is the one place in this pipeline where privileged
// material would travel with no access check in front of it.
export interface DiscoveryProcessMessage {
  readonly firmId: string;
  // The firm's bucket, resolved once at dispatch through the one home for that decision, so the
  // consumer reads and writes the same namespace the load wrote into.
  readonly bucketName: string;
  // The matter the review set is on — carried because every object written into a firm's bucket
  // carries its dimensions, and a review document's derived objects are matter-rooted through the
  // review set they belong to.
  readonly matterId: string;
  readonly reviewSetId: string;
  readonly loadId: string;
  readonly reviewDocumentId: string;
  // The R2 key of the bytes to read — the pinned file version's object, or the verbatim original of an
  // email message. Resolved at dispatch and carried, rather than looked up again in the consumer, for
  // the reason the index lane pins its own source key: the document under review is the one that was
  // loaded, and a re-resolution could find a newer version the corpus never included.
  readonly sourceKey: string;
  readonly contentType: string | null;
  // The scan gate's recorded verdict on those bytes. Carried so the consumer can refuse to open a
  // quarantined document without reading it — a flagged file in discovery is evidence, so it stays in
  // the corpus, appears in the report, and is never handed to a parser.
  readonly sourceStatus: string;
  // Which extraction engines were bound when this message was made. Carried so a document parked
  // because an engine was missing can be told from one parked by a pipeline that has not changed —
  // the difference between a wasted re-attempt and a backlog draining after a deploy.
  readonly engineGeneration: string;
}

// What one dispatch turn did. `dispatched` is how many messages this turn put on the queue and
// `cursor` is where the next turn resumes; `complete` is the only fact the caller acts on, and it is
// deliberately computed from the walk rather than from a count, because a count that disagreed with
// the walk would leave documents nobody ever processes.
export interface DiscoveryDispatchResult {
  readonly dispatched: number;
  readonly cursor: string | null;
  readonly complete: boolean;
}
