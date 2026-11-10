import { describe, expect, it } from "vitest";
import type { FileId, MatterId } from "@magna-carta/identifiers/types";
import {
  encodeExtractedText,
  EXTRACTED_TEXT_FIRST_READ_BYTES,
  extractedTextObjectDimensions,
  extractedTextObjectKey,
  LONGEST_PASSAGE_READ_BYTES,
  readExtractedPassage,
  type ExtractedTextRangeReader,
} from "../src/extracted-text.ts";

// A reader over bytes held in memory that records every stretch it was asked for, so a test can say
// how many reads an answer cost. Each read against a firm's bucket is a billed operation and a
// tenth of a second of somebody's wait.
function readerOver(bytes: Uint8Array | null) {
  const reads: (readonly [number, number])[] = [];
  const read: ExtractedTextRangeReader = (offset, length) => {
    reads.push([offset, length]);
    return Promise.resolve(bytes === null ? null : bytes.subarray(offset, offset + length));
  };
  return { read, reads };
}

const page = (index: number, text: string) => ({ chunkId: `page-${index}`, text, page: index + 1 });

describe("where a version's text is kept", () => {
  it("derives the key from the file and the version, and from nothing that can change", () => {
    // Pinned byte for byte: every object already written is found by this key.
    expect(extractedTextObjectKey("file_abc" as FileId, 3)).toBe("extracted-text/file_abc/3");
  });

  it("stamps the object with its matter and its own class", () => {
    expect(extractedTextObjectDimensions("matter_abc" as MatterId)).toEqual({
      matter: "matter_abc",
      object_class: "extracted-text",
    });
  });
});

describe("reading one passage of a version's text", () => {
  it("answers a short document from one read", async () => {
    const bytes = encodeExtractedText([
      page(0, "The grantor conveys an easement."),
      page(1, "Señor Peña signed on the second page."),
    ]);
    const { read, reads } = readerOver(bytes);
    expect(await readExtractedPassage(read, "page-1")).toEqual({
      kind: "text",
      text: "Señor Peña signed on the second page.",
    });
    expect(reads).toEqual([[0, EXTRACTED_TEXT_FIRST_READ_BYTES]]);
  });

  it("takes one more read, of that passage alone, when it lies past the first stretch", async () => {
    const filler = "x".repeat(EXTRACTED_TEXT_FIRST_READ_BYTES);
    const bytes = encodeExtractedText([page(0, filler), page(1, "The words wanted.")]);
    const { read, reads } = readerOver(bytes);
    expect(await readExtractedPassage(read, "page-1")).toEqual({
      kind: "text",
      text: "The words wanted.",
    });
    expect(reads).toHaveLength(2);
    expect(reads[1]?.[1]).toBe("The words wanted.".length);
  });

  it("reads the rest of a directory longer than the first stretch", async () => {
    // Enough passages that naming them takes more than the first read holds.
    const passages = Array.from({ length: 6000 }, (_, index) => page(index, `Page ${index}.`));
    const bytes = encodeExtractedText(passages);
    const { read, reads } = readerOver(bytes);
    expect(await readExtractedPassage(read, "page-5999")).toEqual({
      kind: "text",
      text: "Page 5999.",
    });
    expect(reads.length).toBeLessThanOrEqual(3);
  });

  it("takes no more of a very long passage than its limit, and never half a character", async () => {
    // Two-byte letters, so the limit falls where it may split one.
    const long = `é${"é".repeat(LONGEST_PASSAGE_READ_BYTES)}`;
    const bytes = encodeExtractedText([{ chunkId: "whole", text: long }]);
    const { read } = readerOver(bytes);
    const outcome = await readExtractedPassage(read, "whole");
    expect(outcome.kind).toBe("text");
    if (outcome.kind !== "text") return;
    expect(outcome.text.length).toBe(LONGEST_PASSAGE_READ_BYTES / 2);
    expect(outcome.text).toMatch(/^é+$/u);
  });

  it("says a passage or an object that is not there is absent, which is not a fault", async () => {
    const bytes = encodeExtractedText([page(0, "Only page.")]);
    expect(await readExtractedPassage(readerOver(bytes).read, "page-7")).toEqual({
      kind: "absent",
    });
    expect(await readExtractedPassage(readerOver(null).read, "page-0")).toEqual({
      kind: "absent",
    });
  });

  it("says bytes that are not this format are malformed", async () => {
    const encoder = new TextEncoder();
    const outcomes = await Promise.all(
      [
        "short",
        "not a length\n{}",
        "0000000002\n{}",
        '0000000030\n{"format":2,"passages":[]}    ',
        "0000009999\n{",
      ].map((text) => readExtractedPassage(readerOver(encoder.encode(text)).read, "page-0")),
    );
    expect(outcomes).toEqual(outcomes.map(() => ({ kind: "malformed" })));
    expect(outcomes).toHaveLength(5);
  });

  it("keeps an empty passage and an empty document readable", async () => {
    const bytes = encodeExtractedText([page(0, ""), page(1, "After an empty page.")]);
    expect(await readExtractedPassage(readerOver(bytes).read, "page-0")).toEqual({
      kind: "text",
      text: "",
    });
    expect(await readExtractedPassage(readerOver(bytes).read, "page-1")).toEqual({
      kind: "text",
      text: "After an empty page.",
    });
    expect(await readExtractedPassage(readerOver(encodeExtractedText([])).read, "page-0")).toEqual({
      kind: "absent",
    });
  });

  it("answers a blank page past the first stretch without asking for a stretch of no bytes", async () => {
    const long = "x".repeat(EXTRACTED_TEXT_FIRST_READ_BYTES);
    const { read, reads } = readerOver(encodeExtractedText([page(0, long), page(1, "")]));
    expect(await readExtractedPassage(read, "page-1")).toEqual({ kind: "text", text: "" });
    expect(reads).toEqual([[0, EXTRACTED_TEXT_FIRST_READ_BYTES]]);
  });
});
