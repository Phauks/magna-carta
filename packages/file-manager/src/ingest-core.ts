import { fileTypeFromBuffer } from "file-type";
import type { MalwareScanPort } from "./scan-port.ts";
import { checkUploadPolicy, type UploadPolicy } from "./upload-policy.ts";
import { FileManagerValidationError } from "./validation.ts";

// crypto.DigestStream is a Cloudflare Workers extension absent from @types/node's Crypto. Reach it
// through a precisely-typed accessor; the real implementation is the workerd runtime's (exercised in
// the Workers pool, where streaming SHA-256 over a multi-GB object never buffers).
interface DigestStreamConstructor {
  new (algorithm: string): WritableStream<Uint8Array> & { readonly digest: Promise<ArrayBuffer> };
}
const DigestStream = (crypto as unknown as { DigestStream: DigestStreamConstructor }).DigestStream;

// The pure single-read ingest pipeline. The uploaded bytes are read ONCE: tee'd into a head-sniff
// branch, a hash+size branch (streaming SHA-256 via crypto.DigestStream — multi-GB objects must
// never buffer), and a scan-port branch. The outcome is commit (with the measured facts) or
// quarantine (a named, individually-tested reason). The Worker consumer is a thin shell around this.

// file-type needs only the head bytes (≤ 4 KiB) to sniff a magic-byte signature.
const SNIFF_BYTES = 4096;

export interface PendingVersionFacts {
  readonly declaredSize: number | null;
  readonly declaredContentType: string | null;
  readonly r2Key: string;
  // The real file name (the r2_key is opaque and extension-less), so the gate's extension blocklist
  // re-check runs against the name the client actually declared, not the key.
  readonly fileName: string;
}

export interface IngestInput {
  readonly objectBody: ReadableStream<Uint8Array>;
  readonly objectSize: number; // from R2 object metadata
  readonly version: PendingVersionFacts;
  readonly policy: UploadPolicy; // re-checked against the real bytes
  readonly scanPort: MalwareScanPort;
}

export type QuarantineReason =
  | "type-mismatch"
  | "size-mismatch"
  | "policy-size"
  | "policy-type"
  | "scan-infected";

export type IngestOutcome =
  | {
      kind: "commit";
      sizeBytes: number;
      sniffedContentType: string | null;
      contentSha256: string;
      scanVerdict: "unscanned" | "clean";
      scanEngineVersion: string | null;
    }
  | { kind: "quarantine"; reason: QuarantineReason };

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sniffHead(stream: ReadableStream<Uint8Array>): Promise<string | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < SNIFF_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const head = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    head.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const result = await fileTypeFromBuffer(head);
  return result?.mime ?? null;
}

async function hashAndCount(
  stream: ReadableStream<Uint8Array>,
): Promise<{ hash: string; size: number }> {
  let size = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const digestStream = new DigestStream("SHA-256");
  await stream.pipeThrough(counter).pipeTo(digestStream);
  const digest = await digestStream.digest;
  return { hash: toHex(digest), size };
}

export async function runIngest(input: IngestInput): Promise<IngestOutcome> {
  const [headStream, bodyStream] = input.objectBody.tee();
  const sniffedContentType = await sniffHead(headStream);
  const [hashStream, scanStream] = bodyStream.tee();
  const [scan, hashed] = await Promise.all([
    input.scanPort.scan(scanStream, {
      sizeBytes: input.objectSize,
      sniffedContentType,
    }),
    hashAndCount(hashStream),
  ]);

  // The streamed byte count must match the object's metadata, and (when declared) the declared size —
  // tolerance is exact. A mismatch means truncation or a lie.
  if (hashed.size !== input.objectSize) return { kind: "quarantine", reason: "size-mismatch" };
  if (input.version.declaredSize !== null && input.objectSize !== input.version.declaredSize) {
    return { kind: "quarantine", reason: "size-mismatch" };
  }
  // A declared content type contradicted by the sniffed magic bytes is a lie.
  if (
    sniffedContentType !== null &&
    input.version.declaredContentType !== null &&
    sniffedContentType !== input.version.declaredContentType
  ) {
    return { kind: "quarantine", reason: "type-mismatch" };
  }
  // Re-enforce the policy against the REAL size, the sniffed type, and the declared file name (a
  // declared lie cannot smuggle a blocked type or a blocked extension past the gate).
  try {
    checkUploadPolicy(input.policy, {
      sizeBytes: input.objectSize,
      contentType: sniffedContentType,
      fileName: input.version.fileName,
    });
  } catch (error) {
    if (error instanceof FileManagerValidationError) {
      if (error.code === "upload-policy-size") return { kind: "quarantine", reason: "policy-size" };
      if (error.code === "upload-policy-type") return { kind: "quarantine", reason: "policy-type" };
    }
    throw error;
  }
  if (scan.verdict === "infected") return { kind: "quarantine", reason: "scan-infected" };
  // An `unscanned` verdict commits (explicit-unscanned policy); `clean` commits too.
  // `suspicious` is handled as unscanned for now (commits the version but flagged for review).
  if (scan.verdict === "clean" || scan.verdict === "unscanned" || scan.verdict === "suspicious") {
    return {
      kind: "commit",
      sizeBytes: input.objectSize,
      sniffedContentType,
      contentSha256: hashed.hash,
      scanVerdict: scan.verdict === "clean" ? "clean" : "unscanned",
      scanEngineVersion: scan.engineVersion,
    };
  }
  // Exhaustiveness check: if TypeScript reaches here, scan is not one of the expected variants.
  const _exhaustiveness: never = scan;
  return _exhaustiveness;
}
