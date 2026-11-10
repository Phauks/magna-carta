import { runIngest, type IngestInput } from "@magna-carta/file-manager/ingest-core";
import type {
  MalwareScanPort,
  RawScanResult,
  RuleMatch,
} from "@magna-carta/file-manager/scan-port";
import { unscannedAdapter } from "@magna-carta/file-manager/scan-port";
import type { UploadPolicy } from "@magna-carta/file-manager/upload-policy";
import {
  DEFAULT_UPLOAD_POLICY,
  IN_MEMORY_INSPECTION_CEILING_BYTES,
} from "@magna-carta/file-manager/upload-policy";
import { DEFAULT_SCAN_POLICY, type ScanPolicy } from "@magna-carta/file-manager/verdict";
import type { FlaggedTreatment } from "@magna-carta/file-manager/scan-policy-settings";
import { describe, expect, it } from "vitest";

// The ingest core uses crypto.DigestStream (a Workers-runtime API), so it is exercised here in the
// Miniflare pool where that API exists, rather than in @magna-carta/file-manager's node test run.

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

const POLICY: UploadPolicy = {
  maxSizeBytes: 1000,
  allowedContentTypes: ["application/pdf", "text/*"],
  blockedExtensions: [],
};

// A minimal but real PDF header — file-type sniffs application/pdf from the "%PDF-" magic bytes.
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");
// The OLE2 compound-file header every pre-2007 Office document starts with (.doc/.xls/.ppt/.msg all
// share it) — file-type can therefore only ever sniff it as application/x-cfb.
const COMPOUND_FILE_BYTES = (() => {
  const bytes = new Uint8Array(512);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  return bytes;
})();
// SHA-256 of the ASCII string "hello".
const HELLO = new TextEncoder().encode("hello");
const HELLO_SHA256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

function input(bytes: Uint8Array, overrides: Partial<IngestInput> = {}): IngestInput {
  return {
    objectBody: streamOf(bytes),
    objectSize: bytes.byteLength,
    version: {
      declaredSize: bytes.byteLength,
      declaredContentType: "application/pdf",
      r2Key: "files/a/v1",
      fileName: "doc.pdf",
    },
    policy: POLICY,
    scanPort: unscannedAdapter,
    inspectableSizeCap: 2 * 1024 * 1024 * 1024,
    scanPolicy: DEFAULT_SCAN_POLICY,
    flaggedTreatment: "block",
    ...overrides,
  };
}

