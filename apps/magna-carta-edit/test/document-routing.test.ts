import { describe, expect, it } from "vitest";
import { documentKeyFromHost, forwardWopiCallback } from "../src/document-routing.ts";

describe("documentKeyFromHost", () => {
  it("reads the per-document container key from the Host's first label", () => {
    expect(documentKeyFromHost("a1b2c3.edit.magnacarta.example")).toBe("a1b2c3");
  });

  it("ignores a port suffix", () => {
    expect(documentKeyFromHost("a1b2c3.edit.localhost:8787")).toBe("a1b2c3");
  });

  it("returns null for an empty host (nothing to route to)", () => {
    expect(documentKeyFromHost("")).toBeNull();
  });

  it("is stable: a given document origin always yields the same container key", () => {
    const host = "deadbeefcafe.edit.magnacarta.example";
    expect(documentKeyFromHost(host)).toBe(documentKeyFromHost(host));
  });
});

describe("forwardWopiCallback", () => {
  it("forwards the intercepted WOPI request to the app worker verbatim and returns its response", async () => {
    const seen: Request[] = [];
    const appWorker = {
      fetch(request: Request): Promise<Response> {
        seen.push(request);
        return Promise.resolve(new Response("ok", { status: 200 }));
      },
    } as unknown as Fetcher;

    const request = new Request("http://wopi.magna-carta.internal/wopi/files/file_abc", {
      method: "POST",
      headers: { "x-wopi-override": "PUT" },
    });
    const response = await forwardWopiCallback(request, appWorker);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(request);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });
});
