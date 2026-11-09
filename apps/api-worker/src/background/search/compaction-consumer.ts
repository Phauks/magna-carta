import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  countLiveSplitsForCorpus,
  countStaleMembersForCorpus,
  listCompactionInputSplits,
  listLiveMembersForSplit,
  listStaleMembersForCorpus,
  publishCompactedSplitStatements,
  type IndexedDocumentId,
  type IndexSplitMemberRow,
  type IndexSplitRow,
} from "@magna-carta/data-access/index-split-statements";
import type { FirmId, IndexSplitId, MatterId, ReviewSetId } from "@magna-carta/identifiers/types";
import { corpusOfMatter, corpusOfReviewSet, type CorpusScope } from "@magna-carta/search/corpus";
import type { SearchIndexPort, SplitQueryTarget } from "@magna-carta/search/port";
import {
  readSearchCompactionPolicy,
  type SearchCompactionPolicy,
} from "@magna-carta/search/settings";
import { splitIdentifierForCompaction, splitObjectKey } from "@magna-carta/search/split";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../../bindings.ts";
import { firmDatabaseFor } from "../../firm-database/firm-database-proxy.ts";
import {
  compactionMessageCorpus,
  searchCompactionJobName,
  type SearchCompactionMessage,
} from "../../search/compaction-types.ts";
import { resolveSearchIndexPort } from "../../search/search-engine.ts";

// The compaction pass: many of a corpus's small splits in, one merged split out, and a catalog that moves
// between the two in a single step.
//
// THE ORDER IS THE CORRECTNESS ARGUMENT, and it runs in one direction only:
//
//   1. Select the sources from the catalog — live splits, oldest first, bounded by count and by bytes.
//   2. Read their stale members. Those are the document versions a re-index superseded since the source
//      was published, and they are handed to the merge so their postings leave the published bytes.
//   3. Merge through the engine and write the result to R2, at a key DERIVED from the corpus and the
//      sorted source ids — so a pass that dies here and retries overwrites its own object rather than
//      leaving bytes nothing references.
//   4. ONE atomic batch: insert the merged row, insert its membership, mark every source superseded.
//   5. Nothing. The source objects stay where they are.
//
// Step 5 is not an omission. A query resolves its split keys from the catalog and then reads those
// objects, so a pass that deleted a source it had just superseded could hand a live query a key to bytes
// that no longer exist. Retirement is a separate sweep with a grace period longer than any query can
// live (compaction-sweep.ts). Given that, step 4 is the only moment the corpus changes shape: a query
// that resolved before it holds source keys whose objects still exist, and one that resolved after holds
// the merged key and none of the sources. Neither sees both, and neither sees neither.

const now = () => new Date().toISOString();

function coordinatorFor(env: Bindings, message: SearchCompactionMessage) {
  return env.SEARCH_COMPACTION_JOB.get(
    env.SEARCH_COMPACTION_JOB.idFromName(
      searchCompactionJobName(message.firmId, compactionMessageCorpus(message).id),
    ),
  );
}

// The message's corpus as the typed scope the port and the key derivation take.
function corpusFor(message: SearchCompactionMessage): CorpusScope {
  const scope = compactionMessageCorpus(message);
  return scope.kind === "reviewSet"
    ? corpusOfReviewSet(scope.id as ReviewSetId)
    : corpusOfMatter(scope.id as MatterId);
}

// Whether a corpus is over either threshold. Read in one place so the write-path trigger, the daily
// backstop, and the pass's own re-enqueue decision can never disagree about what "needs compacting" is.
export async function corpusNeedsCompaction(
  database: Parameters<typeof countLiveSplitsForCorpus>[0],
  corpusId: string,
  policy: SearchCompactionPolicy,
): Promise<boolean> {
  const liveSplits = await countLiveSplitsForCorpus(database, corpusId);
  if (liveSplits >= policy.splitThreshold) return true;
  // A corpus can need compacting without gaining a split: a heavily-revised matter accumulates superseded
  // versions inside its merged splits, which cost storage and an exclusion clause on every query.
  const staleMembers = await countStaleMembersForCorpus(database, corpusId);
  return staleMembers >= policy.staleThreshold;
}

// Group the corpus's stale members by the split that holds them, so each source can be merged with its
// own delete set. A map rather than a per-split query: one read for the whole corpus, and the pass is
// about to touch every split in it anyway.
function exclusionsBySplit(
  stale: readonly { readonly splitId: IndexSplitId; readonly documentId: IndexedDocumentId }[],
): Map<IndexSplitId, IndexedDocumentId[]> {
  const grouped = new Map<IndexSplitId, IndexedDocumentId[]>();
  for (const member of stale) {
    const existing = grouped.get(member.splitId);
    if (existing === undefined) grouped.set(member.splitId, [member.documentId]);
    else existing.push(member.documentId);
  }
  return grouped;
}

// The membership of the merged split: every document version its sources carried, minus the ones the
// merge dropped. A per-document source contributes its own document/version columns; a merged source
// contributes its own membership rows, which is why a chain of compactions does not lose track of what is
// inside the result.
function mergedMembership(
  mergedSplitId: IndexSplitId,
  sources: readonly IndexSplitRow[],
  sourceMembership: ReadonlyMap<IndexSplitId, readonly IndexSplitMemberRow[]>,
  dropped: ReadonlySet<IndexedDocumentId>,
): IndexSplitMemberRow[] {
  const members = new Map<string, IndexSplitMemberRow>();
  const add = (documentId: IndexedDocumentId, version: number) => {
    if (dropped.has(documentId)) return;
    members.set(`${documentId}:${version}`, { splitId: mergedSplitId, documentId, version });
  };
  for (const source of sources) {
    if (source.documentId !== null && source.version !== null) {
      add(source.documentId, source.version);
      continue;
    }
    for (const member of sourceMembership.get(source.id) ?? []) {
      add(member.documentId, member.version);
    }
  }
  return [...members.values()];
}

