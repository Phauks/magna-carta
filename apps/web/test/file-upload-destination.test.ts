import { describe, expect, it, vi } from "vitest";
import { sourceInstantOf, uploadIntoFolder } from "../src/lib/file-manager/file-upload.ts";
import { putUploadBytes } from "../src/lib/documents/document-api.ts";

/*
 * The reported defect, pinned: an upload made from inside a folder was filed at the matter root.
 *
 * The contract's reservation accepts `folderId`; the document loop's client carries no such field,
 * so every upload from this screen reserved a version with no folder on it and the host filed it at
 * the root. The list shows one folder at a time, so from the reader's side the file simply was not
 * there — indistinguishable from an upload that did not work.
 *
 * These assert the reservation body, because that is where the fact lives. A test that only checked
 * "the ceremony completed" passed the whole time the defect existed.
 */

function fakeFetch(record: { body: unknown }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v1/uploads")) {
      record.body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          mode: "put",
          uploadId: "upload",
          fileId: "file",
          versionId: "version",
          key: "key",
          method: "PUT",
          url: "https://storage.example/put",
          headers: { "Content-Type": "application/pdf" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url === "https://storage.example/put") return new Response(null, { status: 200 });
    if (url.endsWith("/complete")) {
      return new Response(JSON.stringify({ key: "key", location: "here" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        sessionStatus: "completed",
        versionStatus: "clean",
        quarantineReason: null,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

const aFile = (): File => new File(["bytes"], "Motion.pdf", { type: "application/pdf" });

describe("uploadIntoFolder", () => {
  it("reserves the version IN the folder it was asked for", async () => {
    const record: { body: unknown } = { body: null };
    const outcome = await uploadIntoFolder({
      fetchImpl: fakeFetch(record),
      matterId: "matter",
      folderId: "discovery",
      file: aFile(),
      sleep: async () => {},
      newIdempotencyKey: () => "key",
    });
    expect(outcome.kind).toBe("committed");
    expect(record.body).toMatchObject({ matterId: "matter", folderId: "discovery" });
  });

  it("sends the matter root as an explicit null rather than omitting the field", async () => {
    // Omitting it would let a later default decide silently, which is how this went wrong before.
    const record: { body: unknown } = { body: null };
    await uploadIntoFolder({
      fetchImpl: fakeFetch(record),
      matterId: "matter",
      folderId: null,
      file: aFile(),
      sleep: async () => {},
      newIdempotencyKey: () => "key",
    });
    expect(record.body).toHaveProperty("folderId", null);
  });

  it("files under the name the collision rules settled on, not the name on disk", async () => {
    const record: { body: unknown } = { body: null };
    await uploadIntoFolder({
      fetchImpl: fakeFetch(record),
      matterId: "matter",
      folderId: "discovery",
      file: aFile(),
      name: "Motion (2).pdf",
      sleep: async () => {},
      newIdempotencyKey: () => "key",
    });
    expect(record.body).toMatchObject({ name: "Motion (2).pdf" });
  });

  it("names the existing file when the bytes are a new version of one", async () => {
    const record: { body: unknown } = { body: null };
    await uploadIntoFolder({
      fetchImpl: fakeFetch(record),
      matterId: "matter",
      folderId: "discovery",
      file: aFile(),
      fileId: "file-1",
      sleep: async () => {},
      newIdempotencyKey: () => "key",
    });
    expect(record.body).toMatchObject({ fileId: "file-1" });
  });

  it("sends the device's own date for the file, and the dating the reader chose", async () => {
    const record: { body: unknown } = { body: null };
    const dated = new File(["bytes"], "Letter.pdf", {
      type: "application/pdf",
      lastModified: Date.UTC(2025, 2, 4, 9, 30),
    });
    await uploadIntoFolder({
      fetchImpl: fakeFetch(record),
      matterId: "matter",
      folderId: null,
      file: dated,
      createdAtBasis: "source",
      sleep: async () => {},
      newIdempotencyKey: () => "key",
    });
    expect(record.body).toMatchObject({
      sourceModifiedAt: "2025-03-04T09:30:00.000Z",
      createdAtBasis: "source",
    });
  });

  it("treats a file with no date as having none, never as 1970", () => {
    expect(sourceInstantOf({ lastModified: 0 })).toBeNull();
    expect(sourceInstantOf({ lastModified: Number.NaN })).toBeNull();
    expect(sourceInstantOf({ lastModified: Date.UTC(2026, 0, 2) })).toBe(
      "2026-01-02T00:00:00.000Z",
    );
  });

  it("gives a reservation back when the bytes never land, so no empty row survives the failure", async () => {
    // The reported defect: a PUT the storage refused left the reserved file on the matter as a row
    // with no size and nothing behind it. The abort abandons that version.
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/api/v1/uploads")) {
        return new Response(
          JSON.stringify({
            mode: "put",
            uploadId: "upload-7",
            fileId: "file",
            versionId: "version",
            key: "key",
            method: "PUT",
            url: "https://storage.example/put",
            headers: { "content-type": "application/pdf" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "https://storage.example/put") return new Response(null, { status: 403 });
      if (url.endsWith("/abort")) {
        return new Response(JSON.stringify({ status: "aborted" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;
    const outcome = await uploadIntoFolder({
      fetchImpl,
      matterId: "matter",
      folderId: null,
      file: aFile(),
      sleep: async () => {},
      newIdempotencyKey: () => "key",
    });
    expect(outcome).toMatchObject({ kind: "problem", stage: "uploading" });
    expect(calls).toContain("POST /api/v1/uploads/upload-7/abort");
    // And it never went on to record an upload that did not happen.
    expect(calls.some((call) => call.endsWith("/complete"))).toBe(false);
  });

  it("sends one spelling of each signed header, so the value the storage checks is the value signed", async () => {
    // The production failure: a reservation that carried both "Content-Type" and "content-type"
    // was merged by the browser into "application/pdf, application/pdf" — a value the signature did
    // not cover. The client collapses the pair; the host now sends one spelling as well.
    let sent: Headers | null = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/uploads")) {
        return new Response(
          JSON.stringify({
            mode: "put",
            uploadId: "upload",
            fileId: "file",
            versionId: "version",
            key: "key",
            method: "PUT",
            url: "https://storage.example/put",
            headers: {
              "Content-Type": "application/pdf",
              "content-type": "application/pdf",
              "x-amz-meta-matter": "matter",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "https://storage.example/put") {
        sent = new Headers(init?.headers);
        return new Response(null, { status: 200 });
      }
      if (url.endsWith("/complete")) {
        return new Response(JSON.stringify({ key: "key", location: "here" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          sessionStatus: "completed",
          versionStatus: "clean",
          quarantineReason: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    await uploadIntoFolder({
      fetchImpl,
      matterId: "matter",
      folderId: null,
      file: aFile(),
      sleep: async () => {},
      newIdempotencyKey: () => "key",
    });
    expect(sent).not.toBeNull();
    expect((sent as unknown as Headers).get("content-type")).toBe("application/pdf");
    expect((sent as unknown as Headers).get("x-amz-meta-matter")).toBe("matter");
  });

  it("runs the multipart ceremony above the threshold: sign each part, send it, complete with the manifest", async () => {
    const calls: string[] = [];
    let completeBody: unknown = null;
    const partBodies = new Map<string, number>();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/api/v1/uploads")) {
        return new Response(
          JSON.stringify({
            mode: "multipart",
            uploadId: "session-9",
            fileId: "file",
            versionId: "version",
            key: "key",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const part = /\/parts\/(\d+)$/.exec(url);
      if (part !== null) {
        return new Response(JSON.stringify({ url: `https://storage.example/part/${part[1]}` }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.startsWith("https://storage.example/part/")) {
        const number = url.slice(url.lastIndexOf("/") + 1);
        partBodies.set(number, (init?.body as Blob).size);
        return new Response(null, { status: 200, headers: { ETag: `"etag-${number}"` } });
      }
      if (url.endsWith("/complete")) {
        completeBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ key: "key", location: "here" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          sessionStatus: "completed",
          versionStatus: "clean",
          quarantineReason: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    // 16 MiB parts: a 40 MiB file is two full parts and an 8 MiB tail.
    const large = new File([new Uint8Array(40 * 1024 * 1024)], "deposition.mp4", {
      type: "video/mp4",
    });
    const progress: number[] = [];
    const outcome = await uploadIntoFolder({
      fetchImpl,
      matterId: "matter",
      folderId: null,
      file: large,
      sleep: async () => {},
      newIdempotencyKey: () => "key",
      onProgress: (sent) => progress.push(sent),
    });
    expect(outcome.kind).toBe("committed");
    expect([...partBodies.entries()].toSorted()).toEqual([
      ["1", 16 * 1024 * 1024],
      ["2", 16 * 1024 * 1024],
      ["3", 8 * 1024 * 1024],
    ]);
    expect(completeBody).toEqual({
      parts: [
        { partNumber: 1, etag: '"etag-1"' },
        { partNumber: 2, etag: '"etag-2"' },
        { partNumber: 3, etag: '"etag-3"' },
      ],
    });
    expect(progress.at(-1)).toBe(40 * 1024 * 1024);
    expect(calls.some((call) => call.endsWith("/abort"))).toBe(false);
  });

  it("sends a part again on its own when the storage falters, never the whole file", async () => {
    let firstAttempt = true;
    const putCount = new Map<string, number>();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/uploads")) {
        return new Response(
          JSON.stringify({
            mode: "multipart",
            uploadId: "s",
            fileId: "f",
            versionId: "v",
            key: "k",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const part = /\/parts\/(\d+)$/.exec(url);
      if (part !== null) {
        return new Response(JSON.stringify({ url: `https://storage.example/part/${part[1]}` }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.startsWith("https://storage.example/part/")) {
        const number = url.slice(url.lastIndexOf("/") + 1);
        putCount.set(number, (putCount.get(number) ?? 0) + 1);
        if (number === "2" && firstAttempt) {
          firstAttempt = false;
          return new Response(null, { status: 503 });
        }
        return new Response(null, { status: 200, headers: { ETag: `"e${number}"` } });
      }
      if (url.endsWith("/complete")) {
        return new Response(JSON.stringify({ key: "k", location: "here" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          sessionStatus: "completed",
          versionStatus: "clean",
          quarantineReason: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const slept: number[] = [];
    const outcome = await uploadIntoFolder({
      fetchImpl,
      matterId: "matter",
      folderId: null,
      file: new File([new Uint8Array(33 * 1024 * 1024)], "big.bin"),
      sleep: async (milliseconds) => {
        slept.push(milliseconds);
      },
      newIdempotencyKey: () => "key",
    });
    expect(outcome.kind).toBe("committed");
    expect(putCount.get("2")).toBe(2);
    expect(putCount.get("1")).toBe(1);
    expect(putCount.get("3")).toBe(1);
    // Backed off before the second try, and not by nothing.
    expect(slept[0]).toBeGreaterThan(0);
  });

  it("stops on a cancel, gives the reservation back, and says it was cancelled rather than failed", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/api/v1/uploads")) {
        return new Response(
          JSON.stringify({
            mode: "put",
            uploadId: "session-c",
            fileId: "file",
            versionId: "version",
            key: "key",
            method: "PUT",
            url: "https://storage.example/put",
            headers: { "content-type": "application/pdf" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "https://storage.example/put") {
        // The reader cancels while the bytes are going; the write reports as aborted.
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      }
      if (url.endsWith("/abort")) {
        return new Response(JSON.stringify({ status: "aborted" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;
    const outcome = await uploadIntoFolder({
      fetchImpl,
      matterId: "matter",
      folderId: null,
      file: aFile(),
      signal: controller.signal,
      sleep: async () => {},
      newIdempotencyKey: () => "key",
    });
    expect(outcome).toEqual({ kind: "cancelled", stage: "uploading" });
    expect(calls).toContain("POST /api/v1/uploads/session-c/abort");
    // No retry after a cancel: the reader changed their mind.
    expect(calls.filter((call) => call === "PUT https://storage.example/put")).toHaveLength(1);
  });

  it("reports bytes as they leave when a progress-capable transport is at hand", async () => {
    // A stand-in for XMLHttpRequest: fires two progress events and then a 200 with an ETag.
    class FakeRequest {
      status = 0;
      upload: {
        onprogress:
          | ((event: { loaded: number; total: number; lengthComputable: boolean }) => void)
          | null;
      } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      headers: Record<string, string> = {};
      opened = "";
      open(method: string, url: string): void {
        this.opened = `${method} ${url}`;
      }
      setRequestHeader(name: string, value: string): void {
        this.headers[name] = value;
      }
      send(body: Blob): void {
        queueMicrotask(() => {
          this.upload.onprogress?.({
            loaded: Math.floor(body.size / 2),
            total: body.size,
            lengthComputable: true,
          });
          this.upload.onprogress?.({ loaded: body.size, total: body.size, lengthComputable: true });
          this.status = 200;
          this.onload?.();
        });
      }
      abort(): void {
        this.onabort?.();
      }
      getResponseHeader(name: string): string | null {
        return name === "ETag" ? '"x"' : null;
      }
    }
    const made: FakeRequest[] = [];
    const progress: number[] = [];
    const outcome = await putUploadBytes(
      fetch,
      "https://storage.example/put",
      { "content-type": "application/pdf", "x-amz-meta-matter": "m" },
      new File(["0123456789"], "a.pdf"),
      {
        onProgress: (sent) => progress.push(sent),
        xhr: () => {
          const request = new FakeRequest();
          made.push(request);
          return request;
        },
      },
    );
    expect(outcome).toEqual({ kind: "ok", value: { etag: '"x"' } });
    expect(progress).toEqual([5, 10, 10]);
    expect(made[0]?.opened).toBe("PUT https://storage.example/put");
    expect(made[0]?.headers).toEqual({
      "content-type": "application/pdf",
      "x-amz-meta-matter": "m",
    });
  });

  it("asks the firm first with a digest in hand, and sends nothing when the matter already holds the file", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/api/v1/uploads/matches")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          matterId: "matter",
          sha256: "f".repeat(64),
          sizeBytes: 5,
        });
        return new Response(
          JSON.stringify({
            onMatter: [
              { fileId: "held", versionId: "v", folderId: "discovery", name: "Motion.pdf" },
            ],
            elsewhere: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;
    const outcome = await uploadIntoFolder({
      fetchImpl,
      matterId: "matter",
      folderId: null,
      file: aFile(),
      sha256: "f".repeat(64),
      sleep: async () => {},
      newIdempotencyKey: () => "key",
    });
    expect(outcome).toEqual({
      kind: "already",
      fileId: "held",
      name: "Motion.pdf",
      folderId: "discovery",
    });
    expect(calls).toEqual(["POST /api/v1/uploads/matches"]);
  });

  it("duplicates a file the firm holds elsewhere instead of sending the bytes", async () => {
    const calls: string[] = [];
    let duplicateBody: unknown = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/api/v1/uploads/matches")) {
        return new Response(
          JSON.stringify({
            onMatter: [],
            elsewhere: [{ fileId: "other", versionId: "other-v", matterId: "matter-2" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/v1/uploads/duplicates")) {
        duplicateBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ fileId: "made", versionId: "made-v" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;
    const progress: number[] = [];
    const outcome = await uploadIntoFolder({
      fetchImpl,
      matterId: "matter",
      folderId: "discovery",
      file: aFile(),
      name: "Motion (2).pdf",
      sha256: "f".repeat(64),
      createdAtBasis: "source",
      sleep: async () => {},
      newIdempotencyKey: () => "key",
      onProgress: (sent) => progress.push(sent),
    });
    expect(outcome).toEqual({
      kind: "committed",
      fileId: "made",
      versionId: "made-v",
      copiedFrom: "firm",
    });
    expect(duplicateBody).toMatchObject({
      sourceVersionId: "other-v",
      matterId: "matter",
      folderId: "discovery",
      name: "Motion (2).pdf",
      createdAtBasis: "source",
    });
    // The bytes count as sent in full without a PUT having happened.
    expect(progress).toEqual([5]);
    expect(calls.some((call) => call.endsWith("/api/v1/uploads"))).toBe(false);
  });

  it("sends the bytes as usual when the question cannot be answered", async () => {
    // The lookup is an economy: a host that cannot answer it must not cost the reader the upload.
    const record: { body: unknown } = { body: null };
    const base = fakeFetch(record);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/uploads/matches")) return new Response(null, { status: 503 });
      return base(input, init);
    }) as unknown as typeof fetch;
    const outcome = await uploadIntoFolder({
      fetchImpl,
      matterId: "matter",
      folderId: null,
      file: aFile(),
      sha256: "f".repeat(64),
      sleep: async () => {},
      newIdempotencyKey: () => "key",
    });
    expect(outcome.kind).toBe("committed");
    expect(record.body).toMatchObject({ matterId: "matter" });
  });

  it("reports a flagged file as committed-and-flagged, never as a refusal", async () => {
    // Nothing is ever blocked: the bytes are stored and the reader deals with the finding after.
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/uploads")) {
        return new Response(
          JSON.stringify({
            mode: "put",
            uploadId: "upload",
            fileId: "file",
            versionId: "version",
            key: "key",
            method: "PUT",
            url: "https://storage.example/put",
            headers: {},
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "https://storage.example/put") return new Response(null, { status: 200 });
      if (url.endsWith("/complete")) {
        return new Response(JSON.stringify({ key: "key", location: "here" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      void init;
      return new Response(
        JSON.stringify({
          sessionStatus: "completed",
          versionStatus: "quarantined",
          quarantineReason: "Pdf.Exploit.Sample",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const outcome = await uploadIntoFolder({
      fetchImpl,
      matterId: "matter",
      folderId: null,
      file: aFile(),
      sleep: async () => {},
      newIdempotencyKey: () => "key",
    });
    expect(outcome).toMatchObject({ kind: "flagged", fileId: "file" });
  });
});
