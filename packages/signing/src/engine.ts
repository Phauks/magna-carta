// The seal-engine port — the boundary between the product layer and the PDF byte surgery.
//
// The pure-Rust pdf-core engine owns the PDF structure: it appends a prefix-preserving incremental
// update carrying the signature dictionary, computes the exact `/ByteRange`, reserves the
// `/Contents` gap, and later splices the CMS in. This interface is that engine's shape, so the
// product layer (sealDocument) depends on the contract, not the WASM binding — the real adapter
// wraps `@magna-carta/pdf`, and tests substitute a faithful in-memory engine.

/** The four-element `/ByteRange`: `[0, gapStart, gapEnd, suffixLength]`. */
export type ByteRange = readonly [number, number, number, number];

/** A document made ready for signing: the incremental-updated bytes, the range, and the gap. */
export interface PreparedSeal {
  /** The full PDF with the signature structure appended and a zero-filled `/Contents`. */
  readonly document: Uint8Array;
  /** The `/ByteRange` written into the document; the signed bytes are the two spans it names. */
  readonly byteRange: ByteRange;
  /** The half-open byte span of the reserved hex digits (strictly between the `<` and `>`). */
  readonly contentsSpan: readonly [number, number];
}

/** Signature-dictionary fields the engine writes. Times are PDF date strings (`D:YYYYMMDDHHmmSS`). */
export interface PrepareSealOptions {
  readonly name?: string;
  readonly reason?: string;
  readonly location?: string;
  readonly contactInfo?: string;
  readonly signingTime?: string;
  /** Bytes reserved for the CMS; the `/Contents` hex is twice this. Defaults to the engine's own. */
  readonly contentsCapacity?: number;
  /** A box drawn on the page that shows the signature. Omit to sign invisibly. */
  readonly appearance?: SealAppearance;
}

/**
 * A visible signature: a bordered box holding lines of text, drawn inside the signed revision so
 * its text cannot be changed afterwards without breaking the signature.
 */
export interface SealAppearance {
  /** The 0-based page the box is drawn on. */
  readonly page: number;
  /** The box in points, `[left, bottom, right, top]`, from the page's bottom-left corner. */
  readonly rect: readonly [number, number, number, number];
  /** The text, one entry per line. The engine reads no clock: the caller writes the time. */
  readonly lines: readonly string[];
}

/** The PDF-structure operations the seal needs, matching pdf-core `prepare`/`signedBytes`/`embed`. */
export interface SealEngine {
  /** Append the signature structure and reserve `/Contents`, preserving the input as a prefix. */
  prepare(pdf: Uint8Array, options: PrepareSealOptions): Promise<PreparedSeal>;
  /** The bytes a signer must digest: everything the `/ByteRange` covers (the gap cut out). */
  signedBytes(prepared: PreparedSeal): Uint8Array;
  /** Splice the CMS into the reserved gap without disturbing a signed byte. */
  embed(prepared: PreparedSeal, cmsDer: Uint8Array): Promise<Uint8Array>;
}
