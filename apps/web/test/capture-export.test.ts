/*
 * The capture export — what a member takes away when they download everything. The cases that
 * matter: every fact the panel shows reaches the report, nothing in it can act (no markup, no live
 * links), a registration record for a different site never leaks in, and the mode is the one the
 * capture was taken in.
 */
import { describe, expect, it } from "vitest";
import {
  captureArchiveFilename,
  captureRecord,
  captureReportText,
  type CaptureExportInput,
} from "../src/lib/tools/safe-browse/capture-export.ts";
import type { SafeWebsiteView } from "../src/lib/tools/safe-browse/safe-browse.ts";

const view: SafeWebsiteView = {
  requestedUrl: "https://short.example/x",
  finalUrl: "https://landing.example/login",
  redirectChain: [
    { url: "https://short.example/x", status: 301, location: "https://landing.example/login" },
    { url: "https://landing.example/login", status: 200 },
  ],
  responseHeaders: { "content-type": "text/html", server: "nginx" },
  screenshotBase64: "aGk=",
  title: "Sign in to your bank",
  markdown: "Enter your password <script>alert(1)</script>",
  links: ["https://landing.example/help"],
};

const input: CaptureExportInput = {
  view,
  capturedAt: Date.UTC(2026, 8, 24, 18, 0, 0),
  elapsedMs: 4200,
  mode: "live",
  registration: {
    source: "rdap",
    target: "landing.example",
    registrar: "Example Registrar",
    registeredAt: "2026-09-20",
  },
};

describe("captureReportText", () => {
  const report = captureReportText(input);

  it("carries every fact the panel shows", () => {
    for (const fact of [
      "https://short.example/x",
      "https://landing.example/login",
      "Different site: yes",
      "Final status: 200",
      "Content type: text/html",
      "Server: nginx",
      "Redirects: 1",
      "Outbound links: 1",
      "Page title: Sign in to your bank",
      "1. 301 https://short.example/x -> https://landing.example/login",
      "https://landing.example/help",
      "server: nginx",
      "Registrar: Example Registrar",
      "Registered: 2026-09-20",
      "Mode: Live",
    ]) {
      expect(report, fact).toContain(fact);
    }
  });

  it("keeps the page's text as text, never as markup that could run", () => {
    // Plain text by construction: the page's own words pass through unchanged, inside a .txt file
    // no viewer treats as a document to execute. The report adds no markup of its own.
    expect(report).toContain("Enter your password <script>alert(1)</script>");
    expect(report).not.toMatch(/<a\s|href=/i);
  });

  it("says when registration was not looked up rather than leaving a blank", () => {
    expect(captureReportText({ ...input, registration: null })).toContain("not looked up");
  });
});

describe("captureRecord", () => {
  it("structures the same facts without repeating the screenshot", () => {
    const record = captureRecord(input);
    expect(record).toMatchObject({
      mode: "live",
      differentSite: true,
      finalUrl: "https://landing.example/login",
      capturedAt: "2026-09-24T18:00:00.000Z",
      registration: { registrar: "Example Registrar" },
    });
    // The screenshot is its own archive entry; a second copy inside the JSON only makes it huge.
    expect("screenshotBase64" in record).toBe(false);
  });
});

describe("captureArchiveFilename", () => {
  it("shares the screenshot's name so the two sort together", () => {
    const name = captureArchiveFilename(view.finalUrl, input.capturedAt);
    expect(name).toMatch(/^safe-capture-landing\.example-\d{8}-\d{4}\.zip$/);
  });
});
