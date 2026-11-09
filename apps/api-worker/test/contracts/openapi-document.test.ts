// Slice 0·5b Task 9: the committed-contract document is built from createApp() without bindings —
// getOpenAPI31Document is pure (no request, no env), so the offline emitter and the in-pool snapshot
// guard share one builder. These assertions pin the extraction (app.ts) the emitter depends on.
import { describe, expect, it } from "vitest";
import { buildOpenAPIDocument, serializeOpenAPIDocument } from "../../src/http/app.ts";

describe("buildOpenAPIDocument — the contract document, no bindings", () => {
  it("emits a 3.1 document with the configured info, servers, and every registered route path", () => {
    const document = buildOpenAPIDocument();
    expect(document.openapi).toBe("3.1.0");
    expect(document.info.title).toBe("Magna Carta API");
    expect(document.servers?.map((server) => server.url)).toContain(
      "https://api.magnacarta.esq/v1",
    );
    expect(Object.keys(document.paths ?? {})).toEqual(
      expect.arrayContaining(["/api/health", "/api/v1/me", "/api/v1/members", "/api/v1/firms"]),
    );
  });
});

describe("serializeOpenAPIDocument — the byte-exact snapshot form", () => {
  it("pretty-prints with two-space indent and a single trailing newline", () => {
    const text = serializeOpenAPIDocument();
    expect(text.startsWith('{\n  "openapi": "3.1.0"')).toBe(true);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.endsWith("}\n\n")).toBe(false);
  });

  it("round-trips to the same document buildOpenAPIDocument produced", () => {
    expect(JSON.parse(serializeOpenAPIDocument())).toEqual(buildOpenAPIDocument());
  });
});
