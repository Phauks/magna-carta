import { fileTypeFromBuffer } from "file-type";
import { contentTypesAgree } from "./content-type-equivalence.ts";
import type { MalwareScanPort, RawScanResult } from "./scan-port.ts";
import {
  computeVerdict,
  ScanFaultError,
  scanDetailFor,
  type FileVerdict,
  type ScanPolicy,
} from "./verdict.ts";
import type { FlaggedTreatment } from "./scan-policy-settings.ts";
import {
  checkUploadPolicy,
  IN_MEMORY_INSPECTION_CEILING_BYTES,
  type UploadPolicy,
} from "./upload-policy.ts";
import { FileManagerValidationError } from "./validation.ts";

// crypto.DigestStream is a Cloudflare Workers extension absent from @types/node's Crypto. Reach it
// through a precisely-typed accessor; the real implementation is the workerd runtime's (exercised in
// the Workers pool, where streaming SHA-256 over a multi-GB object never buffers).
interface DigestStreamConstructor {
  new (algorithm: string): WritableStream<Uint8Array> & { readonly digest: Promise<ArrayBuffer> };
}
const DigestStream = (crypto as unknown as { DigestStream: DigestStreamConstructor }).DigestStream;

// The pure single-read ingest pipeline. The uploaded bytes are read ONCE, off a short tee whose head
// branch takes the magic-byte sniff (≤ 4 KiB, then cancelled). What happens to the rest depends on
// the inspectable-size cap: past it, nothing but the digest consumes the body, so it streams straight
// into crypto.DigestStream and a multi-GB object never buffers; within it, the body feeds both the
// digest and the scan port, so it is read into memory once and both are fed from that — the cap
// bounds what that costs, and a second tee would have buffered the same bytes anyway without
// bounding anything. The cap is never more than IN_MEMORY_INSPECTION_CEILING_BYTES (upload-policy.ts),
// whatever the caller passes, because it is the only thing standing between a large object and an
// out-of-memory isolate. The outcome is commit (with the measured facts) or quarantine (a named,
// individually-tested reason). The Worker consumer is a thin shell around this.

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
  // Files larger than this cap bypass the scan engine and commit as unscanned/oversize — a large
  // legitimate file is not suspicious for being big. The consumer passes the firm's setting
  // (readInspectableSizeCap); runIngest bounds it by IN_MEMORY_INSPECTION_CEILING_BYTES regardless,
  // since a value past that would buffer more than a Worker isolate holds.
  readonly inspectableSizeCap: number;
  // Firm-level scan policy: controls which YARA tiers and suspicious score floors trigger a flag.
  readonly scanPolicy: ScanPolicy;
  // How a flagged file is handled at ingest: quarantine it ("block"), or commit it marked flagged
  // so downstream access logic can gate or display it ("informed-access" | "allow-and-flag").
  readonly flaggedTreatment: FlaggedTreatment;
}

export type QuarantineReason =
  | "type-mismatch"
  | "size-mismatch"
  | "policy-size"
  | "policy-type"
  | "scan-flagged";

export type IngestOutcome =
  | {
      kind: "commit";
      sizeBytes: number;
      sniffedContentType: string | null;
      contentSha256: string;
      scanVerdict: "unscanned" | "clean" | "flagged";
      scanEngineVersion: string | null;
      scanDetail: string | null;
      // The full raw scan result behind this commit, threaded to the commit so the content-dedup cache
      // is populated atomically on a clean commit (the "scan-once" dedup). null when no engine ran (the
      // oversize short-circuit); the cache is only written for a real-engine clean verdict, and the
      // cache key + the stamped engine version both derive from this result's `engineVersion`.
      rawScanResult: RawScanResult | null;
    }
  | { kind: "quarantine"; reason: QuarantineReason; scanDetail: string | null };

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

