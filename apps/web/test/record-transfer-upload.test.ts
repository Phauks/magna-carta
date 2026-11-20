/*
 * How a source file is cut into pieces.
 *
 * The server takes every piece but the last at exactly the size it names, and joins them by
 * number, so the plan has to cover the file's every byte once, in order, with no empty piece.
 */
import { describe, expect, it } from "vitest";
import {
  planFilePieces,
  SINGLE_REQUEST_BYTE_CAP,
  SOURCE_FILE_BYTE_CAP,
  uploadRouteFor,
} from "../src/lib/record-transfer/file-upload-plan.ts";

const PIECE = 32 * 1024 * 1024;

describe("which way a file is sent", () => {
  it("sends a file at or under the single-request limit whole", () => {
    expect(uploadRouteFor(0)).toBe("single");
    expect(uploadRouteFor(SINGLE_REQUEST_BYTE_CAP)).toBe("single");
  });

  it("sends a larger file in pieces, up to the largest a run takes", () => {
    expect(uploadRouteFor(SINGLE_REQUEST_BYTE_CAP + 1)).toBe("pieces");
    expect(uploadRouteFor(SOURCE_FILE_BYTE_CAP)).toBe("pieces");
  });

  it("refuses a file over the largest a run takes", () => {
    expect(uploadRouteFor(SOURCE_FILE_BYTE_CAP + 1)).toBe("tooLarge");
  });
});

describe("the pieces a file is sent in", () => {
  it("numbers the pieces from 1 and makes every piece but the last the stated size", () => {
    const pieces = planFilePieces(PIECE * 2 + 5, PIECE);
    expect(pieces).toEqual([
      { partNumber: 1, start: 0, end: PIECE },
      { partNumber: 2, start: PIECE, end: PIECE * 2 },
      { partNumber: 3, start: PIECE * 2, end: PIECE * 2 + 5 },
    ]);
  });

  it("has no empty last piece when the size is a whole number of pieces", () => {
    const pieces = planFilePieces(PIECE * 3, PIECE);
    expect(pieces).toHaveLength(3);
    expect(pieces.at(-1)).toEqual({ partNumber: 3, start: PIECE * 2, end: PIECE * 3 });
  });

  it("covers every byte once, in order", () => {
    const size = PIECE * 4 + 12345;
    const pieces = planFilePieces(size, PIECE);
    expect(pieces[0]?.start).toBe(0);
    expect(pieces.at(-1)?.end).toBe(size);
    for (const [index, piece] of pieces.entries()) {
      expect(piece.end).toBeGreaterThan(piece.start);
      if (index > 0) expect(piece.start).toBe(pieces[index - 1]?.end);
    }
  });

  it("plans the largest file a run takes as 128 pieces", () => {
    const pieces = planFilePieces(SOURCE_FILE_BYTE_CAP, PIECE);
    expect(pieces).toHaveLength(128);
    expect(pieces.at(-1)?.end).toBe(SOURCE_FILE_BYTE_CAP);
  });

  it("is one short piece for a file smaller than a piece, and nothing for an empty file", () => {
    expect(planFilePieces(10, PIECE)).toEqual([{ partNumber: 1, start: 0, end: 10 }]);
    expect(planFilePieces(0, PIECE)).toEqual([]);
  });

  it("refuses a piece size that could never finish", () => {
    expect(() => planFilePieces(10, 0)).toThrow(RangeError);
    expect(() => planFilePieces(10, 1.5)).toThrow(RangeError);
  });
});
