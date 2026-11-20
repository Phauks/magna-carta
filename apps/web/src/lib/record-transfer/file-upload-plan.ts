/*
 * How a source file is sent: in one request, or in pieces.
 *
 * A file at or under the single-request limit goes up whole. A larger one is cut into pieces of
 * the size the server names, every piece that size but the last, numbered from 1. A file over the
 * largest size a run takes is not sent at all.
 *
 * Pure, and imports nothing from the app, so it is tested without a browser.
 */

/** The largest file one request takes. */
export const SINGLE_REQUEST_BYTE_CAP = 32 * 1024 * 1024;

/** The largest file a run takes, however it is sent. */
export const SOURCE_FILE_BYTE_CAP = 4 * 1024 * 1024 * 1024;

/** How many times one piece is sent again after it fails, before the upload gives up. */
export const PIECE_RETRY_LIMIT = 2;

export type UploadRoute = "single" | "pieces" | "tooLarge";

export function uploadRouteFor(byteLength: number): UploadRoute {
  if (byteLength > SOURCE_FILE_BYTE_CAP) return "tooLarge";
  return byteLength > SINGLE_REQUEST_BYTE_CAP ? "pieces" : "single";
}

/** One piece of a file: its number, and the bytes it is, as `Blob.slice` takes them. */
export interface FilePiece {
  readonly partNumber: number;
  /** The first byte of the piece. */
  readonly start: number;
  /** One past the last byte of the piece. */
  readonly end: number;
}

/**
 * The pieces a file of a size is sent in. Every piece is `pieceBytes` long but the last, which is
 * whatever is left and never empty. A file with no bytes has no pieces.
 */
export function planFilePieces(byteLength: number, pieceBytes: number): readonly FilePiece[] {
  if (!Number.isInteger(pieceBytes) || pieceBytes <= 0) {
    throw new RangeError("a piece has a whole, positive number of bytes");
  }
  const pieces: FilePiece[] = [];
  for (let start = 0; start < byteLength; start += pieceBytes) {
    pieces.push({
      partNumber: pieces.length + 1,
      start,
      end: Math.min(start + pieceBytes, byteLength),
    });
  }
  return pieces;
}