// Reads a body into memory ONCE, digesting it as it arrives, and stops the moment it grows past
// `expectedSize` bytes. Returns null when the body is not exactly that long — the same judgment the
// streaming lane reaches from its byte count, made before any of those bytes are handed to a consumer.
//
// The buffer is allocated at the reported size up front and each chunk is copied straight into it, so
// the peak is the object plus one chunk: collecting the chunks and concatenating them afterwards would
// hold every byte twice at the moment of the copy, and a one-shot digest over the finished buffer may
// copy it a third time on its way into the runtime. The bound is what keeps the read honest: the caller
// only reaches here for an object the inspectable-size cap admits, so the allocation is at most the cap,
// and a body longer than its reported size is refused before it can overrun it.
async function readWholeBodyAndDigest(
  stream: ReadableStream<Uint8Array>,
  expectedSize: number,
): Promise<{ readonly body: Uint8Array; readonly contentSha256: string } | null> {
  const body = new Uint8Array(expectedSize);
  const digestStream = new DigestStream("SHA-256");
  const digestWriter = digestStream.getWriter();
  const reader = stream.getReader();
  let total = 0;
  let complete = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > expectedSize) return null;
      body.set(value, total);
      total += value.byteLength;
      // The chunk has already been copied into the buffer, so the digest may take ownership of it.
      await digestWriter.write(value);
    }
    if (total !== expectedSize) return null;
    await digestWriter.close();
    complete = true;
  } finally {
    await reader.cancel().catch(() => {});
    if (!complete) {
      // Aborting rejects the digest promise, and nothing will ever await it on this path.
      digestStream.digest.catch(() => {});
      await digestWriter.abort().catch(() => {});
    }
  }
  return { body, contentSha256: toHex(await digestStream.digest) };
}

function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

// The measured identity of a stored object: the streaming SHA-256 of its bytes and how many there
// were. This is the same measurement `runIngest` records on a commit, exposed on its own for the
// custody re-verification the ingest consumer runs when an object-create event lands on an
// ALREADY-COMMITTED version — the committed row asserts a hash, and the only way to know the stored
// bytes still match it is to measure them again. Streaming, so a multi-GB object never buffers.
export interface ContentMeasurement {
  readonly contentSha256: string;
  readonly sizeBytes: number;
}

export async function measureContent(
  objectBody: ReadableStream<Uint8Array>,
): Promise<ContentMeasurement> {
  const { hash, size } = await hashAndCount(objectBody);
  return { contentSha256: hash, sizeBytes: size };
}

