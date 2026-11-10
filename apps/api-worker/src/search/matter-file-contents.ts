import type { FirmId } from "@magna-carta/identifiers/types";
import type { MatterFileContentsSearcher } from "@magna-carta/matter-search/file-contents";
import { corpusOfMatter } from "@magna-carta/search/corpus";
import type { SearchIndexPort } from "@magna-carta/search/port";
import { readSearchIndexingEnabled } from "@magna-carta/search/settings";
import type { Logger } from "@magna-carta/telemetry/logger";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import type { Bindings } from "../bindings.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
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
  };
}
