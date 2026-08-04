import { loadIndexableVersion } from "@magna-carta/file-manager/queries";
import type { FileVersionId } from "@magna-carta/identifiers/types";
import { readSearchIndexingEnabled } from "@magna-carta/search/settings";
import type { Bindings } from "../app.ts";
import { firmDatabaseFor, type ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import { searchIndexJobName, type SearchIndexMessage } from "./index-types.ts";

// The seam where a document enters the search corpus: a version that has just committed clean.
//
// WHY HERE. Ingest commit is the first and only moment a version is simultaneously (a) durable, (b)
// scanned and cleared, and (c) pointed at by its file as current. Enqueuing earlier would index bytes
// that might still be quarantined; enqueuing later — from the OCR or conversion paths — would only ever
// catch the documents that happened to pass through those tools, so a plain uploaded PDF would never be
// searchable. Text extraction is the consumer's job, not the trigger's, precisely so that the trigger
// stays "a document became part of the matter" rather than "a document happened to get recognized".
//
// It is deliberately BEST-EFFORT. This runs after the commit has already been recorded, and a failure
// to enqueue must never fail or retry the ingest that already succeeded — re-running ingest would mean
// re-scanning and re-committing a version that is already committed. The cost of that choice is that a
// failure here leaves a document unindexed until something re-enqueues it; the deferred/replay path the
// consumer is built around is the same mechanism that repairs it.
export async function enqueueVersionForIndexing(
  env: Bindings,
  firmId: string,
  versionId: FileVersionId,
  database: ProxyBatchDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId),
): Promise<SearchIndexMessage | undefined> {
  // The firm-level gate, read before any work: a firm that has not turned indexing on never produces a
  // message, so its documents are never extracted, never built into splits, and never written to R2.
  if (!(await readSearchIndexingEnabled(database))) return undefined;

  const version = await loadIndexableVersion(database, versionId);
  // Not clean, or its file is gone — nothing to index. Not an error: the version simply is not part of
  // the searchable corpus.
  if (version === undefined) return undefined;

  const message: SearchIndexMessage = {
    firmId,
    matterId: version.matterId,
    documentId: version.fileId,
    version: version.versionNumber,
    sourceKey: version.r2Key,
    contentType: version.contentType,
  };
  // Through the coordinator, not straight onto the queue: the Durable Object is what makes a duplicate
  // enqueue for the same document version a no-op instead of a second build, and it is where the job's
  // outcome — including a deferred one — is recorded.
  const coordinator = env.SEARCH_INDEX_JOB.get(
    env.SEARCH_INDEX_JOB.idFromName(
      searchIndexJobName(firmId, version.fileId, version.versionNumber),
    ),
  );
  await coordinator.start(message);
  return message;
}
