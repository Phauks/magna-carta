/*
 * The two ceremonies that put a document on a matter, pinned against a scripted fetch.
 *
 * These are the tests that matter most on this surface, because both ceremonies are multi-step and
 * asynchronous: the bytes land in object storage before anything has decided whether they are
 * servable, so "the HTTP call succeeded" and "the document is usable" are different facts and the
 * code must not conflate them. The cases below are the ways they come apart — a rejection, a step
 * that fails halfway, a poll that runs out — plus the one thing that must never be edited on the
 * way through: the signed headers the object's dimensions ride on.
 */
import { describe, expect, it } from "vitest";
import {
  assembleDocument,
  uploadDocument,
  type CreationStage,
} from "../src/lib/documents/create-document.ts";

interface ScriptedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

type Responder = (call: ScriptedCall) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A fetch that records every call and answers from a table keyed by "METHOD path-fragment". */
function scriptedFetch(routes: Record<string, Responder>): {
  fetchImpl: typeof fetch;
  calls: ScriptedCall[];
} {
  const calls: ScriptedCall[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input.href : input;
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: ScriptedCall = { url, method, headers, body: init?.body };
    calls.push(call);
    for (const [key, responder] of Object.entries(routes)) {
      const [routeMethod, fragment] = key.split(" ");
      if (routeMethod === method && fragment !== undefined && url.includes(fragment)) {
        return await responder(call);
      }
    }
    throw new Error(`No scripted response for ${method} ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const noSleep = (): Promise<void> => Promise.resolve();
let keyCounter = 0;
const nextKey = (): string => `key-${(keyCounter += 1)}`;

const chosen = new File(["some bytes"], "Complaint.docx", {
  type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
});

const reservation = {
  mode: "put",
  uploadId: "uploadSession_01",
  fileId: "file_01",
  versionId: "fileVersion_01",
  key: "files/file_01/fileVersion_01",
  method: "PUT",
  url: "https://storage.example/signed",
  headers: {
    "x-amz-meta-mc-scope": "matter",
    "x-amz-meta-mc-matter-id": "matter_01",
  },
};

describe("uploadDocument", () => {
  it("runs the four steps in order and reports the document as created once the gate clears it", async () => {
    const stages: CreationStage[] = [];
    const { fetchImpl, calls } = scriptedFetch({
      "POST /api/v1/uploads": (call) =>
        call.url.endsWith("/complete")
          ? json({ key: reservation.key, location: "x" })
          : json(reservation),
      "PUT https://storage.example/signed": () => new Response(null, { status: 200 }),
      "GET /api/v1/uploads/": () =>
        json({ sessionStatus: "completed", versionStatus: "clean", quarantineReason: null }),
    });

    const outcome = await uploadDocument({
      fetchImpl,
      matterId: "matter_01",
      file: chosen,
      sleep: noSleep,
      newIdempotencyKey: nextKey,
      onStage: (stage) => stages.push(stage),
    });

    expect(outcome).toEqual({ kind: "created", fileId: "file_01", versionId: "fileVersion_01" });
    expect(stages).toEqual(["reserving", "uploading", "committing", "scanning", "settled"]);
    expect(
      calls.map((call) => `${call.method} ${new URL(call.url, "http://app").pathname}`),
    ).toEqual([
      "POST /api/v1/uploads",
      "PUT /signed",
      "POST /api/v1/uploads/uploadSession_01/complete",
      "GET /api/v1/uploads/uploadSession_01",
    ]);
  });

  it("sends the signed headers through to storage exactly as received", async () => {
    // The object's dimensions ride on these headers. An upload that drops one writes an object
    // nothing can place, so this asserts pass-through rather than any particular header name.
    const { fetchImpl, calls } = scriptedFetch({
      "POST /api/v1/uploads": (call) =>
        call.url.endsWith("/complete")
          ? json({ key: reservation.key, location: "x" })
          : json(reservation),
      "PUT https://storage.example/signed": () => new Response(null, { status: 200 }),
      "GET /api/v1/uploads/": () =>
        json({ sessionStatus: "completed", versionStatus: "clean", quarantineReason: null }),
    });

    await uploadDocument({
      fetchImpl,
      matterId: "matter_01",
      file: chosen,
      sleep: noSleep,
      newIdempotencyKey: nextKey,
    });

    const put = calls.find((call) => call.method === "PUT");
    expect(put?.headers).toEqual(reservation.headers);
  });

  it("reserves against an existing document when saving a new version", async () => {
    const { fetchImpl, calls } = scriptedFetch({
      "POST /api/v1/uploads": (call) =>
        call.url.endsWith("/complete")
          ? json({ key: reservation.key, location: "x" })
          : json(reservation),
      "PUT https://storage.example/signed": () => new Response(null, { status: 200 }),
      "GET /api/v1/uploads/": () =>
        json({ sessionStatus: "completed", versionStatus: "clean", quarantineReason: null }),
    });

    await uploadDocument({
      fetchImpl,
      matterId: "matter_01",
      fileId: "file_01",
      file: chosen,
      sleep: noSleep,
      newIdempotencyKey: nextKey,
    });

    const reserve = calls[0];
    expect(JSON.parse(String(reserve?.body))).toMatchObject({ fileId: "file_01" });
  });

  it("carries an idempotency key on the reservation, so a retry cannot file two documents", async () => {
    const { fetchImpl, calls } = scriptedFetch({
      "POST /api/v1/uploads": (call) =>
        call.url.endsWith("/complete")
          ? json({ key: reservation.key, location: "x" })
          : json(reservation),
      "PUT https://storage.example/signed": () => new Response(null, { status: 200 }),
      "GET /api/v1/uploads/": () =>
        json({ sessionStatus: "completed", versionStatus: "clean", quarantineReason: null }),
    });

    await uploadDocument({
      fetchImpl,
      matterId: "matter_01",
      file: chosen,
      sleep: noSleep,
      newIdempotencyKey: nextKey,
    });

    expect(calls[0]?.headers["idempotency-key"]).toBeTypeOf("string");
  });

  it("reports a rejection as its own outcome, carrying the reason", async () => {
    const { fetchImpl } = scriptedFetch({
      "POST /api/v1/uploads": (call) =>
        call.url.endsWith("/complete")
          ? json({ key: reservation.key, location: "x" })
          : json(reservation),
      "PUT https://storage.example/signed": () => new Response(null, { status: 200 }),
      "GET /api/v1/uploads/": () =>
        json({
          sessionStatus: "completed",
          versionStatus: "quarantined",
          quarantineReason: "scan-flagged",
        }),
    });

    expect(
      await uploadDocument({
        fetchImpl,
        matterId: "matter_01",
        file: chosen,
        sleep: noSleep,
        newIdempotencyKey: nextKey,
      }),
    ).toEqual({ kind: "rejected", fileId: "file_01", reason: "scan-flagged" });
  });

  it("treats an abandoned version as the document being intact — identical bytes are one version", async () => {
    const { fetchImpl } = scriptedFetch({
      "POST /api/v1/uploads": (call) =>
        call.url.endsWith("/complete")
          ? json({ key: reservation.key, location: "x" })
          : json(reservation),
      "PUT https://storage.example/signed": () => new Response(null, { status: 200 }),
      "GET /api/v1/uploads/": () =>
        json({ sessionStatus: "completed", versionStatus: "abandoned", quarantineReason: null }),
    });

    expect(
      await uploadDocument({
        fetchImpl,
        matterId: "matter_01",
        file: chosen,
        sleep: noSleep,
        newIdempotencyKey: nextKey,
      }),
    ).toEqual({ kind: "created", fileId: "file_01", versionId: null });
  });

  it("reports which step failed, not just that something did", async () => {
    const { fetchImpl } = scriptedFetch({
      "POST /api/v1/uploads": (call) =>
        call.url.endsWith("/complete")
          ? json({ key: reservation.key, location: "x" })
          : json(reservation),
      "PUT https://storage.example/signed": () => new Response(null, { status: 403 }),
    });

    expect(
      await uploadDocument({
        fetchImpl,
        matterId: "matter_01",
        file: chosen,
        sleep: noSleep,
        newIdempotencyKey: nextKey,
      }),
    ).toEqual({ kind: "problem", stage: "uploading", problem: { status: 403 } });
  });

  it("refuses the resumable reservation rather than half-running it", async () => {
    const { fetchImpl } = scriptedFetch({
      "POST /api/v1/uploads": () =>
        json({
          mode: "multipart",
          uploadId: "uploadSession_02",
          fileId: "file_02",
          versionId: "fileVersion_02",
          key: "files/file_02/fileVersion_02",
        }),
    });

    const outcome = await uploadDocument({
      fetchImpl,
      matterId: "matter_01",
      file: chosen,
      sleep: noSleep,
      newIdempotencyKey: nextKey,
    });
    expect(outcome.kind).toBe("problem");
    expect(outcome.kind === "problem" && outcome.stage).toBe("reserving");
  });

  it("says the outcome has not landed rather than claiming success, when the wait runs out", async () => {
    const { fetchImpl } = scriptedFetch({
      "POST /api/v1/uploads": (call) =>
        call.url.endsWith("/complete")
          ? json({ key: reservation.key, location: "x" })
          : json(reservation),
      "PUT https://storage.example/signed": () => new Response(null, { status: 200 }),
      "GET /api/v1/uploads/": () =>
        json({ sessionStatus: "completed", versionStatus: "pending", quarantineReason: null }),
    });

    expect(
      await uploadDocument({
        fetchImpl,
        matterId: "matter_01",
        file: chosen,
        sleep: noSleep,
        newIdempotencyKey: nextKey,
      }),
    ).toEqual({ kind: "still-settling", fileId: "file_01" });
  });

  it("distinguishes nothing answering from a server that refused", async () => {
    const fetchImpl = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    expect(
      await uploadDocument({
        fetchImpl,
        matterId: "matter_01",
        file: chosen,
        sleep: noSleep,
        newIdempotencyKey: nextKey,
      }),
    ).toEqual({ kind: "transport", stage: "reserving" });
  });
});

describe("assembleDocument", () => {
  it("submits, polls, and reports the document the merge produced", async () => {
    const { fetchImpl, calls } = scriptedFetch({
      "POST /assemblies": () => json({ assemblyId: "documentAssembly_01", status: "queued" }, 202),
      "GET /assemblies/": () =>
        json({
          assemblyId: "documentAssembly_01",
          status: "done",
          outcome: "succeeded",
          outputFormat: "docx",
          fileId: "file_09",
          fileVersionId: "fileVersion_09",
          absentFieldKeys: [],
          frozenMergeFieldNames: [],
          reason: null,
        }),
    });

    const result = await assembleDocument({
      fetchImpl,
      matterId: "matter_01",
      templateVersionId: "documentTemplateVersion_01",
      sleep: noSleep,
      newIdempotencyKey: nextKey,
    });

    expect(result.creation).toEqual({
      kind: "created",
      fileId: "file_09",
      versionId: "fileVersion_09",
    });
    expect(calls[0]?.headers["idempotency-key"]).toBeTypeOf("string");
  });

  it("surfaces the blanks a completed document was left with", async () => {
    // A document that completed with unfilled fields reads as finished and is not — so the keys and
    // the frozen field names have to come back out of the ceremony, not be swallowed by success.
    const { fetchImpl } = scriptedFetch({
      "POST /assemblies": () => json({ assemblyId: "documentAssembly_01", status: "queued" }, 202),
      "GET /assemblies/": () =>
        json({
          assemblyId: "documentAssembly_01",
          status: "done",
          outcome: "succeeded_with_absences",
          outputFormat: "docx",
          fileId: "file_09",
          fileVersionId: "fileVersion_09",
          absentFieldKeys: ["client.address.line1"],
          frozenMergeFieldNames: ["ClientName"],
          reason: null,
        }),
    });

    const result = await assembleDocument({
      fetchImpl,
      matterId: "matter_01",
      templateVersionId: "documentTemplateVersion_01",
      sleep: noSleep,
      newIdempotencyKey: nextKey,
    });

    expect(result.creation.kind).toBe("created");
    expect(result.absentFieldKeys).toEqual(["client.address.line1"]);
    expect(result.frozenMergeFieldNames).toEqual(["ClientName"]);
  });

  it("reports a failed job with the reason the server gave", async () => {
    const { fetchImpl } = scriptedFetch({
      "POST /assemblies": () => json({ assemblyId: "documentAssembly_01", status: "queued" }, 202),
      "GET /assemblies/": () =>
        json({
          assemblyId: "documentAssembly_01",
          status: "failed",
          outcome: "failed",
          outputFormat: "pdf",
          fileId: null,
          fileVersionId: null,
          absentFieldKeys: [],
          frozenMergeFieldNames: [],
          reason: "the template package could not be read",
        }),
    });

    const result = await assembleDocument({
      fetchImpl,
      matterId: "matter_01",
      templateVersionId: "documentTemplateVersion_01",
      sleep: noSleep,
      newIdempotencyKey: nextKey,
    });

    expect(result.creation.kind).toBe("problem");
    expect(result.creation.kind === "problem" ? result.creation.problem.detail : undefined).toBe(
      "the template package could not be read",
    );
  });

  it("asks for the format it was given and reports back the one the job produced", async () => {
    // The format is the whole of the signature hand-off on this side: the platform seal takes a PDF
    // and nothing else, so a surface deciding whether it may offer "send this to be signed" reads
    // what the job PRODUCED rather than what was asked for. They are the same here; they are not the
    // same on a job that failed, which is exactly why the answer travels on the ceremony's outcome.
    const { fetchImpl, calls } = scriptedFetch({
      "POST /assemblies": () => json({ assemblyId: "documentAssembly_01", status: "queued" }, 202),
      "GET /assemblies/": () =>
        json({
          assemblyId: "documentAssembly_01",
          status: "done",
          outcome: "succeeded",
          outputFormat: "pdf",
          fileId: "file_09",
          fileVersionId: "fileVersion_09",
          absentFieldKeys: [],
          frozenMergeFieldNames: [],
          reason: null,
        }),
    });

    const result = await assembleDocument({
      fetchImpl,
      matterId: "matter_01",
      templateVersionId: "documentTemplateVersion_01",
      outputFormat: "pdf",
      sleep: noSleep,
      newIdempotencyKey: nextKey,
    });

    expect(JSON.parse(String(calls[0]?.body ?? "{}"))).toMatchObject({ outputFormat: "pdf" });
    expect(result.outputFormat).toBe("pdf");
  });

  it("defaults to the word-processing document when no format is asked for", async () => {
    const { fetchImpl, calls } = scriptedFetch({
      "POST /assemblies": () => json({ assemblyId: "documentAssembly_01", status: "queued" }, 202),
      "GET /assemblies/": () =>
        json({
          assemblyId: "documentAssembly_01",
          status: "done",
          outcome: "succeeded",
          outputFormat: "docx",
          fileId: "file_09",
          fileVersionId: "fileVersion_09",
          absentFieldKeys: [],
          frozenMergeFieldNames: [],
          reason: null,
        }),
    });

    await assembleDocument({
      fetchImpl,
      matterId: "matter_01",
      templateVersionId: "documentTemplateVersion_01",
      sleep: noSleep,
      newIdempotencyKey: nextKey,
    });

    expect(JSON.parse(String(calls[0]?.body ?? "{}"))).toMatchObject({ outputFormat: "docx" });
  });

  it("reports the format a refused submit was asking for, since no job ever answered", async () => {
    const { fetchImpl } = scriptedFetch({
      "POST /assemblies": () =>
        json({ type: "template-not-activatable", detail: "The template is archived." }, 422),
    });

    const result = await assembleDocument({
      fetchImpl,
      matterId: "matter_01",
      templateVersionId: "documentTemplateVersion_01",
      outputFormat: "pdf",
      sleep: noSleep,
      newIdempotencyKey: nextKey,
    });

    expect(result.creation.kind).toBe("problem");
    expect(result.outputFormat).toBe("pdf");
  });

  it("passes a refused submit straight back, without polling a job that was never made", async () => {
    const { fetchImpl, calls } = scriptedFetch({
      "POST /assemblies": () =>
        json({ type: "template-not-activatable", detail: "The template is archived." }, 422),
    });

    const result = await assembleDocument({
      fetchImpl,
      matterId: "matter_01",
      templateVersionId: "documentTemplateVersion_01",
      sleep: noSleep,
      newIdempotencyKey: nextKey,
    });

    expect(result.creation.kind).toBe("problem");
    expect(calls).toHaveLength(1);
  });
});
