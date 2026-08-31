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
  it("drops a number face that is not real, rather than losing the whole item", () => {
    // The regression: the register requires a finite number on a two-faced cell and rejects the
    // WHOLE document otherwise, so one unmeasured figure silently cost the member the shelf item.
    const withBrokenFigure: TabularExportDocument = {
      title: "Firm Usage",
      generatedAt: new Date(2026, 7, 31),
      sections: [
        {
          title: "AI Usage",
          headers: ["Meter", "All Time"],
          rows: [
            ["Magnus Input Tokens", { text: "-", number: Number.NaN }],
            ["Semantic Search Queries", { text: "7", number: 7 }],
          ],
        },
      ],
    };
    const stored = storedFromExport(withBrokenFigure);
    expect(stored.sections[0]?.rows[0]?.[1]).toBe("-");
    expect(stored.sections[0]?.rows[1]?.[1]).toEqual({ text: "7", number: 7 });
  });

  it("posts the stored document with the format that was taken", async () => {
    let captured: { url: string; body: Record<string, unknown> } | undefined;
    const fakeFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(url), body: JSON.parse(init?.body as string) };
      return new Response(JSON.stringify({ id: "downloadItem_one" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const outcome = await keepExportOnShelf(fakeFetch, exportDocument, "xlsx");
    expect(outcome).toEqual({ kind: "ok", value: { id: "downloadItem_one" } });
    expect(captured?.url).toBe("/api/v1/downloads/snapshots");
    expect(captured?.body).toMatchObject({ title: "Firm Usage", format: "xlsx" });
  });

  it("reports a refusal rather than swallowing it", async () => {
    // It never throws — the member already has their file — but the caller must be able to say so.
    // Swallowing this is what made a refused document look like a download that never arrived.
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ detail: "past the bounds", errorId: "error_y" }), {
        status: 422,
        headers: { "content-type": "application/problem+json" },
      })) as typeof fetch;
    const outcome = await keepExportOnShelf(fakeFetch, exportDocument, "csv");
    expect(outcome.kind).toBe("problem");
    if (outcome.kind !== "problem") return;
    expect(outcome.problem.status).toBe(422);
    expect(outcome.problem.errorId).toBe("error_y");
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
