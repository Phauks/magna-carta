// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import { buildSafeDeliveryHeaders } from "../../src/files/preview-headers.ts";

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

  it("sends NO Access-Control-Allow-Origin (the decided launch CORS posture)", () => {
    const h = buildSafeDeliveryHeaders({
      sniffedContentType: "video/mp4",
      frameAncestors: "https://*.example.com",
    });
    expect(h.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
