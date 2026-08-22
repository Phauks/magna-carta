import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { routeEngineRequest as route } from "../src/parse-service.ts";

// These tests run in the node pool, which has no bundler-provided WebAssembly.Module, so the engine
// is initialised from the same artefact the deployed worker bundles — read off disk here, the way
// packages/email-filing's own tests read it. The wiring is the only thing that differs from
// production; the engine is the same build.
const WASM_BYTES = new Uint8Array(
  // `.href` rather than the URL object: this project carries both the Workers and the node type
  // definitions, and their two URL types are not assignable to one another.
  readFileSync(
    fileURLToPath(
      new URL("../../../packages/email/src/pkg/email_core_bg.wasm", import.meta.url).href,
    ),
  ),
);

function routeEngineRequest(request: Request): Promise<Response> {
  return route(request, WASM_BYTES);
}

// The parse engine's service-binding surface. Status codes ARE the contract the app worker's
// adapter branches on — 200 a result, 422 a stable code about the submitted message, 5xx a fault —
// so a test that lets two of them blur is testing nothing.

const SIMPLE_EML = `Message-ID: <first@example.test>
From: Alice Attorney <alice@example.test>
To: Bob Client <bob@example.test>
Subject: Retainer
Date: Tue, 07 Jul 2026 10:00:00 -0700
Content-Type: text/plain; charset=utf-8

The retainer is attached.`;

const WITH_ATTACHMENT_EML = `Message-ID: <second@example.test>
From: Alice Attorney <alice@example.test>
To: Bob Client <bob@example.test>
Subject: Retainer with attachment
Date: Tue, 07 Jul 2026 10:05:00 -0700
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="boundary42"

--boundary42
Content-Type: text/plain; charset=utf-8

Please see the attached engagement letter.

--boundary42
Content-Type: application/pdf; name="engagement-letter.pdf"
Content-Disposition: attachment; filename="engagement-letter.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQKJeLjz9MK

--boundary42--
`;

function post(path: string, body: string | Uint8Array): Request {
  return new Request(`http://email${path}`, { method: "POST", body });
}

describe("POST /parse", () => {
  it("returns the parsed message as JSON", async () => {
    const response = await routeEngineRequest(post("/parse", SIMPLE_EML));
    expect(response.status).toBe(200);
    const parsed = (await response.json()) as { subject: string | null; parts: unknown[] };
    expect(parsed.subject).toBe("Retainer");
    expect(Array.isArray(parsed.parts)).toBe(true);
  });

  it("refuses bytes it cannot read with a stable code, never a fault", async () => {
    // 422 is a verdict about the submitted message; the caller turns it into a 422 for a member or
    // a terminal acked outcome on the queue. A 5xx here would be read as "the engine is down".
    const response = await routeEngineRequest(post("/parse", new Uint8Array([0xff, 0xfe, 0x00])));
    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string };
    expect(["malformed", "unsupported"]).toContain(body.code);
  });

  it("rejects an empty body as a caller error, not a verdict on a message", async () => {
    const response = await routeEngineRequest(post("/parse", new Uint8Array()));
    expect(response.status).toBe(400);
  });
});

describe("POST /extract-part", () => {
  it("returns one part's bytes as octet-stream", async () => {
    const parsed = (await (
      await routeEngineRequest(post("/parse", WITH_ATTACHMENT_EML))
    ).json()) as { parts: { filename: string | null }[] };
    const index = parsed.parts.findIndex((part) => part.filename === "engagement-letter.pdf");
    expect(index).toBeGreaterThanOrEqual(0);

    const response = await routeEngineRequest(
      post(`/extract-part?index=${index}`, WITH_ATTACHMENT_EML),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    const bytes = new Uint8Array(await response.arrayBuffer());
    // One part, not the whole message, and carried through the octet-stream framing byte for byte.
    // What the engine does about transfer encodings is the engine's contract, held by its own
    // tests; what this asserts is that the surface hands back exactly what the engine produced.
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(bytes.byteLength).toBeLessThan(WITH_ATTACHMENT_EML.length);
    const again = await routeEngineRequest(
      post(`/extract-part?index=${index}`, WITH_ATTACHMENT_EML),
    );
    expect(Array.from(new Uint8Array(await again.arrayBuffer()))).toEqual(Array.from(bytes));
  });

  it("refuses an index the message does not produce with partNotFound", async () => {
    const response = await routeEngineRequest(post("/extract-part?index=99", SIMPLE_EML));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ code: "partNotFound" });
  });

  it("rejects a missing or non-numeric index as a caller error", async () => {
    expect((await routeEngineRequest(post("/extract-part", SIMPLE_EML))).status).toBe(400);
    expect((await routeEngineRequest(post("/extract-part?index=x", SIMPLE_EML))).status).toBe(400);
    expect((await routeEngineRequest(post("/extract-part?index=-1", SIMPLE_EML))).status).toBe(400);
  });
});

describe("routing", () => {
  it("answers the readiness probe", async () => {
    const response = await routeEngineRequest(new Request("http://email/ready"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("returns 404 for an unknown path or the wrong method", async () => {
    expect((await routeEngineRequest(new Request("http://email/unknown"))).status).toBe(404);
    expect((await routeEngineRequest(new Request("http://email/parse"))).status).toBe(404);
    expect(
      (await routeEngineRequest(new Request("http://email/ready", { method: "POST", body: "x" })))
        .status,
    ).toBe(404);
  });
});
