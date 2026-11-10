import { describe, expect, it } from "vitest";
import { forwardOcr } from "../src/forward.ts";

describe("forwardOcr", () => {
  it("re-targets the request at the container and returns its response verbatim", async () => {
    let seen: Request | undefined;
    const container = {
      async fetch(request: Request) {
        seen = request;
        return new Response(JSON.stringify({ pages: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    };
    const response = await forwardOcr(
      new Request("https://worker.example/ocr", {
        method: "POST",
        body: "bytes",
      }),
      container,
    );
    expect(seen?.url).toBe("http://ocr/ocr");
    expect(seen?.method).toBe("POST");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pages: [] });
  });

  it("carries the query string through, so a page window reaches the engine", async () => {
    let seen: Request | undefined;
    const container = {
      async fetch(request: Request) {
        seen = request;
        return Response.json({ pages: [], pageCount: 250 });
      },
    };
    await forwardOcr(
      new Request("https://worker.example/ocr?firstPage=200&force=true", {
        method: "POST",
        body: "bytes",
      }),
      container,
    );
    expect(seen?.url).toBe("http://ocr/ocr?firstPage=200&force=true");
  });

  it("re-targets the searchable path and streams the container's PDF back verbatim", async () => {
    let seen: Request | undefined;
    const container = {
      async fetch(request: Request) {
        seen = request;
        return new Response("%PDF-1.7 searchable", {
          status: 200,
          headers: { "content-type": "application/pdf" },
        });
      },
    };
    const response = await forwardOcr(
      new Request("https://worker.example/ocr/searchable", {
        method: "POST",
        body: "bytes",
      }),
      container,
      "/ocr/searchable",
    );
    expect(seen?.url).toBe("http://ocr/ocr/searchable");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(await response.text()).toBe("%PDF-1.7 searchable");
  });

  it("passes a container fault through rather than masking it as success", async () => {
    const container = {
      async fetch() {
        return new Response(JSON.stringify({ code: "inference-failed" }), {
          status: 503,
        });
      },
    };
    const response = await forwardOcr(
      new Request("https://worker.example/ocr", {
        method: "POST",
        body: "bytes",
      }),
      container,
    );
    expect(response.status).toBe(503);
  });

  it("passes a permanently-bad-document fault through as 422, not swallowed or converted", async () => {
    const container = {
      async fetch() {
        return new Response(JSON.stringify({ code: "document-unreadable" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        });
      },
    };
    const response = await forwardOcr(
      new Request("https://worker.example/ocr", {
        method: "POST",
        body: "bytes",
      }),
      container,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ code: "document-unreadable" });
  });
});
