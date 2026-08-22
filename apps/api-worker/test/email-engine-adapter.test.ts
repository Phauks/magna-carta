import { describe, expect, it } from "vitest";
import type { Bindings } from "../src/app.ts";
import { containerEmailAdapter } from "../src/emails/container-email-adapter.ts";
import { resolveEmailEnginePort } from "../src/emails/email-engine-binding.ts";
import {
  EmailEngineFaultError,
  EmailEngineUnavailableError,
  MessageRefusedError,
} from "../src/emails/email-engine-port.ts";

// The engine has THREE states and only the middle one is a verdict about the submitted message: no
// binding at all, bound and answering, bound and failing. The two callers turn the first into
// different things — a 503 on the request path, a terminal acked outcome on the queue — and neither
// may collapse it into "this mail is broken". Every case below pins one of the three.

function fakeEngine(respond: (request: Request) => Response | Promise<Response>): {
  fetch(request: Request): Promise<Response>;
} {
  return { fetch: async (request) => respond(request) };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const MESSAGE_BYTES = new TextEncoder().encode("From: a@example.com\r\n\r\nbody");

describe("resolveEmailEnginePort — state one: no binding", () => {
  it("rejects both operations with EmailEngineUnavailableError when EMAIL_SERVICE is absent", async () => {
    // This is the PRODUCTION state today: magna-carta-email is not connected, so the binding is
    // absent and every read honestly reports that rather than guessing.
    const port = resolveEmailEnginePort({} as Bindings);
    await expect(port.parseMessage(MESSAGE_BYTES)).rejects.toBeInstanceOf(
      EmailEngineUnavailableError,
    );
    await expect(port.extractPart(MESSAGE_BYTES, 0)).rejects.toBeInstanceOf(
      EmailEngineUnavailableError,
    );
  });

  it("selects the service adapter when EMAIL_SERVICE is present", async () => {
    const service = fakeEngine(() => jsonResponse({ parts: [], subject: "hello" }, 200));
    const port = resolveEmailEnginePort({ EMAIL_SERVICE: service } as unknown as Bindings);
    await expect(port.parseMessage(MESSAGE_BYTES)).resolves.toMatchObject({ subject: "hello" });
  });
});

describe("containerEmailAdapter — state two: bound and answering", () => {
  it("POSTs the raw bytes to /parse and returns the parse", async () => {
    let seenPath = "";
    let seenMethod = "";
    let seenBody = new Uint8Array();
    const port = containerEmailAdapter(
      fakeEngine(async (request) => {
        seenPath = new URL(request.url).pathname;
        seenMethod = request.method;
        seenBody = new Uint8Array(await request.arrayBuffer());
        return jsonResponse({ parts: [], subject: "Re: filing" }, 200);
      }),
    );

    const parsed = await port.parseMessage(MESSAGE_BYTES);
    expect(seenPath).toBe("/parse");
    expect(seenMethod).toBe("POST");
    expect(Array.from(seenBody)).toEqual(Array.from(MESSAGE_BYTES));
    expect(parsed).toMatchObject({ subject: "Re: filing" });
  });

  it("names the part by index on /extract-part and returns its bytes verbatim", async () => {
    let seenUrl = "";
    const partBytes = new Uint8Array([1, 2, 3, 4]);
    const port = containerEmailAdapter(
      fakeEngine((request) => {
        seenUrl = request.url;
        return new Response(partBytes, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        });
      }),
    );

    const extracted = await port.extractPart(MESSAGE_BYTES, 3);
    // The query parameter name is pinned identically in apps/email-worker/src/parse-service.ts — a
    // Worker cannot import from another Worker, so this is where the two sides agree.
    expect(new URL(seenUrl).pathname).toBe("/extract-part");
    expect(new URL(seenUrl).searchParams.get("index")).toBe("3");
    expect(Array.from(extracted)).toEqual(Array.from(partBytes));
  });

  it("raises a typed refusal — a verdict about the message — on 422, carrying the stable code", async () => {
    for (const code of ["malformed", "unsupported", "limitExceeded", "partNotFound"] as const) {
      const port = containerEmailAdapter(fakeEngine(() => jsonResponse({ code }, 422)));
      await expect(port.parseMessage(MESSAGE_BYTES)).rejects.toMatchObject({
        name: "MessageRefusedError",
        code,
      });
    }
  });
});

describe("containerEmailAdapter — state three: bound and failing", () => {
  it("raises a fault, never a refusal, on a 5xx from the far side", async () => {
    const port = containerEmailAdapter(fakeEngine(() => new Response("down", { status: 503 })));
    const thrown = await port.parseMessage(MESSAGE_BYTES).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(EmailEngineFaultError);
    expect(thrown).not.toBeInstanceOf(MessageRefusedError);
  });

  it("raises a fault on a 4xx outside the refusal contract — the message is not to blame for a wire disagreement", async () => {
    const port = containerEmailAdapter(fakeEngine(() => new Response("nope", { status: 404 })));
    await expect(port.parseMessage(MESSAGE_BYTES)).rejects.toBeInstanceOf(EmailEngineFaultError);
    await expect(port.extractPart(MESSAGE_BYTES, 0)).rejects.toBeInstanceOf(EmailEngineFaultError);
  });

  it("raises a fault when a 200 body is not a parse, rather than fabricating one", async () => {
    const port = containerEmailAdapter(
      fakeEngine(() => new Response("<html>gateway error</html>", { status: 200 })),
    );
    await expect(port.parseMessage(MESSAGE_BYTES)).rejects.toBeInstanceOf(EmailEngineFaultError);
  });

  it("raises a fault when a 422 carries a code outside the agreed vocabulary", async () => {
    const port = containerEmailAdapter(
      fakeEngine(() => jsonResponse({ code: "somethingNew" }, 422)),
    );
    await expect(port.parseMessage(MESSAGE_BYTES)).rejects.toBeInstanceOf(EmailEngineFaultError);
  });

  it("raises a fault when the transport throws, naming the failure and no part of the message", async () => {
    const port = containerEmailAdapter(
      fakeEngine(() => {
        throw new Error("connection reset");
      }),
    );
    const thrown = await port.parseMessage(MESSAGE_BYTES).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(EmailEngineFaultError);
    expect((thrown as Error).message).not.toContain("connection reset");
  });

  it("raises a fault rather than hanging when the engine never answers", async () => {
    const port = containerEmailAdapter(
      fakeEngine(
        (request) =>
          new Promise<Response>((_resolve, reject) => {
            request.signal.addEventListener("abort", () => {
              reject(new Error("aborted"));
            });
          }),
      ),
      5,
    );
    await expect(port.parseMessage(MESSAGE_BYTES)).rejects.toBeInstanceOf(EmailEngineFaultError);
  });
});
