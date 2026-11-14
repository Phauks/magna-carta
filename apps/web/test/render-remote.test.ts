import { describe, expect, it } from "vitest";
import {
  RemoteRenderError,
  renderableFromExport,
  renderRemoteExport,
} from "$lib/export/render-remote.ts";
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
    {
      title: "People and Organizations",
      headers: ["Record", "Count"],
      rows: [["People", { text: "5", number: 5 }]],
    },
  ],
};

describe("renderableFromExport", () => {
  const renderable = renderableFromExport(exportDocument);

  it("maps every cell down to its printed face", () => {
    expect(renderable.sections[0]?.rows).toEqual([["Standard", "41,208"]]);
  });

  it("carries the stamp as the two rendered lines", () => {
    expect(renderable.stampLines).toHaveLength(2);
    expect(renderable.stampLines[0]).toContain("Generated");
  });

  it("carries end-aligned columns only where the section declares them", () => {
    expect(renderable.sections[0]?.endAlignedColumns).toEqual([1]);
    expect(renderable.sections[1]).not.toHaveProperty("endAlignedColumns");
  });
});

describe("renderRemoteExport", () => {
  it("posts the wire document and resolves the response bytes", async () => {
    let captured: { url: string; body: unknown } | undefined;
    const fakeFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(url), body: JSON.parse(init?.body as string) };
      return new Response(new Uint8Array([0x50, 0x4b]), { status: 200 });
    }) as typeof fetch;

    const blob = await renderRemoteExport(exportDocument, "docx", fakeFetch);
    expect(blob.size).toBe(2);
    expect(captured?.url).toBe("/api/v1/reports/exports");
    expect(captured?.body).toMatchObject({
      format: "docx",
      document: { title: "Firm Usage" },
    });
  });

  it("throws the server's own words with the Error ID on a problem reply", async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          type: "https://api.magnacarta.esq/problems/service-unavailable",
          detail: "The office-suite engine is not available right now. Try again shortly.",
          errorId: "error_test123",
        }),
        { status: 503, headers: { "content-type": "application/problem+json" } },
      )) as typeof fetch;

    const failure = await renderRemoteExport(exportDocument, "docx", fakeFetch).catch(
      (caught: unknown) => caught,
    );
    expect(failure).toBeInstanceOf(RemoteRenderError);
    expect((failure as RemoteRenderError).message).toContain("Try again shortly");
    expect((failure as RemoteRenderError).errorId).toBe("error_test123");
  });

  it("names the transport when nothing answers, without inventing a status", async () => {
    const fakeFetch = (async () => {
      throw new TypeError("network down");
    }) as typeof fetch;

    const failure = await renderRemoteExport(exportDocument, "docx", fakeFetch).catch(
      (caught: unknown) => caught,
    );
    expect(failure).toBeInstanceOf(RemoteRenderError);
    expect((failure as RemoteRenderError).message).toContain("connection");
    expect((failure as RemoteRenderError).errorId).toBeUndefined();
  });

  it("still yields a usable failure when the error body is not JSON", async () => {
    const fakeFetch = (async () =>
      new Response("<html>bad gateway</html>", { status: 502 })) as typeof fetch;

    const failure = await renderRemoteExport(exportDocument, "docx", fakeFetch).catch(
      (caught: unknown) => caught,
    );
    expect(failure).toBeInstanceOf(RemoteRenderError);
    expect((failure as RemoteRenderError).message).toContain("502");
  });
});
