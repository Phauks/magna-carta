import { describe, expect, it } from "vitest";
import {
  exportFromStored,
  keepExportOnShelf,
  removeShelfItem,
  storedFromExport,
} from "$lib/export/download-shelf.ts";
import type { TabularExportDocument } from "$lib/export/tabular-export.ts";

const exportDocument: TabularExportDocument = {
  title: "Firm Usage",
  generatedAt: new Date(2026, 7, 31, 12, 57, 56),
  sections: [
    {
      title: "Storage",
      headers: ["Storage Class", "Objects"],
      rows: [["Standard", { text: "41,208", number: 41_208 }]],
      endAlignedColumns: [1],
    },
  ],
};

describe("the stored snapshot shape", () => {
  it("keeps a cell's number face, so a re-rendered spreadsheet still sums", () => {
    const stored = storedFromExport(exportDocument);
    expect(stored.sections[0]?.rows[0]?.[1]).toEqual({ text: "41,208", number: 41_208 });
  });

  it("round-trips to the same document every renderer already takes", () => {
    const restored = exportFromStored(storedFromExport(exportDocument));
    expect(restored.title).toBe(exportDocument.title);
    expect(restored.generatedAt.getTime()).toBe(exportDocument.generatedAt.getTime());
    expect(restored.sections).toEqual(exportDocument.sections);
  });
});

describe("keepExportOnShelf", () => {
  it("posts the stored document with the format that was taken", async () => {
    let captured: { url: string; body: Record<string, unknown> } | undefined;
    const fakeFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(url), body: JSON.parse(init?.body as string) };
      return new Response(JSON.stringify({ id: "downloadItem_one" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    expect(await keepExportOnShelf(fakeFetch, exportDocument, "xlsx")).toBe("downloadItem_one");
    expect(captured?.url).toBe("/api/v1/downloads/snapshots");
    expect(captured?.body).toMatchObject({ title: "Firm Usage", format: "xlsx" });
  });

  it("answers undefined rather than throwing when the shelf will not take it", async () => {
    // The member already has the file they asked for, so a shelf failure must never surface as an
    // error over a download that worked.
    const fakeFetch = (async () => new Response("{}", { status: 503 })) as typeof fetch;
    expect(await keepExportOnShelf(fakeFetch, exportDocument, "csv")).toBeUndefined();
  });
});

describe("removeShelfItem", () => {
  it("reads a 204 as success rather than as a dead transport", async () => {
    // The regression this exists for: routed through the JSON helper, an empty 204 body threw on
    // parse and was reported as a transport failure, so a removal that succeeded showed the member
    // an error and left the row on screen.
    const fakeFetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
    expect(await removeShelfItem(fakeFetch, "downloadItem_one")).toEqual({
      kind: "ok",
      value: undefined,
    });
  });

  it("carries the server's own words when the removal is refused", async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({ detail: "That item is not on your shelf.", errorId: "error_x" }),
        {
          status: 404,
          headers: { "content-type": "application/problem+json" },
        },
      )) as typeof fetch;

    const outcome = await removeShelfItem(fakeFetch, "downloadItem_gone");
    expect(outcome.kind).toBe("problem");
    if (outcome.kind !== "problem") return;
    expect(outcome.problem.status).toBe(404);
    expect(outcome.problem.detail).toBe("That item is not on your shelf.");
    expect(outcome.problem.errorId).toBe("error_x");
  });

  it("reports a dead transport as its own outcome", async () => {
    const fakeFetch = (async () => {
      throw new TypeError("network down");
    }) as typeof fetch;
    expect(await removeShelfItem(fakeFetch, "downloadItem_one")).toEqual({ kind: "transport" });
  });
});
