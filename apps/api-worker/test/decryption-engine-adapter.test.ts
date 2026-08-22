import { describe, expect, it } from "vitest";
import { containerDecryptionAdapter } from "../src/decryption/container-decryption-adapter.ts";
import { resolveDecryptionEnginePort } from "../src/decryption/decryption-engine-binding.ts";
import {
  DecryptionEngineFaultError,
  DecryptionEngineUnavailableError,
  HashExtractionRefusedError,
  UnlockRefusedError,
} from "../src/decryption/decryption-engine-port.ts";
import type { Bindings } from "../src/app.ts";

// The engine has THREE states and only the middle one is a verdict about the member's file:
// no binding at all, bound and answering, bound and failing. A route that collapses the first or
// the third into the second hands somebody an Error ID — or a "your file is not encrypted" — for an
// engine that is simply not there, which is the failure this port exists to prevent. Every case
// below pins one of the three.

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

const SOME_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

describe("resolveDecryptionEnginePort — state one: no binding", () => {
  it("rejects with DecryptionEngineUnavailableError when RECOVERY_SERVICE is absent", async () => {
    const port = resolveDecryptionEnginePort({} as Bindings);
    await expect(port.extractRecoveryHash(SOME_BYTES)).rejects.toBeInstanceOf(
      DecryptionEngineUnavailableError,
    );
  });

  it("selects the container adapter when RECOVERY_SERVICE is present", async () => {
    const service = fakeEngine(() =>
      jsonResponse({ format: "pdf", hash: "$pdf$x", hashcatMode: 10500, tier: "cfCapable" }, 200),
    );
    const port = resolveDecryptionEnginePort({ RECOVERY_SERVICE: service } as unknown as Bindings);
    await expect(port.extractRecoveryHash(SOME_BYTES)).resolves.toEqual({
      format: "pdf",
      hash: "$pdf$x",
      hashcatMode: 10500,
      tier: "cfCapable",
    });
  });
});

describe("containerDecryptionAdapter — state two: bound and answering", () => {
  it("POSTs the raw bytes to /extract-hash and returns the validated result", async () => {
    let seenPath = "";
    let seenMethod = "";
    let seenBody = new Uint8Array();
    const port = containerDecryptionAdapter(
      fakeEngine(async (request) => {
        seenPath = new URL(request.url).pathname;
        seenMethod = request.method;
        seenBody = new Uint8Array(await request.arrayBuffer());
        return jsonResponse(
          { format: "zip", hash: "$zip2$y", hashcatMode: 13600, tier: "cfCapable" },
          200,
        );
      }),
    );

    const result = await port.extractRecoveryHash(SOME_BYTES);
    expect(seenPath).toBe("/extract-hash");
    expect(seenMethod).toBe("POST");
    expect(Array.from(seenBody)).toEqual(Array.from(SOME_BYTES));
    expect(result.format).toBe("zip");
    expect(result.tier).toBe("cfCapable");
  });

  it("raises a typed refusal — a verdict about the file — on 422, carrying the stable code", async () => {
    for (const code of ["notEncrypted", "unsupported", "malformed"] as const) {
      const port = containerDecryptionAdapter(fakeEngine(() => jsonResponse({ code }, 422)));
      await expect(port.extractRecoveryHash(SOME_BYTES)).rejects.toMatchObject({
        name: "HashExtractionRefusedError",
        code,
      });
    }
  });
});

