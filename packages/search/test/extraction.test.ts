import { describe, expect, it } from "vitest";
import {
  extracted,
  extractionAdapterError,
  extractionEngineNotImplemented,
  passagesFromPages,
  unextractable,
} from "../src/extraction.ts";

describe("text extraction outcomes", () => {
  it("keeps the three failure reasons distinct — the pipeline routes each one differently", () => {
    expect(extractionEngineNotImplemented()).toEqual({
      ok: false,
      reason: "engine-not-implemented",
    });
    expect(unextractable("no text layer")).toEqual({
      ok: false,
      reason: "unextractable",
      detail: "no text layer",
    });
    expect(extractionAdapterError("container unreachable")).toEqual({
      ok: false,
      reason: "adapter-error",
      detail: "container unreachable",
    });
  });

  it("reports success as a value, never a throw", () => {
    const result = extracted([{ chunkId: "page-0", text: "hello" }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.passages).toHaveLength(1);
  });
});

describe("passagesFromPages", () => {
  it("makes one passage per page, joining its lines and numbering the page from one", () => {
    const passages = passagesFromPages([
      { pageIndex: 0, lines: [{ text: "the seller shall" }, { text: "indemnify the buyer" }] },
      { pageIndex: 1, lines: [{ text: "environmental liability" }] },
    ]);
    expect(passages).toEqual([
      { chunkId: "page-0", text: "the seller shall\nindemnify the buyer", page: 1 },
      { chunkId: "page-1", text: "environmental liability", page: 2 },
    ]);
  });

  it("drops a page with no readable text rather than indexing an empty passage", () => {
    const passages = passagesFromPages([
      { pageIndex: 0, lines: [] },
      { pageIndex: 1, lines: [{ text: "   " }] },
      { pageIndex: 2, lines: [{ text: "real text" }] },
    ]);
    expect(passages.map((passage) => passage.chunkId)).toEqual(["page-2"]);
  });

  it("yields nothing at all for a document with no recognizable text", () => {
    expect(passagesFromPages([{ pageIndex: 0, lines: [{ text: "" }] }])).toEqual([]);
  });
});