export async function compactOne(
  env: Bindings,
  message: SearchCompactionMessage,
  port: SearchIndexPort = resolveSearchIndexPort(env),
): Promise<void> {
  const coordinator = coordinatorFor(env, message);
  await coordinator.markRunning();

  const firmId = message.firmId as FirmId;
  const matterId = message.matterId as MatterId;
  const corpus = corpusFor(message);
  const database = firmDatabaseFor(env.FIRM_DATABASE, message.firmId);
  const policy = await readSearchCompactionPolicy(database);

  const sources = await listCompactionInputSplits(
    database,
    corpus.id,
    policy.maximumInputSplits,
    policy.maximumInputBytes,
  );
  // Merging one split is not always a no-op — it repacks whatever a re-index superseded inside it — but
  // merging one split that has nothing superseded is, and so is merging none. Skipping is a real outcome
  // and is recorded as one: a burst of ingests routinely enqueues several passes for a corpus that only
  // needs the first.
  const stale = await listStaleMembersForCorpus(database, corpus.id);
  const grouped = exclusionsBySplit(stale);
  const hasWorkToDo = sources.length > 1 || (sources.length === 1 && grouped.size > 0);
  if (!hasWorkToDo) {
    await coordinator.markSkipped(
      sources.length === 0
        ? "the corpus holds no live splits"
        : "one live split with nothing superseded inside it",
    );
    return;
  }

  const sourceIds = sources.map((split) => split.id);
  const mergedSplitId = await splitIdentifierForCompaction(corpus, sourceIds);
  const objectKey = splitObjectKey(corpus, mergedSplitId);
  const targets: SplitQueryTarget[] = sources.map((split) => ({
    objectKey: split.objectKey,
    excludeDocumentIds: grouped.get(split.id) ?? [],
  }));

  const merged = await port.compact({ firmId, corpus, sources: targets, objectKey });
  if (!merged.ok) {
    if (merged.reason === "engine-not-implemented") {
      // Parked, not lost. The corpus stays over threshold, so the daily backstop re-enqueues it once the
      // engine is deployed; retrying now would burn the message's attempts against an engine that does
      // not exist and dead-letter housekeeping the platform still owes.
      await coordinator.markDeferred("search index engine not deployed");
      return;
    }
    throw new Error(`compaction merge failed: ${merged.detail ?? "adapter error"}`);
  }

  // The membership of every merged source, so the result inherits what its inputs carried. Only merged
  // sources have any — a per-document split's coverage is its own columns — and only the LIVE members
  // carry forward, because the stale ones are exactly what the merge just deleted.
  const sourceMembership = new Map<IndexSplitId, IndexSplitMemberRow[]>();
  for (const source of sources) {
    if (source.documentId !== null) continue;
    sourceMembership.set(source.id, await listLiveMembersForSplit(database, source.id));
  }
  const dropped = new Set<IndexedDocumentId>(merged.published.excludedDocumentIds);
  const members = mergedMembership(mergedSplitId, sources, sourceMembership, dropped);

  const supersededAt = now();
  await commitEffectBatch(
    database,
    {
      statements: publishCompactedSplitStatements(database, {
        split: {
          id: mergedSplitId,
          matterId,
          corpusKind: corpus.kind,
          corpusId: corpus.id,
          // A merged split covers many document versions, so it claims none on its own row — the
          // membership rows are its coverage, and leaving these null is what keeps it outside the
          // one-live-split-per-document-version unique index the write pipeline relies on.
          documentId: null,
          version: null,
          objectKey,
          documentCount: merged.published.documentCount,
          sizeBytes: merged.published.sizeBytes,
          schemaGeneration: merged.published.schemaGeneration,
          createdAt: supersededAt,
        },
        members,
        supersededSplitIds: sourceIds,
        supersededAt,
      }),
      outboxMessages: [],
    },
    { now },
  );

  await coordinator.markCompacted(objectKey, sources.length);

  // A bounded pass over an unbounded corpus converges by running again. Asking here rather than waiting
  // for the daily backstop is what stops a matter that ingested ten thousand documents from sitting at
  // ten thousand splits until tomorrow.
  if (await corpusNeedsCompaction(database, corpus.id, policy)) {
    await coordinator.start(message);
  }
}

// The queue() handler: one message at a time, ack on every terminal outcome, retry on a transient throw.
// Per-message ack so one corpus's failure never re-runs another's completed merge.
export async function searchCompactionQueue(
  batch: MessageBatch<SearchCompactionMessage>,
  env: Bindings,
  port: SearchIndexPort = resolveSearchIndexPort(env),
): Promise<void> {
  const logger = createWorkersLogger(env.TELEMETRY);
  for (const message of batch.messages) {
    const correlationId = newCorrelationId();
    try {
      await compactOne(env, message.body, port);
      message.ack();
    } catch (error) {
      logOperationFailed(logger, `queue:search-compaction:${message.id}`, error, correlationId);
      await coordinatorFor(env, message.body).markFailed(
        error instanceof Error ? error.message : "compaction error",
      );
      message.retry();
    }
  }
}
