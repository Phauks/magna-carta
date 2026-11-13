// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import { buildSafeDeliveryHeaders } from "../../src/files/preview-headers.ts";
import { readerOriginFor } from "../../src/files/preview-serve.ts";

describe("buildSafeDeliveryHeaders", () => {
  it("stamps the exact safe-delivery header set", () => {
    const h = buildSafeDeliveryHeaders({
      sniffedContentType: "video/mp4",
      frameAncestors: "https://*.example.com",
    });
    expect(h.get("Content-Disposition")).toBe("attachment");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("Content-Type")).toBe("video/mp4");
    expect(h.get("Content-Security-Policy")).toBe(
      "sandbox; default-src 'none'; frame-ancestors https://*.example.com",
    );
    expect(h.get("Cache-Control")).toBe("private, no-store");
    expect(h.get("Accept-Ranges")).toBe("bytes");
  });

  it("uses the sniffed type verbatim (never declared, never octet-stream fallback)", () => {
    const h = buildSafeDeliveryHeaders({
      sniffedContentType: "audio/mpeg",
      frameAncestors: "https://*.example.com",
    });
    expect(h.get("Content-Type")).toBe("audio/mpeg");
  });

  it("never emits Content-Disposition: inline", () => {
    const h = buildSafeDeliveryHeaders({
      sniffedContentType: "video/mp4",
      frameAncestors: "https://*.example.com",
    });
    expect(h.get("Content-Disposition")).not.toContain("inline");
  });

  it("sends NO Access-Control-Allow-Origin unless an app page is named, and never a wildcard", () => {
    const h = buildSafeDeliveryHeaders({
      sniffedContentType: "video/mp4",
      frameAncestors: "https://*.example.com",
    });
    expect(h.get("Access-Control-Allow-Origin")).toBeNull();
    expect(h.get("Vary")).toBe("Origin");
  });

  it("grants read access to the one app page that asked", () => {
    const h = buildSafeDeliveryHeaders({
      sniffedContentType: "video/mp4",
      frameAncestors: "https://*.example.com",
      readerOrigin: "https://smith-law.example.com",
    });
    expect(h.get("Access-Control-Allow-Origin")).toBe("https://smith-law.example.com");
    expect(h.get("Access-Control-Expose-Headers")).toBe("Content-Range, Accept-Ranges");
  });
});

describe("readerOriginFor", () => {
  it("names an app page under the files host's parent", () => {
    expect(readerOriginFor("https://smith-law.example.com", "files.example.com")).toBe(
      "https://smith-law.example.com",
    );
  });

  it("names nothing for another site, plain http, the files host, a lookalike or no origin", () => {
    expect(readerOriginFor("https://evil.test", "files.example.com")).toBeNull();
    expect(readerOriginFor("http://smith-law.example.com", "files.example.com")).toBeNull();
    expect(readerOriginFor("https://files.example.com", "files.example.com")).toBeNull();
    expect(readerOriginFor("https://notexample.com", "files.example.com")).toBeNull();
    expect(readerOriginFor("https://example.com.evil.test", "files.example.com")).toBeNull();
    expect(readerOriginFor("null", "files.example.com")).toBeNull();
    expect(readerOriginFor(null, "files.example.com")).toBeNull();
  });
});
