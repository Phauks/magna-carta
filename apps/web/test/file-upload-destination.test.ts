import { describe, expect, it, vi } from "vitest";
import { sourceInstantOf, uploadIntoFolder } from "../src/lib/file-manager/file-upload.ts";

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
    expect(sourceInstantOf({ lastModified: Date.UTC(2026, 0, 2) })).toBe("2026-01-02T00:00:00.000Z");
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
        JSON.stringify({ sessionStatus: "completed", versionStatus: "clean", quarantineReason: null }),
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
