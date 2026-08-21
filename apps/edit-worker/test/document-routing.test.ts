import { describe, expect, it } from "vitest";
import { documentKeyFromHost, forwardWopiCallback } from "../src/document-routing.ts";

// A key exactly as the app worker's editor-launch mints it: the leading 52 hex characters of a SHA-256
// digest. Anything else must not reach a container.
const KEY = "9f2c4a1e0b7d83562fae19cc470db28e6153af90724ec8bd31056e7a".slice(0, 52);

describe("documentKeyFromHost", () => {
  it("reads the per-document container key from the Host's first label", () => {
    expect(documentKeyFromHost(`${KEY}.edit.magnacarta.example`)).toBe(KEY);
  });

  it("ignores a port suffix", () => {
    expect(documentKeyFromHost(`${KEY}.edit.localhost:8787`)).toBe(KEY);
  });

  it("returns null for an empty host (nothing to route to)", () => {
    expect(documentKeyFromHost("")).toBeNull();
  });

  it("is stable: a given document origin always yields the same container key", () => {
    const host = `${KEY}.edit.magnacarta.example`;
    expect(documentKeyFromHost(host)).toBe(documentKeyFromHost(host));
  });

  // A container is multi-gigabyte and starts on first address, so a label that this platform could never
  // have minted is refused before it can name one.
  it("refuses a label that is not a minted document key, so no container is addressed", () => {
    const rejected = [
      "www.magnacarta.example", // a plausible but unmintable label
      "admin.edit.magnacarta.example",
      `${KEY.slice(0, 51)}.edit.magnacarta.example`, // one character short
      `${KEY}f.edit.magnacarta.example`, // one character long
      `${KEY.slice(0, 51).toUpperCase()}a.edit.magnacarta.example`, // right length, wrong case
      `${KEY.slice(0, 50)}zz.edit.magnacarta.example`, // right length, non-hex
      `${KEY.slice(0, 50)}-1.edit.magnacarta.example`, // right length, punctuation
      "..edit.magnacarta.example",
      "   .edit.magnacarta.example",
      ":8787",
    ];
    for (const host of rejected) expect(documentKeyFromHost(host)).toBeNull();
  });

  it("accepts every key the launch actually mints (a real SHA-256-derived key round-trips)", async () => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("file_01JZ4Z8QW9K3TXN7B2VD5MEXAM"),
    );
    const minted = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 52);

    expect(documentKeyFromHost(`${minted}.edit.magnacarta.example`)).toBe(minted);
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
