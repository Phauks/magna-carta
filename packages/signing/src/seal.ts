// sealDocument — the orchestrator that turns a PDF and a host-side key into a sealed PDF.
//
// It threads the three concerns: the PDF engine reserves the signature structure and yields the
// bytes to sign; the CMS layer signs them host-side; the engine splices the CMS back in. The engine
// is injected (the `SealEngine` port) so this logic is provable without the WASM binding — the real
// adapter wraps `@magna-carta/pdf`. The signing key never leaves WebCrypto.

import type * as pkijs from "pkijs";

import { toArrayBuffer } from "./bytes.ts";
import { buildDetachedCms, type CmsHashAlgorithm } from "./cms.ts";
import type { ByteRange, PrepareSealOptions, SealEngine } from "./engine.ts";

export interface SealDocumentInput {
  /** The source PDF to seal. */
  readonly pdf: Uint8Array;
  /** The PDF-structure engine (real adapter over `@magna-carta/pdf`, or a test double). */
  readonly engine: SealEngine;
  /** The firm signing key — a non-extractable WebCrypto key held host-side. */
  readonly signingKey: CryptoKey;
  /** The signer certificate, DER-encoded or parsed, embedded in the CMS. */
  readonly certificate: Uint8Array | pkijs.Certificate;
  /** The signing time, caller-supplied so this stays clock-free. */
  readonly signingTime: Date;
  /** Optional signature-dictionary fields (reason/location/name/contents capacity). */
  readonly seal?: Omit<PrepareSealOptions, "signingTime">;
  /** Digest algorithm for the CMS. Defaults to SHA-256. */
  readonly hashAlgorithm?: CmsHashAlgorithm;
}

export interface SealDocumentResult {
  /** The sealed PDF: the input preserved as a prefix, with the CMS embedded in `/Contents`. */
  readonly sealedPdf: Uint8Array;
  /** Lowercase hex SHA-256 of the signed byte range — the association for the Certificate. */
  readonly documentHashSha256: string;
  /** The `/ByteRange` the seal covers. */
  readonly byteRange: ByteRange;
}

/** Format a `Date` as a PDF date string in UTC (`D:YYYYMMDDHHmmSSZ`). */
export function toPdfDate(date: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** Prepare, sign host-side, and embed — the full seal in one call. */
export async function sealDocument(input: SealDocumentInput): Promise<SealDocumentResult> {
  const prepared = await input.engine.prepare(input.pdf, {
    ...input.seal,
    signingTime: toPdfDate(input.signingTime),
  });

  const signedBytes = input.engine.signedBytes(prepared);

  const cmsDer = await buildDetachedCms({
    signedBytes,
    signingKey: input.signingKey,
    certificate: input.certificate,
    signingTime: input.signingTime,
    hashAlgorithm: input.hashAlgorithm,
  });

  const sealedPdf = await input.engine.embed(prepared, cmsDer);

  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(signedBytes)));

  return {
    sealedPdf,
    documentHashSha256: toHex(digest),
    byteRange: prepared.byteRange,
  };
}
