import { runIngest, type IngestInput } from "@magna-carta/file-manager/ingest-core";
import type { MalwareScanPort } from "@magna-carta/file-manager/scan-port";
import { unscannedAdapter } from "@magna-carta/file-manager/scan-port";
import type { UploadPolicy } from "@magna-carta/file-manager/upload-policy";
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
    expect(outcome).toEqual({ kind: "quarantine", reason: "type-mismatch" });
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
    expect(outcome).toEqual({ kind: "quarantine", reason: "policy-size" });
  });

  it("quarantines a size mismatch between the stream and the object metadata", async () => {
    const outcome = await runIngest(input(PDF_BYTES, { objectSize: PDF_BYTES.byteLength + 1 }));
    expect(outcome).toEqual({ kind: "quarantine", reason: "size-mismatch" });
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
    expect(outcome).toEqual({ kind: "quarantine", reason: "policy-type" });
  });

  it("quarantines an infected verdict from the scan port", async () => {
    const infectedPort: MalwareScanPort = {
      async scan(body) {
        await body.cancel();
        return { verdict: "infected", engineVersion: "test-engine-1", signature: null };
      },
    };
    const outcome = await runIngest(input(PDF_BYTES, { scanPort: infectedPort }));
    expect(outcome).toEqual({ kind: "quarantine", reason: "scan-infected" });
  });
});
