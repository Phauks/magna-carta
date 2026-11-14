import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ensureReady, watermarkDocument } from "@magna-carta/pdf";
import {
  DEFAULT_WATERMARK,
  parsePageList,
  watermarkOptions,
  watermarkProblems,
  watermarkedCopyName,
} from "../src/lib/pdf-editor/watermark.ts";

describe("reading a page list", () => {
  it("reads pages and ranges, once each, in order", () => {
    expect(parsePageList("7, 1-3, 2", 10)).toEqual({ pages: [0, 1, 2, 6] });
  });

  it("treats an empty list as every page", () => {
    expect(parsePageList("  ", 4)).toEqual({ pages: null });
  });

  it("refuses a page past the end, a backwards range, and words", () => {
    expect(parsePageList("3-12", 10)).toEqual({ problem: "This document has 10 pages." });
    expect(parsePageList("5-2", 10)).toEqual({ problem: "5-2 runs backwards. Write it as 2-5." });
    expect("problem" in parsePageList("first", 10)).toBe(true);
    expect(parsePageList("0", 10)).toEqual({ problem: "Pages are counted from 1." });
  });
});

describe("checking and building the engine's options", () => {
  it("accepts the defaults", () => {
    expect(watermarkProblems(DEFAULT_WATERMARK, 3, false)).toEqual({});
  });

  it("asks for words, printable characters, and an image when the mark is an image", () => {
    expect(Object.keys(watermarkProblems({ ...DEFAULT_WATERMARK, text: " " }, 3, false))).toEqual([
      "text",
    ]);
    expect(Object.keys(watermarkProblems({ ...DEFAULT_WATERMARK, text: "中" }, 3, false))).toEqual([
      "text",
    ]);
    expect(
      Object.keys(watermarkProblems({ ...DEFAULT_WATERMARK, kind: "image" }, 3, false)),
    ).toEqual(["kind"]);
  });

  it("passes the chosen pages and the colour, and leaves pages out for every page", () => {
    const some = watermarkOptions({ ...DEFAULT_WATERMARK, colour: "red", pages: "2" }, 3, null);
    expect(some.pages).toEqual([1]);
    expect(some.content).toMatchObject({
      kind: "text",
      text: "CONFIDENTIAL",
      font: "helvetica-bold",
      color: [0.75, 0.1, 0.1],
    });
    expect("pages" in watermarkOptions(DEFAULT_WATERMARK, 3, null)).toBe(false);
  });

  it("names the copy after the words", () => {
    expect(
      watermarkedCopyName("Brief.pdf", { ...DEFAULT_WATERMARK, text: "ATTORNEYS' EYES ONLY" }),
    ).toBe("Brief (Attorneys' Eyes Only).pdf");
    expect(watermarkedCopyName("Brief.pdf", { ...DEFAULT_WATERMARK, kind: "image" })).toBe(
      "Brief (Watermarked).pdf",
    );
  });

  it("produces options the real engine accepts", async () => {
    await ensureReady(
      readFileSync(
        fileURLToPath(new URL("../../../packages/pdf/src/pkg/pdf_core_bg.wasm", import.meta.url)),
      ),
    );
    const form = new Uint8Array(
      readFileSync(
        fileURLToPath(
          new URL("../../../crates/pdf-eval/corpus-ci/gov_irs_w9_acroform.pdf", import.meta.url),
        ),
      ),
    );
    const settings = {
      ...DEFAULT_WATERMARK,
      text: "PRIVILEGED & CONFIDENTIAL",
      placement: "tiled" as const,
      pages: "1-2",
    };
    const { pdf } = await watermarkDocument(form, watermarkOptions(settings, 6, null));
    expect(pdf.length).toBeGreaterThan(form.length);
  });
});
