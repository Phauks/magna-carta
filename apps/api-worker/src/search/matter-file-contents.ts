import { listQuotableIndexedVersions } from "@magna-carta/file-manager/queries";
import type { FileId, FirmId } from "@magna-carta/identifiers/types";
import type { MatterFileContentsSearcher } from "@magna-carta/matter-search/file-contents";
import { corpusOfMatter } from "@magna-carta/search/corpus";
import { keywordExcerpt } from "@magna-carta/search/keyword-excerpt";
import type { SearchIndexPort } from "@magna-carta/search/port";
import { readSearchIndexingEnabled } from "@magna-carta/search/settings";
import type { Logger } from "@magna-carta/telemetry/logger";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import type { Bindings } from "../bindings.ts";
import { resolveFirmBucketForFirmId } from "../files/firm-bucket.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import { readExtractedPassageFromBucket } from "./extracted-text-store.ts";
import { runKeywordSearch } from "./keyword-search.ts";
import { resolveSearchIndexPort } from "./search-engine.ts";

// How a matter's search reaches the index of the words inside its files: this matter's corpus and no
// other, through the same keyword search every file search goes through, so the catalog read and the
// firm scoping are the ones already there. A review set's corpus is never named here, which is what
// keeps material produced in discovery out of the ordinary matter search.
//
// FOUR DIFFERENT ANSWERS FOR "NOTHING CAME BACK", because a reader acts differently on each. The
// search service not being part of this deployment is "not connected", and trying again changes
// nothing. The service failing is "could not be searched just now". A firm that has not turned file
// indexing on is "not indexed", which somebody at the firm can change. Only an index that was asked
// and found nothing is "no matches".
//
// The order of the checks is the order of what they cost: the binding is a property read, the firm's
// setting is one row, and the search is a catalog read and a call to another service.
//
// THE SENTENCE A RESULT QUOTES is read here too, and from the firm's own storage, never from the
// index. The search has by then re-read the files the index named under the matter binding, and
// asks for quotes of the ones it is about to show. Each is checked once more where it is read: one
// statement answers which version of each file the index holds, and only for a file that is on
// this matter, is not deleted, and whose indexed version is still clean. Then the passage the index
// named is read from that version's kept text, by range, and the reader's words are found in it
// again. A file that fails any of that is not quoted, and its result still names its pages.
//
// A quote that cannot be read is never a failed search. Whatever goes wrong is reported once, with
// no word of the question or the document, and the files are answered for without it.
export function matterFileContentsSearcherFor(
  env: Bindings,
  firmId: FirmId,
  options: { readonly logger?: Logger; readonly port?: SearchIndexPort } = {},
): MatterFileContentsSearcher {
  const port =
    options.port ?? (env.SEARCH_SERVICE === undefined ? undefined : resolveSearchIndexPort(env));
  return {
    async query({ matterId, queryText, limit }) {
      if (port === undefined) return { kind: "not-connected" };
      const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
      if (!(await readSearchIndexingEnabled(database))) return { kind: "off" };
      const result = await runKeywordSearch(
        env,
        { firmId, corpus: corpusOfMatter(matterId), text: queryText, limit },
        port,
      );
      if (!result.ok) {
        // The reason and nothing else. The engine's own detail can repeat the question it was
        // asked, and what a member searched a client's files for is privileged.
        if (result.reason === "engine-not-implemented") return { kind: "not-connected" };
        if (options.logger !== undefined) {
          logOperationFailed(
            options.logger,
            "matterSearch.fileContents",
            new Error(`The file contents index did not answer: ${result.reason}`),
          );
        }
        return { kind: "unavailable" };
      }
      return {
        kind: "passages",
        passages: result.hits.map((hit) => ({ fileId: hit.documentId, chunkId: hit.chunkId })),
      };
    },
    async excerpts({ matterId, readerText, files }) {
      const excerpts = new Map<string, string>();
      try {
        const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
        const versions = await listQuotableIndexedVersions(
          database,
          matterId,
          files.map((file) => file.fileId as FileId),
        );
        if (versions.size === 0) return excerpts;
        const { bucket } = await resolveFirmBucketForFirmId(env, firmId);
        let malformed = 0;
        await Promise.all(
          files.map(async (file) => {
            const version = versions.get(file.fileId as FileId);
            if (version === undefined) return;
            const passage = await readExtractedPassageFromBucket(
              bucket,
              file.fileId as FileId,
              version,
              file.chunkId,
            );
            if (passage.kind === "malformed") malformed += 1;
            if (passage.kind !== "text") return;
            const excerpt = keywordExcerpt(passage.text, readerText);
            if (excerpt !== null) excerpts.set(file.fileId, excerpt);
          }),
        );
        if (malformed > 0 && options.logger !== undefined) {
          logOperationFailed(
            options.logger,
            "matterSearch.fileContents.excerpt",
            new Error(`Kept text that is not in the kept text format: ${malformed} object(s)`),
          );
        }
      } catch (caught) {
        if (options.logger !== undefined) {
          // The fault's kind and nothing it says: a storage error can repeat a key, and a key names
          // a client's file.
          logOperationFailed(
            options.logger,
            "matterSearch.fileContents.excerpt",
            new Error(
              `A file result could not be quoted: ${caught instanceof Error ? caught.name : "fault"}`,
            ),
          );
        }
      }
      return excerpts;
    },
  };
}
