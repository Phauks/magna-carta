import { describe, expect, it } from "vitest";
import {
  EXTRACTION_BATCH_SIZE,
  extractionSentence,
  refusalWords,
  runExtraction,
} from "../src/lib/file-manager/archive-extraction.ts";
import type { ExtractionRefusalReason } from "../src/lib/file-manager/matter-file-api.ts";

/*
 * Extraction as the reader experiences it: how many requests a large selection becomes, and what
 * they are told about the members that did not come out. Partial success is the ordinary case, so
 * most of these are about saying so precisely.
 */

interface Call {
  readonly url: string;
  readonly body: { paths: string[]; folderId: string | null };
}

function scripted(answer: (call: Call, index: number) => Response): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input.href : input;
    const call: Call = { url, body: JSON.parse(String(init?.body)) as Call["body"] };
    calls.push(call);
    return answer(call, calls.length - 1);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function extraction(
  extracted: readonly string[],
  refused: readonly { path: string; reason: ExtractionRefusalReason }[] = [],
): Response {
  return new Response(
    JSON.stringify({
      extracted: extracted.map((path, at) => ({
        path,
        fileId: `file_${String(at)}`,
        versionId: `fileVersion_${String(at)}`,
        name: path.split("/").at(-1) ?? path,
      })),
      refused,
    }),
    { status: 202, headers: { "content-type": "application/json" } },
  );
}

describe("runExtraction", () => {
  it("asks for nothing when nothing was selected, and makes no request", async () => {
    const { fetchImpl, calls } = scripted(() => {
      throw new Error("an empty selection must not reach the host");
    });
    expect(await runExtraction(fetchImpl, { fileId: "f", paths: [], folderId: null })).toEqual({
      kind: "nothing-asked",
    });
    expect(calls).toEqual([]);
  });

  it("sends one request for a selection within the batch size", async () => {
    const { fetchImpl, calls } = scripted(() => extraction(["a.txt", "b.txt"]));
    const outcome = await runExtraction(
      fetchImpl,
      { fileId: "file_01", paths: ["a.txt", "b.txt"], folderId: "folder_01" },
      () => "key-1",
    );
    expect(outcome.kind).toBe("done");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/v1/files/file_01/archive-extractions");
    expect(calls[0]?.body).toEqual({ paths: ["a.txt", "b.txt"], folderId: "folder_01" });
  });

  it("splits a selection past the batch size, and merges what comes back", async () => {
    const paths = Array.from(
      { length: EXTRACTION_BATCH_SIZE + 5 },
      (_u, at) => `m${String(at)}.txt`,
    );
    const { fetchImpl, calls } = scripted((call) => extraction(call.body.paths));
    const outcome = await runExtraction(fetchImpl, { fileId: "f", paths, folderId: null });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.body.paths).toHaveLength(EXTRACTION_BATCH_SIZE);
    expect(calls[1]?.body.paths).toHaveLength(5);
    expect(outcome.kind).toBe("done");
    if (outcome.kind !== "done") return;
    expect(outcome.result.extracted).toHaveLength(EXTRACTION_BATCH_SIZE + 5);
  });

  it("carries a fresh idempotency key per batch, so one is never replayed as another", async () => {
    const paths = Array.from({ length: EXTRACTION_BATCH_SIZE + 1 }, (_u, at) => `m${String(at)}`);
    const keys: string[] = [];
    let counter = 0;
    const fetchImpl = (async (_input: string | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      keys.push(headers["idempotency-key"] ?? "");
      return extraction([]);
    }) as typeof fetch;
    await runExtraction(fetchImpl, { fileId: "f", paths, folderId: null }, () => {
      counter += 1;
      return `key-${String(counter)}`;
    });
    expect(keys).toEqual(["key-1", "key-2"]);
  });

  it("stops at a failing batch and reports it as itself", async () => {
    const { fetchImpl, calls } = scripted((_call, index) =>
      index === 0
        ? extraction(["a.txt"])
        : new Response(JSON.stringify({ status: 429 }), {
            status: 429,
            headers: { "content-type": "application/json" },
          }),
    );
    const paths = Array.from({ length: EXTRACTION_BATCH_SIZE + 1 }, (_u, at) => `m${String(at)}`);
    const outcome = await runExtraction(fetchImpl, { fileId: "f", paths, folderId: null });
    expect(outcome.kind).toBe("problem");
    // The second batch failed; the third was never sent.
    expect(calls).toHaveLength(2);
  });
});

describe("extractionSentence", () => {
  const landed = (count: number) =>
    Array.from({ length: count }, (_u, at) => ({
      path: `m${String(at)}`,
      fileId: "f",
      versionId: "v",
      name: `m${String(at)}`,
    }));

  it("counts what landed when everything did", () => {
    expect(extractionSentence({ extracted: landed(3), refused: [] })).toBe(
      "Extracted 3 files into the matter.",
    );
    expect(extractionSentence({ extracted: landed(1), refused: [] })).toBe(
      "Extracted 1 file into the matter.",
    );
  });

  it("names the reason when every refusal shares one, rather than only counting", () => {
    expect(
      extractionSentence({
        extracted: landed(2),
        refused: [
          { path: "a", reason: "encrypted" },
          { path: "b", reason: "encrypted" },
        ],
      }),
    ).toBe(
      "Extracted 2 files into the matter; 2 were not, because it is password-protected inside the archive.",
    );
  });

  it("counts without inventing a shared reason when the refusals differ", () => {
    expect(
      extractionSentence({
        extracted: landed(1),
        refused: [
          { path: "a", reason: "encrypted" },
          { path: "b", reason: "corrupt" },
        ],
      }),
    ).toBe("Extracted 1 file into the matter; 2 were not.");
  });

  it("says nothing landed, and why, when nothing did", () => {
    expect(
      extractionSentence({ extracted: [], refused: [{ path: "a", reason: "encrypted" }] }),
    ).toBe("Nothing was extracted: it is password-protected inside the archive.");
    expect(
      extractionSentence({
        extracted: [],
        refused: [
          { path: "a", reason: "corrupt" },
          { path: "b", reason: "corrupt" },
        ],
      }),
    ).toBe(
      "Nothing was extracted: all 2 are ones where its contents do not match what the archive recorded for it.",
    );
  });
});

describe("refusalWords", () => {
  it("gives every reason its own sentence, so none reads as a generic failure", () => {
    const reasons: ExtractionRefusalReason[] = [
      "archive-missing",
      "directory",
      "encrypted",
      "unsupported-compression",
      "malformed",
      "too-large",
      "expansion-ratio",
      "corrupt",
      "policy-size",
      "policy-type",
      "not-in-archive",
    ];
    const words = reasons.map((reason) => refusalWords(reason));
    expect(words.every((sentence) => sentence.length > 0)).toBe(true);
    // Every one distinct: a reader who sees two different refusals must be told two different things.
    expect(new Set(words).size).toBe(reasons.length);
  });
});
