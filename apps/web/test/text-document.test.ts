import { describe, expect, it } from "vitest";
import { readTextDocument, saveTextDocument } from "../src/lib/documents/text-document.ts";

/*
 * The plain-text editor's two moves, pinned against a scripted fetch. Reading is the audited
 * download path decoded as text, refused before a byte moves when the record is too big; saving is
 * the upload ceremony with the document's own id, carrying the name the document already has and
 * the content type that name calls for.
 */

interface ScriptedCall {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function scriptedFetch(routes: Record<string, (call: ScriptedCall) => Response>): {
  fetchImpl: typeof fetch;
  calls: ScriptedCall[];
} {
  const calls: ScriptedCall[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input.href : input;
    const method = init?.method ?? "GET";
    const call: ScriptedCall = { url, method, body: init?.body };
    calls.push(call);
    for (const [key, responder] of Object.entries(routes)) {
      const [routeMethod, fragment] = key.split(" ");
      if (routeMethod === method && fragment !== undefined && url.includes(fragment)) {
        return responder(call);
      }
    }
    throw new Error(`No scripted response for ${method} ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("readTextDocument", () => {
  it("reads the download path and decodes the bytes as UTF-8", async () => {
    const { fetchImpl, calls } = scriptedFetch({
      "GET /download": () => new Response(new TextEncoder().encode("Dear Sir,\n\nRegards")),
    });
    const outcome = await readTextDocument(fetchImpl, "file_01", 18);
    expect(outcome).toEqual({ kind: "ok", text: "Dear Sir,\n\nRegards" });
    expect(calls.map((call) => call.url)).toEqual(["/api/v1/files/file_01/download"]);
  });

  it("refuses a document the record already says is too big, without fetching it", async () => {
    const { fetchImpl, calls } = scriptedFetch({});
    const outcome = await readTextDocument(fetchImpl, "file_01", 5_000, 1_000);
    expect(outcome).toEqual({ kind: "too-large", sizeBytes: 5_000 });
    expect(calls).toEqual([]);
  });

  it("measures a document whose record holds no size, and refuses it on arrival", async () => {
    const { fetchImpl } = scriptedFetch({
      "GET /download": () => new Response("x".repeat(2_000)),
    });
    const outcome = await readTextDocument(fetchImpl, "file_01", null, 1_000);
    expect(outcome).toEqual({ kind: "too-large", sizeBytes: 2_000 });
  });

  it("reports a refusal as a problem and a dead transport as transport", async () => {
    const refused = scriptedFetch({
      "GET /download": () => json({ status: 409 }, 409),
    });
    const problem = await readTextDocument(refused.fetchImpl, "file_01", 10);
    expect(problem.kind).toBe("problem");
    if (problem.kind === "problem") expect(problem.problem.status).toBe(409);

    const dead = scriptedFetch({});
    const transport = await readTextDocument(dead.fetchImpl, "file_01", 10);
    expect(transport.kind).toBe("transport");
  });
});

describe("saveTextDocument", () => {
  it("runs the upload ceremony as a new version of the same document", async () => {
    const { fetchImpl, calls } = scriptedFetch({
      "POST /api/v1/uploads": () =>
        json({
          mode: "put",
          uploadId: "uploadSession_01",
          fileId: "file_01",
          versionId: "fileVersion_02",
          key: "files/file_01/fileVersion_02",
          url: "https://storage.example/signed",
          headers: { "content-type": "text/markdown" },
        }),
      "PUT https://storage.example/signed": () => new Response(null, { status: 200 }),
      "POST /complete": () => json({ key: "files/file_01/fileVersion_02", location: "r2" }),
      "GET /api/v1/uploads/uploadSession_01": () =>
        json({ sessionStatus: "completed", versionStatus: "clean", quarantineReason: null }),
    });

    const outcome = await saveTextDocument({
      fetchImpl,
      matterId: "matter_01",
      fileId: "file_01",
      fileName: "notes.md",
      text: "# Notes\n",
      sleep: () => Promise.resolve(),
      newIdempotencyKey: () => "key-1",
    });

    expect(outcome).toEqual({ kind: "created", fileId: "file_01", versionId: "fileVersion_02" });
    const reservation = calls[0];
    expect(reservation?.url).toBe("/api/v1/uploads");
    expect(JSON.parse(String(reservation?.body))).toEqual({
      matterId: "matter_01",
      name: "notes.md",
      declaredSize: 8,
      declaredContentType: "text/markdown",
      fileId: "file_01",
    });
    const put = calls[1];
    expect(put?.method).toBe("PUT");
    expect(await (put?.body as Blob).text()).toBe("# Notes\n");
  });
});