describe("runIngest", () => {
  it("computes the streaming SHA-256 and commits an unscanned version", async () => {
    const outcome = await runIngest(
      input(HELLO, {
        version: {
          declaredSize: HELLO.byteLength,
          declaredContentType: "text/plain",
          r2Key: "files/a/v1",
          fileName: "hello.txt",
        },
      }),
    );
    expect(outcome).toEqual({
      kind: "commit",
      sizeBytes: HELLO.byteLength,
      sniffedContentType: null, // "hello" has no magic-byte signature
      contentSha256: HELLO_SHA256,
      scanVerdict: "unscanned",
      scanEngineVersion: null,
      scanDetail: "no-engine",
      // The engine-less launch adapter's raw facts ride along on the commit outcome; with a null
      // engineVersion the commit never writes the dedup cache.
      rawScanResult: {
        engineVersion: null,
        clam: { state: "unavailable" },
        heuristic: { kind: "none" },
        matches: [],
        timings: { clamdMs: 0, yaraMs: 0 },
      },
    });
  });

  it("sniffs the content type from magic bytes and commits a matching declared type", async () => {
    const outcome = await runIngest(input(PDF_BYTES));
    expect(outcome.kind).toBe("commit");
    if (outcome.kind === "commit") expect(outcome.sniffedContentType).toBe("application/pdf");
  });

  it("quarantines a declared-type lie (sniffed disagrees)", async () => {
    const outcome = await runIngest(
      input(PDF_BYTES, {
        version: {
          declaredSize: PDF_BYTES.byteLength,
          declaredContentType: "text/plain",
          r2Key: "files/a/v1",
          fileName: "doc.pdf",
        },
      }),
    );
    expect(outcome).toEqual({ kind: "quarantine", reason: "type-mismatch", scanDetail: null });
  });

  it("commits a legacy Office document declared as msword and sniffed as the compound-file container", async () => {
    // Every pre-2007 Office file is a compound file: the sniffer can only report application/x-cfb,
    // while the browser declares application/msword from the .doc extension. Byte-exact comparison
    // read that as a lie and quarantined an ordinary Word document.
    const outcome = await runIngest(
      input(COMPOUND_FILE_BYTES, {
        policy: { ...POLICY, allowedContentTypes: ["application/x-cfb"] },
        version: {
          declaredSize: COMPOUND_FILE_BYTES.byteLength,
          declaredContentType: "application/msword",
          r2Key: "files/a/v1",
          fileName: "pleading.doc",
        },
      }),
    );
    expect(outcome.kind).toBe("commit");
    if (outcome.kind === "commit") expect(outcome.sniffedContentType).toBe("application/x-cfb");
  });

  it("commits a legacy Outlook message declared with a capital-letter content type", async () => {
    // The comparison normalizes case and parameters before deciding — a declaration that differs only
    // in spelling is not a contradiction.
    const outcome = await runIngest(
      input(COMPOUND_FILE_BYTES, {
        policy: { ...POLICY, allowedContentTypes: ["application/x-cfb"] },
        version: {
          declaredSize: COMPOUND_FILE_BYTES.byteLength,
          declaredContentType: "Application/vnd.MS-Outlook; charset=binary",
          r2Key: "files/a/v1",
          fileName: "opposing-counsel.msg",
        },
      }),
    );
    expect(outcome.kind).toBe("commit");
  });

  it("still quarantines a compound file declared as something that is not one", async () => {
    // The equivalence table is an allow-list of container relationships, not a general loosening: a
    // genuine contradiction is still a lie.
    const outcome = await runIngest(
      input(COMPOUND_FILE_BYTES, {
        policy: { ...POLICY, allowedContentTypes: ["application/x-cfb", "application/pdf"] },
        version: {
          declaredSize: COMPOUND_FILE_BYTES.byteLength,
          declaredContentType: "application/pdf",
          r2Key: "files/a/v1",
          fileName: "not-really.pdf",
        },
      }),
    );
    expect(outcome).toEqual({ kind: "quarantine", reason: "type-mismatch", scanDetail: null });
  });

  it("quarantines an object larger than the policy maximum", async () => {
    const big = new Uint8Array(2000);
    big.set(PDF_BYTES, 0);
    const outcome = await runIngest(
      input(big, {
        version: {
          declaredSize: null,
          declaredContentType: "application/pdf",
          r2Key: "files/a/v1",
          fileName: "doc.pdf",
        },
      }),
    );
    expect(outcome).toEqual({ kind: "quarantine", reason: "policy-size", scanDetail: null });
  });

  it("quarantines a size mismatch between the stream and the object metadata", async () => {
    const outcome = await runIngest(input(PDF_BYTES, { objectSize: PDF_BYTES.byteLength + 1 }));
    expect(outcome).toEqual({ kind: "quarantine", reason: "size-mismatch", scanDetail: null });
  });

  it("quarantines a blocked file extension via the live name re-check (the r2_key has none)", async () => {
    const outcome = await runIngest(
      input(PDF_BYTES, {
        // The opaque r2_key carries no extension; the real file name does — the gate re-checks the
        // name, so a blocked extension is caught even when the bytes sniff as an allowed type.
        policy: { ...POLICY, blockedExtensions: [".exe"] },
        version: {
          declaredSize: PDF_BYTES.byteLength,
          declaredContentType: "application/pdf",
          r2Key: "files/a/v1",
          fileName: "payload.exe",
        },
      }),
    );
    expect(outcome).toEqual({ kind: "quarantine", reason: "policy-type", scanDetail: null });
  });

  it("quarantines a flagged upload with the reason text (infected raw)", async () => {
    const infectedPort: MalwareScanPort = {
      async scan(body) {
        await body.cancel();
        return {
          engineVersion: "test-engine-1",
          clam: { state: "infected", signature: "Eicar-Test-Signature" },
          heuristic: { kind: "none" },
          matches: [],
          timings: { clamdMs: 1, yaraMs: 1 },
        };
      },
    };
    const outcome = await runIngest(input(PDF_BYTES, { scanPort: infectedPort }));
    expect(outcome).toEqual({
      kind: "quarantine",
      reason: "scan-flagged",
      scanDetail: "Eicar-Test-Signature",
    });
  });
});

