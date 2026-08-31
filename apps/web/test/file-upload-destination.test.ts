import { describe, expect, it, vi } from "vitest";
import { uploadIntoFolder } from "../src/lib/file-manager/file-upload.ts";

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
