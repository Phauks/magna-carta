import { describe, expect, it } from "vitest";
import {
  CANNOT_PLAY_TITLE,
  cannotPlaySentence,
  conversionSentence,
  offersConversion,
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

describe("Unreadable Media File and Convert to MP4", () => {
  it("is titled the way the owner named it", () => {
    expect(CANNOT_PLAY_TITLE).toBe("Unreadable Media File");
  });

  it("offers conversion only where a copy can cure the refusal and the converter reads the container", () => {
    const encoding = { verdict: "download-only", reason: "verdict" } as const;
    expect(offersConversion("browser-refused", "video/mp4")).toBe(true);
    expect(offersConversion(encoding, "video/quicktime")).toBe(true);
    expect(offersConversion(encoding, "video/x-matroska")).toBe(true);
    expect(offersConversion(encoding, "video/webm")).toBe(false);
    expect(offersConversion(encoding, "audio/mpeg")).toBe(false);
    expect(offersConversion(encoding, null)).toBe(false);
    expect(offersConversion({ verdict: "playable", reason: "host-unavailable" }, "video/mp4")).toBe(
      false,
    );
    expect(offersConversion({ verdict: "playable", reason: "tiered" }, "video/mp4")).toBe(false);
  });

  it("names the conversion in the remedy only when it is offered", () => {
    expect(cannotPlaySentence("browser-refused", true)).toContain("Convert it to MP4");
    expect(cannotPlaySentence("browser-refused")).not.toContain("Convert");
  });

  it("says where the copy stands, and why one could not be made", () => {
    const base = { versionId: "v", fileId: null, streamUrl: null, sizeBytes: null, reason: null };
    expect(conversionSentence({ ...base, state: "none" })).toBeNull();
    expect(conversionSentence({ ...base, state: "pending" })).toContain("beside the original");
    expect(conversionSentence({ ...base, state: "ready", fileId: "file_x" })).toContain(
      "same folder",
    );
    expect(conversionSentence({ ...base, state: "unavailable", reason: "unsupported" })).toContain(
      "ProRes",
    );
    expect(conversionSentence({ ...base, state: "unavailable", reason: "too-large" })).toContain(
      "six hours",
    );
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
