import { describe, expect, it } from "vitest";
import {
  cannotPlaySentence,
  screenshotFileName,
  momentHref,
  startSecondOf,
} from "../src/lib/documents/video-playback.ts";

describe("cannotPlaySentence", () => {
  it("names the codec problem for a recording the server judged undecodable", () => {
    expect(cannotPlaySentence({ verdict: "download-only", reason: "verdict" })).toContain("ProRes");
  });

  it("says the encoding could not be read for an indeterminate verdict", () => {
    expect(cannotPlaySentence({ verdict: "indeterminate", reason: "verdict" })).toContain(
      "could not be read",
    );
  });

  it("says streaming is not set up when the files host is missing", () => {
    expect(cannotPlaySentence({ verdict: "playable", reason: "host-unavailable" })).toContain(
      "not set up",
    );
  });

  it("blames the browser when the server allowed it and the browser refused", () => {
    expect(cannotPlaySentence("browser-refused")).toContain("This browser");
  });

  it("always ends by offering the download", () => {
    for (const reason of ["verdict", "tiered", "encoded", "derived", "unknown-type"] as const) {
      expect(cannotPlaySentence({ verdict: "download-only", reason })).toMatch(/download/iu);
    }
  });
});

describe("startSecondOf and momentHref", () => {
  it("reads a whole second from the address and nothing else", () => {
    expect(startSecondOf(new URLSearchParams("t=761"))).toBe(761);
    expect(startSecondOf(new URLSearchParams("t=1.5"))).toBe(0);
    expect(startSecondOf(new URLSearchParams("t=-4"))).toBe(0);
    expect(startSecondOf(new URLSearchParams(""))).toBe(0);
  });

  it("writes an address the reader reads back to the same second", () => {
    const href = momentHref("https://firm.example", "file 01", 761.8);
    expect(href).toBe("https://firm.example/documents/file%2001/watch?t=761");
    expect(startSecondOf(new URL(href).searchParams)).toBe(761);
  });
});

describe("screenshotFileName", () => {
  it("names the still after the recording and the moment, with no colon", () => {
    expect(screenshotFileName("Deposition of Smith.mp4", 761)).toBe(
      "Deposition of Smith at 0-12-41.png",
    );
    expect(screenshotFileName("hearing", 3725)).toBe("hearing at 1-02-05.png");
    expect(screenshotFileName(".mp4", 0)).toBe("Recording at 0-00-00.png");
  });
});
