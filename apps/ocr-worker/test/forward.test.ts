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