// A body delivered as `chunkCount` chunks of `chunkSize`, counting how many the pipeline pulls.
function chunkedBody(
  chunkSize: number,
  chunkCount: number,
): { stream: ReadableStream<Uint8Array>; pulls: () => number } {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled === chunkCount) {
        controller.close();
        return;
      }
      const chunk = new Uint8Array(chunkSize);
      if (pulled === 0) chunk.set(PDF_BYTES, 0); // the first chunk carries the magic bytes
      pulled += 1;
      controller.enqueue(chunk);
    },
  });
  return { stream, pulls: () => pulled };
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return all;
}

// The sub-cap lane feeds two consumers (the digest and the scan port) from ONE read of the body: the
// bytes are read into memory once, bounded by the inspectable-size cap, rather than tee'd — a tee
// couples nothing, so the faster consumer runs ahead and the runtime buffers the whole body for the
// slower one anyway, with no bound of its own.
describe("runIngest sub-cap body handling", () => {
  it("hands the scan port exactly the bytes the digest covered", async () => {
    let scanned: Uint8Array | null = null;
    const port: MalwareScanPort = {
      async scan(body) {
        scanned = await drain(body);
        return {
          engineVersion: "e1",
          clam: { state: "clean" },
          heuristic: { kind: "none" },
          matches: [],
          timings: { clamdMs: 1, yaraMs: 1 },
        };
      },
    };
    const outcome = await runIngest(
      input(HELLO, {
        scanPort: port,
        policy: POLICY,
        version: {
          declaredSize: HELLO.byteLength,
          declaredContentType: "text/plain",
          r2Key: "files/a/v1",
          fileName: "hello.txt",
        },
      }),
    );
    expect(outcome).toMatchObject({ kind: "commit", contentSha256: HELLO_SHA256 });
    // The scan port saw the whole body — the same bytes the recorded hash describes.
    expect(scanned === null ? null : [...(scanned as Uint8Array)]).toEqual([...HELLO]);
  });

  it("still commits when the scan port never reads the body it is handed", async () => {
    // The pathological consumer the old tee was worst for: one side reads nothing at all.
    const outcome = await runIngest(
      input(HELLO, {
        scanPort: {
          scan: async () => ({
            engineVersion: "e1",
            clam: { state: "clean" },
            heuristic: { kind: "none" },
            matches: [],
            timings: { clamdMs: 1, yaraMs: 1 },
          }),
        },
        version: {
          declaredSize: HELLO.byteLength,
          declaredContentType: "text/plain",
          r2Key: "files/a/v1",
          fileName: "hello.txt",
        },
      }),
    );
    expect(outcome).toMatchObject({
      kind: "commit",
      scanVerdict: "clean",
      contentSha256: HELLO_SHA256,
    });
  });

  it("stops reading a body that runs past the size R2 reported", async () => {
    // 8 chunks on offer, but the object metadata claims one chunk's worth. The read must refuse as
    // soon as it passes that, not drain the stream — that bound is what keeps the buffer under the
    // inspectable-size cap even when the reported size is a lie.
    const chunkSize = 8192;
    const { stream, pulls } = chunkedBody(chunkSize, 8);
    const outcome = await runIngest(
      input(PDF_BYTES, {
        objectBody: stream,
        objectSize: chunkSize,
        version: {
          declaredSize: chunkSize,
          declaredContentType: "application/pdf",
          r2Key: "files/a/v1",
          fileName: "doc.pdf",
        },
      }),
    );
    expect(outcome).toEqual({ kind: "quarantine", reason: "size-mismatch", scanDetail: null });
    // One chunk satisfies the head sniff and the claimed size; the next one blows the bound and ends
    // the read. Nothing near the eight chunks the stream would have handed over.
    expect(pulls()).toBeLessThanOrEqual(3);
  });
});

