/*
 * The Overview tab's derivations, pinned. The tricky cases: the final status is the LAST chain
 * hop (the chain ends with the final response, not a redirect), the redirect count must not count
 * that final response, header lookup cannot assume a casing, and the screenshot filename must
 * stay filename-safe and distinguishable to the minute.
 */
import { describe, expect, it } from "vitest";
import {
  finalHost,
  finalStatus,
  formatCaptureDuration,
  formatCaptureTime,
  headerValue,
  redirectCount,
  screenshotFilename,
} from "../src/lib/tools/safe-browse/capture-facts.ts";
import type { SafeWebsiteView } from "../src/lib/tools/safe-browse/safe-browse.ts";

const capturedView: SafeWebsiteView = {
  requestedUrl: "https://short.example/a",
  finalUrl: "https://landing.example/page",
  redirectChain: [
    { url: "https://short.example/a", status: 301, location: "https://landing.example/page" },
    { url: "https://landing.example/page", status: 200 },
  ],
  responseHeaders: { Server: "nginx", "Content-Type": "text/html; charset=utf-8" },
  screenshotBase64: "aGVsbG8=",
  title: "Landing",
  markdown: "# Landing",
  links: ["https://landing.example/next"],
};

describe("finalStatus", () => {
  it("reads the last chain hop's status — the final response, not a redirect", () => {
    expect(finalStatus(capturedView)).toBe(200);
  });

  it("is null when the renderer reported no chain, rather than an invented status", () => {
    expect(finalStatus({ ...capturedView, redirectChain: [] })).toBeNull();
  });
});

describe("headerValue", () => {
  it("matches header names case-insensitively", () => {
    expect(headerValue(capturedView.responseHeaders, "content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(headerValue(capturedView.responseHeaders, "SERVER")).toBe("nginx");
  });

  it("is null for a header the response did not carry", () => {
    expect(headerValue(capturedView.responseHeaders, "x-frame-options")).toBeNull();
  });
});

describe("redirectCount", () => {
  it("counts only the 3xx hops, not the final response", () => {
    expect(redirectCount(capturedView)).toBe(1);
  });

  it("is zero for an address that answered directly", () => {
    expect(
      redirectCount({
        ...capturedView,
        redirectChain: [{ url: "https://landing.example/page", status: 200 }],
      }),
    ).toBe(0);
  });
});

describe("finalHost", () => {
  it("reads the hostname off a captured URL", () => {
    expect(finalHost("https://landing.example/page?a=1")).toBe("landing.example");
  });

  it("is null for a URL that cannot be parsed, never a thrown error", () => {
    expect(finalHost("")).toBeNull();
    expect(finalHost("not a url")).toBeNull();
  });
});

describe("screenshotFilename", () => {
  // Built from local date components so the expected stamp holds in any timezone.
  const capturedAt = new Date(2026, 7, 31, 14, 5).getTime();

  it("names the file after the landed host and the capture's local minute", () => {
    expect(screenshotFilename("https://landing.example/page", capturedAt)).toBe(
      "safe-capture-landing.example-20260831-1405.png",
    );
  });

  it("falls back to a plain capture name when the URL has no readable host", () => {
    expect(screenshotFilename("", capturedAt)).toBe("safe-capture-capture-20260831-1405.png");
  });
});

describe("formatCaptureDuration", () => {
  it("renders elapsed milliseconds as seconds with one decimal", () => {
    expect(formatCaptureDuration(1234)).toBe("1.2s");
    expect(formatCaptureDuration(500)).toBe("0.5s");
    expect(formatCaptureDuration(12000)).toBe("12.0s");
  });
});

describe("formatCaptureTime", () => {
  it("renders a readable local time carrying the capture's year", () => {
    expect(formatCaptureTime(new Date(2026, 7, 31, 14, 5, 9).getTime())).toContain("2026");
  });
});