export async function runIngest(input: IngestInput): Promise<IngestOutcome> {
  const [headStream, bodyStream] = input.objectBody.tee();
  const sniffedContentType = await sniffHead(headStream);

  // Files past the scanner's inspectable cap are benign-uninspectable: commit as `unscanned`/oversize
  // and never stream them to the engine (a large legitimate file is not suspicious for being big). The
  // cap the caller passes is bounded by the in-memory ceiling here as well as where the firm setting is
  // read, because the lane below holds the whole object: a value past the ceiling is an out-of-memory
  // on every delivery, and the version would never commit at all.
  const inspectableSizeCap = Math.min(input.inspectableSizeCap, IN_MEMORY_INSPECTION_CEILING_BYTES);
  if (input.objectSize > inspectableSizeCap) {
    // Nothing else consumes the body on this branch — the scan port is skipped entirely — so the
    // remaining stream goes straight to the hash. Teeing it only to cancel one side would make
    // workerd buffer the unread branch for no reader.
    const hashed = await hashAndCount(bodyStream);
    if (hashed.size !== input.objectSize)
      return { kind: "quarantine", reason: "size-mismatch", scanDetail: null };
    return {
      kind: "commit",
      sizeBytes: input.objectSize,
      sniffedContentType,
      contentSha256: hashed.hash,
      scanVerdict: "unscanned",
      scanEngineVersion: null,
      scanDetail: "oversize",
      rawScanResult: null, // the engine never ran — nothing to cache
    };
  }

  // Under the cap the bytes feed two consumers — the hash and the scan port — and a tee does not
  // couple them: whichever side reads faster runs ahead, and the runtime holds every chunk the slower
  // side has not taken yet, so the whole body ends up buffered regardless. A scan port that never
  // reads its stream buffers all of it. Since that buffer is unavoidable here, take it deliberately:
  // read the body once and feed both consumers from it. The cap is what makes that sound — this branch
  // runs only for an object the inspectable-size cap admits, and readWholeBodyAndDigest stops the
  // moment the body exceeds the size R2 reported, so neither a huge object nor a lying object size can
  // grow the buffer past the cap. The over-cap lane above is the one that must never buffer, and it
  // does not: it streams straight into the digest.
  const read = await readWholeBodyAndDigest(bodyStream, input.objectSize);
  // The byte count must match the object's metadata exactly — a mismatch means truncation or a lie —
  // and readWholeBodyAndDigest already refused anything else.
  if (read === null) return { kind: "quarantine", reason: "size-mismatch", scanDetail: null };
  const { body, contentSha256 } = read;
  const raw = await input.scanPort.scan(streamFromBytes(body), {
    sizeBytes: input.objectSize,
    sniffedContentType,
    // The storage key is stable per version, so a redelivered ingest scans on the same engine
    // instance as the first attempt.
    contentKey: input.version.r2Key,
  });

  // The declared size, when the client gave one, must match too.
  if (input.version.declaredSize !== null && input.objectSize !== input.version.declaredSize) {
    return { kind: "quarantine", reason: "size-mismatch", scanDetail: null };
  }
  // A declared content type contradicted by the sniffed magic bytes is a lie. "Contradicted" is not
  // string inequality: a magic-byte sniff names the CONTAINER, so a legacy Word document declared
  // `application/msword` honestly sniffs as `application/x-cfb`. content-type-equivalence.ts holds the
  // named container relationships; every pair outside it still disagrees and still quarantines.
  if (!contentTypesAgree(sniffedContentType, input.version.declaredContentType)) {
    return { kind: "quarantine", reason: "type-mismatch", scanDetail: null };
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
      if (error.code === "upload-policy-size")
        return { kind: "quarantine", reason: "policy-size", scanDetail: null };
      if (error.code === "upload-policy-type")
        return { kind: "quarantine", reason: "policy-type", scanDetail: null };
    }
    throw error;
  }
  let fileVerdict: FileVerdict;
  try {
    fileVerdict = computeVerdict(raw, input.scanPolicy);
  } catch (error) {
    if (error instanceof ScanFaultError) throw error; // retryable — never commit
    throw error;
  }
  if (fileVerdict.verdict === "flagged") {
    if (input.flaggedTreatment === "block")
      return { kind: "quarantine", reason: "scan-flagged", scanDetail: fileVerdict.reason };
    // informed-access | allow-and-flag — commit the version marked flagged so downstream access
    // logic can gate or display it. The raw result carries through so the scan-once dedup cache
    // is still populated (same as the clean-commit path).
    return {
      kind: "commit",
      sizeBytes: input.objectSize,
      sniffedContentType,
      contentSha256,
      scanVerdict: "flagged",
      scanEngineVersion: raw.engineVersion,
      // Through the shared decision even though a flagged verdict's detail is its reason and nothing
      // else: the two spellings agree today, and a spelled-out copy is what lets them stop agreeing
      // the first time the shared one learns to prefix, truncate, or redact.
      scanDetail: scanDetailFor(fileVerdict),
      rawScanResult: raw,
    };
  }
  return {
    kind: "commit",
    sizeBytes: input.objectSize,
    sniffedContentType,
    contentSha256,
    scanVerdict: fileVerdict.verdict === "clean" ? "clean" : "unscanned",
    // Both the committed `scan_engine_version` and the dedup-cache key derive from the SAME honest
    // source — the raw result's `engineVersion` — so a clean commit always repopulates the cache under
    // the exact engine version it stamps (the scan-once dedup the re-scan path reuses).
    scanEngineVersion: raw.engineVersion,
    scanDetail: scanDetailFor(fileVerdict),
    rawScanResult: raw,
  };
}