function hexOf(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// The bytes chunkedBody hands over, assembled — the expected digest is computed over these.
function chunkedBytes(chunkSize: number, chunkCount: number): Uint8Array<ArrayBuffer> {
  const all = new Uint8Array(chunkSize * chunkCount);
  all.set(PDF_BYTES, 0);
  return all;
}

// The in-memory lane allocates the body at its reported size and digests it as it fills, so a body
// spread over many chunks must come out with exactly the hash of the bytes in order, and a body that
// stops short of its reported size must be refused rather than committed with a zero-filled tail.
describe("runIngest in-memory lane over many chunks", () => {
  it("records the digest of every chunk in order", async () => {
    const chunkSize = 8192;
    const { stream } = chunkedBody(chunkSize, 6);
    const expected = hexOf(await crypto.subtle.digest("SHA-256", chunkedBytes(chunkSize, 6)));
    const outcome = await runIngest(
      input(PDF_BYTES, {
        objectBody: stream,
        objectSize: chunkSize * 6,
        version: {
          declaredSize: chunkSize * 6,
          declaredContentType: "application/pdf",
          r2Key: "files/a/v1",
          fileName: "doc.pdf",
        },
        policy: { ...POLICY, maxSizeBytes: chunkSize * 6 },
      }),
    );
    expect(outcome).toMatchObject({ kind: "commit", contentSha256: expected });
  });

  it("refuses a body shorter than the size R2 reported", async () => {
    const chunkSize = 8192;
    const { stream } = chunkedBody(chunkSize, 2);
    const outcome = await runIngest(
      input(PDF_BYTES, {
        objectBody: stream,
        objectSize: chunkSize * 3,
        version: {
          declaredSize: chunkSize * 3,
          declaredContentType: "application/pdf",
          r2Key: "files/a/v1",
          fileName: "doc.pdf",
        },
      }),
    );
    expect(outcome).toEqual({ kind: "quarantine", reason: "size-mismatch", scanDetail: null });
  });
});

// A Worker isolate has 128 MB, so the in-memory lane is bounded by a ceiling of tens of MiB whatever
// cap the caller passes. An object past it — an hour of meeting audio is about 345 MB — must stream
// through the digest and commit as unscanned/oversize, never reach the lane that holds it whole.
describe("runIngest over the in-memory inspection ceiling", () => {
  it("streams an object above the ceiling to an oversize commit even when the firm cap is higher", async () => {
    const chunkSize = 1024 * 1024;
    const chunkCount = IN_MEMORY_INSPECTION_CEILING_BYTES / chunkSize + 1;
    const size = chunkSize * chunkCount;
    const { stream, pulls } = chunkedBody(chunkSize, chunkCount);
    const expected = hexOf(
      await crypto.subtle.digest("SHA-256", chunkedBytes(chunkSize, chunkCount)),
    );
    let scanCalled = false;
    const outcome = await runIngest(
      input(PDF_BYTES, {
        objectBody: stream,
        objectSize: size,
        version: {
          declaredSize: size,
          declaredContentType: "audio/wav",
          r2Key: "files/a/v1",
          fileName: "recording.wav",
        },
        // A firm cap far above the ceiling: the stored value from before the ceiling existed. The
        // in-memory lane would have been taken on the strength of it.
        inspectableSizeCap: 2 * 1024 * 1024 * 1024,
        scanPort: {
          scan: () => {
            scanCalled = true;
            return Promise.reject(new Error("an oversize object must never reach the scan port"));
          },
        },
      }),
    );
    expect(scanCalled).toBe(false);
    expect(outcome).toEqual({
      kind: "commit",
      sizeBytes: size,
      sniffedContentType: "application/pdf",
      contentSha256: expected,
      scanVerdict: "unscanned",
      scanEngineVersion: null,
      scanDetail: "oversize",
      rawScanResult: null,
    });
    // Every chunk was read, by the digest alone.
    expect(pulls()).toBe(chunkCount);
  });

  it("still inspects an object exactly at the cap", async () => {
    let scannedBytes = 0;
    const outcome = await runIngest(
      input(HELLO, {
        inspectableSizeCap: HELLO.byteLength,
        version: {
          declaredSize: HELLO.byteLength,
          declaredContentType: "text/plain",
          r2Key: "files/a/v1",
          fileName: "hello.txt",
        },
        scanPort: {
          async scan(body) {
            scannedBytes = (await drain(body)).byteLength;
            return {
              engineVersion: "e1",
              clam: { state: "clean" },
              heuristic: { kind: "none" },
              matches: [],
              timings: { clamdMs: 1, yaraMs: 1 },
            };
          },
        },
      }),
    );
    expect(outcome).toMatchObject({ kind: "commit", scanVerdict: "clean" });
    expect(scannedBytes).toBe(HELLO.byteLength);
  });
});

const fixedScan = (result: RawScanResult): MalwareScanPort => ({
  async scan() {
    return result;
  },
});

const baseInput = (bytes: Uint8Array) => ({
  objectBody: streamOf(bytes),
  objectSize: bytes.byteLength,
  version: {
    declaredSize: bytes.byteLength,
    declaredContentType: null,
    r2Key: "files/f/v",
    fileName: "x.pdf",
  },
  policy: DEFAULT_UPLOAD_POLICY,
  inspectableSizeCap: 2 * 1024 * 1024 * 1024,
  scanPolicy: DEFAULT_SCAN_POLICY,
  flaggedTreatment: "block" as FlaggedTreatment,
});

describe("runIngest uninspectable + raw scan verdict", () => {
  it("commits an oversize file as unscanned/oversize without calling the engine", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    let scanCalled = false;
    const port: MalwareScanPort = {
      async scan() {
        scanCalled = true;
        return {
          engineVersion: "e1",
          clam: { state: "clean" },
          heuristic: { kind: "none" },
          matches: [],
          timings: { clamdMs: 1, yaraMs: 1 },
        };
      },
    };
    const outcome = await runIngest({ ...baseInput(bytes), inspectableSizeCap: 3, scanPort: port });
    expect(scanCalled).toBe(false);
    expect(outcome).toMatchObject({
      kind: "commit",
      scanVerdict: "unscanned",
      scanDetail: "oversize",
    });
  });

  it("commits an encrypted file as unscanned/encrypted (benign-uninspectable)", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const outcome = await runIngest({
      ...baseInput(bytes),
      scanPort: fixedScan({
        engineVersion: "e1",
        clam: { state: "clean" },
        heuristic: { kind: "encrypted" },
        matches: [],
        timings: { clamdMs: 1, yaraMs: 1 },
      }),
    });
    expect(outcome).toMatchObject({
      kind: "commit",
      scanVerdict: "unscanned",
      scanDetail: "encrypted",
    });
  });

  it("quarantines a structural heuristic (decompression bomb) as scan-flagged with the sub-reason", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const outcome = await runIngest({
      ...baseInput(bytes),
      scanPort: fixedScan({
        engineVersion: "e1",
        clam: { state: "clean" },
        heuristic: { kind: "structural", reason: "decompression-bomb" },
        matches: [],
        timings: { clamdMs: 1, yaraMs: 1 },
      }),
    });
    expect(outcome).toEqual({
      kind: "quarantine",
      reason: "scan-flagged",
      scanDetail: "decompression-bomb",
    });
  });

  it("commits a clean file with null detail", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const outcome = await runIngest({
      ...baseInput(bytes),
      scanPort: fixedScan({
        engineVersion: "e1",
        clam: { state: "clean" },
        heuristic: { kind: "none" },
        matches: [],
        timings: { clamdMs: 1, yaraMs: 1 },
      }),
    });
    expect(outcome).toMatchObject({ kind: "commit", scanVerdict: "clean", scanDetail: null });
  });

  it("throws (retryable) when a deployed engine reports unavailable", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    // A non-null engineVersion + unavailable clam = deployed engine fault → must throw, never commit.
    await expect(
      runIngest({
        ...baseInput(bytes),
        scanPort: fixedScan({
          engineVersion: "e1", // non-null = a real engine was expected
          clam: { state: "unavailable" },
          heuristic: { kind: "none" },
          matches: [],
          timings: { clamdMs: 0, yaraMs: 0 },
        }),
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Treatment-aware flagged branch
// ---------------------------------------------------------------------------

function infectedRaw(signature: string): RawScanResult {
  return {
    engineVersion: "test-engine-1",
    clam: { state: "infected", signature },
    heuristic: { kind: "none" },
    matches: [],
    timings: { clamdMs: 1, yaraMs: 1 },
  };
}

function matchRaw(match: RuleMatch): RawScanResult {
  return {
    engineVersion: "test-engine-1",
    clam: { state: "clean" },
    heuristic: { kind: "none" },
    matches: [match],
    timings: { clamdMs: 1, yaraMs: 1 },
  };
}

function deployedUnavailableRaw(): RawScanResult {
  return {
    engineVersion: "test-engine-1",
    clam: { state: "unavailable" },
    heuristic: { kind: "none" },
    matches: [],
    timings: { clamdMs: 0, yaraMs: 0 },
  };
}

async function runIngestWithPolicyTreatment(
  raw: RawScanResult,
  policy: ScanPolicy,
  treatment: FlaggedTreatment,
) {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  return runIngest({
    ...baseInput(bytes),
    scanPort: fixedScan(raw),
    scanPolicy: policy,
    flaggedTreatment: treatment,
  });
}

describe("runIngest treatment-aware flagged branch", () => {
  it("flagged upload with treatment=block quarantines (scan-flagged)", async () => {
    const raw = infectedRaw("Eicar");
    const outcome = await runIngestWithPolicyTreatment(raw, DEFAULT_SCAN_POLICY, "block");
    expect(outcome).toMatchObject({
      kind: "quarantine",
      reason: "scan-flagged",
      scanDetail: "Eicar",
    });
  });

  it("flagged upload with treatment=informed-access commits as flagged", async () => {
    const raw = infectedRaw("Eicar");
    const outcome = await runIngestWithPolicyTreatment(raw, DEFAULT_SCAN_POLICY, "informed-access");
    expect(outcome).toMatchObject({ kind: "commit", scanVerdict: "flagged", scanDetail: "Eicar" });
  });

  it("flagged upload with treatment=allow-and-flag commits as flagged", async () => {
    const outcome = await runIngestWithPolicyTreatment(
      infectedRaw("Eicar"),
      DEFAULT_SCAN_POLICY,
      "allow-and-flag",
    );
    expect(outcome).toMatchObject({ kind: "commit", scanVerdict: "flagged" });
  });

  it("a full-tier match under an extended policy commits clean", async () => {
    const raw = matchRaw({ ruleId: "R", tier: "full", score: 90, isSuspicious: false });
    const outcome = await runIngestWithPolicyTreatment(raw, DEFAULT_SCAN_POLICY, "block");
    expect(outcome).toMatchObject({ kind: "commit", scanVerdict: "clean" });
  });

  it("a deployed-engine fault throws (never commits) under any treatment", async () => {
    await expect(
      runIngestWithPolicyTreatment(deployedUnavailableRaw(), DEFAULT_SCAN_POLICY, "allow-and-flag"),
    ).rejects.toThrow();
  });
});
