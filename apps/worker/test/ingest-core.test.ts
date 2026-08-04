import { runIngest, type IngestInput } from "@magna-carta/file-manager/ingest-core";
import type {
  MalwareScanPort,
  RawScanResult,
  RuleMatch,
} from "@magna-carta/file-manager/scan-port";
import { unscannedAdapter } from "@magna-carta/file-manager/scan-port";
import type { UploadPolicy } from "@magna-carta/file-manager/upload-policy";
import { DEFAULT_UPLOAD_POLICY } from "@magna-carta/file-manager/upload-policy";
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
