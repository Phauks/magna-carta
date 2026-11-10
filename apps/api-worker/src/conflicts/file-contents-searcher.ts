import type { FileContentsSearcher } from "@magna-carta/conflicts/file-search";
import type { FirmId, MatterId } from "@magna-carta/identifiers/types";
import { corpusOfMatter } from "@magna-carta/search/corpus";
import type { SearchIndexPort } from "@magna-carta/search/port";
import type { Bindings } from "../bindings.ts";
import { runKeywordSearch } from "../search/keyword-search.ts";
import { resolveSearchIndexPort } from "../search/search-engine.ts";

// How a conflicts check reaches the file contents index: one matter's corpus at a time, through the
// same keyword search the rest of the product uses, so the catalog read and the firm scoping are the
// ones every file search already goes through. A review set's corpus is never named here, which is
// what keeps material produced in discovery out of a conflicts check.
//
// Undefined while the search service is not bound: the check then records Files as not searched,
// without spending a catalog read per matter to learn what the binding already says.
export function fileContentsSearcherFor(
  env: Bindings,
  firmId: FirmId,
  port: SearchIndexPort | undefined = env.SEARCH_SERVICE === undefined
    ? undefined
    : resolveSearchIndexPort(env),
): FileContentsSearcher | undefined {
  if (port === undefined) return undefined;
  return {
    async query({ matterId, phrases, limit }) {
      const result = await runKeywordSearch(
        env,
        {
          firmId,
          corpus: corpusOfMatter(matterId as MatterId),
          text: phrases.join(" OR "),
          // A hit is a passage, and one file can hold many; asking for more passages than files is
          // what lets `limit` distinct files come back.
          limit: limit * PASSAGES_PER_FILE,
        },
        port,
      );
      if (!result.ok) {
        return { kind: result.reason === "engine-not-implemented" ? "unreachable" : "failed" };
      }
      return {
        kind: "files",
        fileIds: [...new Set(result.hits.map((hit) => hit.documentId))].slice(0, limit),
      };
    },
  };
}

const PASSAGES_PER_FILE = 4;
