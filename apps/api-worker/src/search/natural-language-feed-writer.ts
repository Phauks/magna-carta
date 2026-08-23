import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { FileId, MatterId } from "@magna-carta/identifiers/types";
import {
  naturalLanguageFeedDocument,
  naturalLanguageFeedObjectDimensions,
  naturalLanguageFeedObjectKey,
  NATURAL_LANGUAGE_FEED_EMITTED_OBJECT_CLASSES,
} from "@magna-carta/search/natural-language-feed";
import { mayFeedMatter } from "@magna-carta/search/natural-language-enablement";
import type { Passage } from "@magna-carta/search/port";
import {
  recordFeedObjectStatement,
  usageMeterCommitStatements,
} from "@magna-carta/search/natural-language-statements";
import type { ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";

// THE FEED WRITER. A second consumer of the extraction the search index job has ALREADY performed —
// not a second extraction, and not a second pipeline.
//
// That is the whole reason this function takes `passages` rather than bytes. The index job reads the
// version's object once, hands it to the extraction port once, and the result feeds both consumers:
// the keyword split and this. Re-extracting would be a second parse of the same untrusted document
// for a derived copy, and — worse than the cost — it would let the two copies disagree about what
// the document says, with nothing comparing them.
//
// IT IS THE ONLY WAY ANYTHING REACHES THE MANAGED INDEX, which is what makes the exclusions
// structural. Discovery review-set originals, conversions, bundles, splits, captured email
// originals, mid-edit working copies, and assistant transcripts are all absent from that index for
// the same reason: nothing produces a feed object for them, and there is no other door. A fitness
// test asserts this writer emits exactly one object class and cannot emit a reserved one.
//
// It is BEST-EFFORT with respect to the index job. A feed write that fails must not fail the job
// that has already published a searchable split — the caller swallows and logs, the same way the
// compaction trigger beside it does, and the daily re-extraction pass re-enqueues the version.

// The bytes-per-token ratio the ingestion estimate is computed at, and the fact that it IS an
// estimate is the point. The managed service returns no ingestion token count to a writer, so this
// number is derived rather than observed; it is recorded on every metered row so a later correction
// can be applied to historical rows instead of guessing what they assumed. Four bytes per token is
// the ordinary rule of thumb for English prose and is stated here as a rule of thumb.
export const ESTIMATED_INGESTION_BYTES_PER_TOKEN = 4;

// The civil day (UTC) a meter row buckets under.
function civilDay(instant: string): string {
  return instant.slice(0, 10);
}

export interface FeedWriteInput {
  readonly matterId: MatterId;
  readonly documentId: FileId;
  readonly version: number;
  /** The extraction the index job already computed for this same version. */
  readonly passages: readonly Passage[];
}

export type FeedWriteOutcome =
  // A feed object exists for this version and the catalog names it.
  | { readonly kind: "fed"; readonly objectKey: string; readonly byteCount: number }
  // One of the two gates is shut. Not a failure: the firm has not opted in, or the matter is
  // excluded, and in both cases writing nothing is the correct behaviour.
  | { readonly kind: "gate-closed" }
  // The extraction produced nothing worth feeding. An empty object in the index is a document that
  // can be returned as a hit with no text behind it, which is worse than an absent one.
  | { readonly kind: "nothing-to-feed" };

// Write one version's feed object, if both gates allow it.
//
// BOTH GATES ARE READ HERE, at the moment of writing, and not inherited from whatever decided to
// enqueue the index job. The firm gate means a firm that has not opted in never produces a feed
// object as a side effect of the platform being ready; the matter flag means a matter excluded five
// minutes ago stops producing them now rather than at the next deploy.
//
// The object and the catalog row are written OBJECT FIRST. A crash between the two leaves an object
// with no live row, which reconciliation reports and which the deletion pass can then remove; the
// other order would leave a row promising bytes that are not there, and a freshness count that
// includes a document the index will never see.
export async function writeNaturalLanguageFeedObject(
  database: ProxyBatchDatabase,
  bucket: R2Bucket,
  input: FeedWriteInput,
  now: () => string,
): Promise<FeedWriteOutcome> {
  if (!(await mayFeedMatter(database, input.matterId))) {
    return { kind: "gate-closed" };
  }

  const body = naturalLanguageFeedDocument(input.passages);
  if (body.trim().length === 0) return { kind: "nothing-to-feed" };
  const bytes = new TextEncoder().encode(body);

  const objectKey = naturalLanguageFeedObjectKey(input.matterId, input.documentId, input.version);
  // The matter is COPIED from the authoritative version's own stamp by the caller and passed through
  // here — never re-derived from the database by this writer. One home per fact: the feed object and
  // its source cannot disagree about which matter they belong to, and if they ever did, the
  // disagreement is detectable by comparison rather than invisible.
  //
  // The stamp is built above the call rather than inline in the options object on purpose: the
  // object-dimension scan in apps/api-worker/test reads a bounded window after each `.put(`, and a
  // comment sitting between the call and its `customMetadata` pushes the stamp out of that window —
  // so a correctly stamped write reads to the scan as an unstamped one.
  const dimensions = naturalLanguageFeedObjectDimensions(input.matterId);
  await bucket.put(objectKey, bytes, {
    customMetadata: dimensions,
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
  });

  const fedAt = now();
  await commitEffectBatch(
    database,
    {
      statements: [
        recordFeedObjectStatement(database, {
          fileId: input.documentId,
          version: input.version,
          matterId: input.matterId,
          objectKey,
          byteCount: bytes.byteLength,
          fedAt,
        }),
        // The meter rides the SAME atomic batch as the catalog row it counts, so a redelivery that
        // rolls the row back rolls the meter back with it. Fed bytes are authoritative — they are
        // the bytes this function just wrote. The ingestion-token figure beside them is an estimate
        // and lives in its own columns so the usage feed can render the two differently.
        ...usageMeterCommitStatements(database, {
          day: civilDay(fedAt),
          fedBytes: bytes.byteLength,
          estimatedIngestionTokens: Math.ceil(
            bytes.byteLength / ESTIMATED_INGESTION_BYTES_PER_TOKEN,
          ),
          estimatedIngestionBytesPerToken: ESTIMATED_INGESTION_BYTES_PER_TOKEN,
        }),
      ],
      outboxMessages: [],
    },
    { now },
  );

  return { kind: "fed", objectKey, byteCount: bytes.byteLength };
}

// The enumeration the fitness test reads: every object class this module is capable of producing.
// Exactly one member, and it is re-exported here rather than restated so the test measures the
// writer's own vocabulary and not a copy of it.
export const FEED_WRITER_OBJECT_CLASSES = NATURAL_LANGUAGE_FEED_EMITTED_OBJECT_CLASSES;