describe("containerDecryptionAdapter — state three: bound and failing", () => {
  it("raises a fault, never a refusal, on a 5xx from the far side", async () => {
    const port = containerDecryptionAdapter(
      fakeEngine(() => new Response("down", { status: 503 })),
    );
    const thrown = await port.extractRecoveryHash(SOME_BYTES).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(DecryptionEngineFaultError);
    expect(thrown).not.toBeInstanceOf(HashExtractionRefusedError);
  });

  it("raises a fault on a 4xx that is not the refusal contract — the file is not to blame for a wire disagreement", async () => {
    const port = containerDecryptionAdapter(
      fakeEngine(() => new Response("nope", { status: 404 })),
    );
    await expect(port.extractRecoveryHash(SOME_BYTES)).rejects.toBeInstanceOf(
      DecryptionEngineFaultError,
    );
  });

  it("raises a fault when a 200 body does not match the contract, rather than fabricating a hash", async () => {
    const port = containerDecryptionAdapter(
      fakeEngine(() => jsonResponse({ format: "pdf", hash: "$pdf$x" }, 200)),
    );
    await expect(port.extractRecoveryHash(SOME_BYTES)).rejects.toBeInstanceOf(
      DecryptionEngineFaultError,
    );
  });

  it("raises a fault when a 422 carries a code outside the agreed vocabulary", async () => {
    const port = containerDecryptionAdapter(
      fakeEngine(() => jsonResponse({ code: "somethingNew" }, 422)),
    );
    await expect(port.extractRecoveryHash(SOME_BYTES)).rejects.toBeInstanceOf(
      DecryptionEngineFaultError,
    );
  });

  it("raises a fault when the transport throws", async () => {
    const port = containerDecryptionAdapter(
      fakeEngine(() => {
        throw new Error("connection reset");
      }),
    );
    const thrown = await port.extractRecoveryHash(SOME_BYTES).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(DecryptionEngineFaultError);
    // The fault message names the failure and nothing from the submitted file.
    expect((thrown as Error).message).not.toContain("connection reset");
  });

  it("raises a fault rather than hanging when the engine never answers", async () => {
    // A wedged Container: it accepts the request and never replies. The real runtime aborts the
    // fetch on the adapter's own signal; this fake honours the same signal so the backstop is
    // exercised rather than assumed.
    const port = containerDecryptionAdapter(
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
    await expect(port.extractRecoveryHash(SOME_BYTES)).rejects.toBeInstanceOf(
      DecryptionEngineFaultError,
    );
  });
});

// The decrypt is the one call on this port that carries a secret: the file's own password, typed by
// a member. It runs on the same three states as the header read, and it carries one extra
// obligation that the tests below are the enforcement of — the password reaches the request body
// and nothing else. Not the URL, not a header, not an error message, not the reply.
describe("containerDecryptionAdapter — the decrypt carries a password", () => {
  const PASSWORD = "correct-horse-battery-staple";

  it("frames the password into the body and puts it nowhere else on the request", async () => {
    let seenPath = "";
    let seenSearch = "";
    let seenHeaders: string[] = [];
    let seenBody = new Uint8Array();
    const port = containerDecryptionAdapter(
      fakeEngine(async (request) => {
        const url = new URL(request.url);
        seenPath = url.pathname;
        seenSearch = url.search;
        seenHeaders = [...request.headers].map(([name, value]) => `${name}: ${value}`);
        seenBody = new Uint8Array(await request.arrayBuffer());
        return jsonResponse(
          { format: "pdf", decryptedBase64: "JVBERi0=", filenameHint: null },
          200,
        );
      }),
    );

    const result = await port.unlockWithPassword(SOME_BYTES, PASSWORD);
    expect(result).toEqual({ format: "pdf", decryptedBase64: "JVBERi0=", filenameHint: null });

    expect(seenPath).toBe("/unlock");
    expect(seenSearch).toBe("");
    expect(seenHeaders.join("\n")).not.toContain(PASSWORD);

    // The body is [u32 big-endian password length][password][file] — the framing
    // containers/recovery/src/server.rs splits. A Worker cannot import from a Container, so this is
    // where the two sides are held to the same shape.
    const passwordBytes = new TextEncoder().encode(PASSWORD);
    expect(new DataView(seenBody.buffer, seenBody.byteOffset).getUint32(0, false)).toBe(
      passwordBytes.byteLength,
    );
    expect(Array.from(seenBody.subarray(4, 4 + passwordBytes.byteLength))).toEqual(
      Array.from(passwordBytes),
    );
    expect(Array.from(seenBody.subarray(4 + passwordBytes.byteLength))).toEqual(
      Array.from(SOME_BYTES),
    );
  });

  it("raises a typed refusal on 422, including the wrong-password verdict, carrying no password", async () => {
    for (const code of ["wrongPassword", "notEncrypted", "unsupported", "malformed"] as const) {
      const port = containerDecryptionAdapter(fakeEngine(() => jsonResponse({ code }, 422)));
      const thrown = await port
        .unlockWithPassword(SOME_BYTES, PASSWORD)
        .catch((error: unknown) => error);
      expect(thrown).toMatchObject({ name: "UnlockRefusedError", code });
      expect(JSON.stringify(thrown, Object.getOwnPropertyNames(thrown))).not.toContain(PASSWORD);
    }
  });

  it("raises a fault, never a wrong-password verdict, when a bound engine cannot answer", async () => {
    // Telling a member their password is wrong because a Container did not start is the specific
    // mistake this branch exists to prevent.
    for (const respond of [
      () => new Response("down", { status: 503 }),
      () => new Response("nope", { status: 404 }),
      () => jsonResponse({ format: "pdf" }, 200),
      () => jsonResponse({ code: "somethingNew" }, 422),
    ]) {
      const port = containerDecryptionAdapter(fakeEngine(respond));
      const thrown = await port
        .unlockWithPassword(SOME_BYTES, PASSWORD)
        .catch((error: unknown) => error);
      expect(thrown).toBeInstanceOf(DecryptionEngineFaultError);
      expect(thrown).not.toBeInstanceOf(UnlockRefusedError);
      expect((thrown as Error).message).not.toContain(PASSWORD);
    }
  });

  it("raises a fault whose message names the transport, never the password, when the wire throws", async () => {
    const port = containerDecryptionAdapter(
      fakeEngine(() => {
        throw new Error(`connection reset while sending ${PASSWORD}`);
      }),
    );
    const thrown = await port
      .unlockWithPassword(SOME_BYTES, PASSWORD)
      .catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(DecryptionEngineFaultError);
    expect((thrown as Error).message).not.toContain(PASSWORD);
  });

  it("rejects with DecryptionEngineUnavailableError when no engine is wired", async () => {
    const port = resolveDecryptionEnginePort({} as Bindings);
    await expect(port.unlockWithPassword(SOME_BYTES, PASSWORD)).rejects.toBeInstanceOf(
      DecryptionEngineUnavailableError,
    );
  });

  it("raises a fault rather than hanging when the engine never answers", async () => {
    const port = containerDecryptionAdapter(
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
    await expect(port.unlockWithPassword(SOME_BYTES, PASSWORD)).rejects.toBeInstanceOf(
      DecryptionEngineFaultError,
    );
  });
});
