import { describe, expect, it } from "vitest";
import {
  forwardExtractHash,
  forwardRecoveryShard,
  forwardReady,
  forwardUnlock,
  routeRequest,
} from "../src/forward-recovery.ts";

// A minimal fake container that returns a fixed response. The real container is a Docker image that
// cannot run under the local test pool; the forward functions only need a { fetch } object, so we
// pass one here.
function fakeContainer(response: Response): { fetch(req: Request): Promise<Response> } {
  return { fetch: async () => response };
}

describe("forwardRecoveryShard", () => {
  it("forwards POST /recover-shard to the container and returns the response verbatim", async () => {
    const shardOutcome = { found: null, candidatesTried: 14344392 };
    const container = fakeContainer(
      new Response(JSON.stringify(shardOutcome), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const request = new Request("http://recovery-worker/recover-shard", {
      method: "POST",
      body: JSON.stringify({
        hash: "$2a$05$LhayLxezLhK1LhWvKxCyLO3pI6LAP5MFs9kGNl1FrqOc4YVIiZOHy",
        format: "bcrypt",
        shardIndex: 0,
        totalShards: 1,
      }),
    });

    const response = await forwardRecoveryShard(request, container);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(shardOutcome);
  });

  it("propagates non-200 status codes from the container", async () => {
    const container = fakeContainer(new Response("internal engine error", { status: 500 }));
    const request = new Request("http://recovery-worker/recover-shard", {
      method: "POST",
      body: "{}",
    });

    const response = await forwardRecoveryShard(request, container);
    expect(response.status).toBe(500);
  });

  it("propagates a 200 found response when the password is recovered", async () => {
    const shardOutcome = { found: "hashcat", candidatesTried: 1 };
    const container = fakeContainer(
      new Response(JSON.stringify(shardOutcome), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const request = new Request("http://recovery-worker/recover-shard", {
      method: "POST",
      body: JSON.stringify({
        hash: "$2a$05$LhayLxezLhK1LhWvKxCyLO3pI6LAP5MFs9kGNl1FrqOc4YVIiZOHy",
        format: "bcrypt",
        shardIndex: 0,
        totalShards: 1,
      }),
    });

    const response = await forwardRecoveryShard(request, container);
    expect(response.status).toBe(200);
    const body = (await response.json()) as typeof shardOutcome;
    expect(body.found).toBe("hashcat");
    expect(body.candidatesTried).toBe(1);
  });
});

describe("forwardExtractHash", () => {
  it("forwards POST /extract-hash to the container and returns the 200 verbatim", async () => {
    const extracted = { format: "pdf", hash: "$pdf$2*3*128*-4*1*32*abc", hashcatMode: 10500 };
    const container = fakeContainer(
      new Response(JSON.stringify(extracted), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await forwardExtractHash(
      new Request("http://recovery-worker/extract-hash", { method: "POST", body: "%PDF-1.3" }),
      container,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(extracted);
  });

  it("passes a 422 refusal about the file through unchanged, so the caller can tell it from a fault", async () => {
    const container = fakeContainer(
      new Response(JSON.stringify({ code: "notEncrypted" }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await forwardExtractHash(
      new Request("http://recovery-worker/extract-hash", { method: "POST", body: "plain text" }),
      container,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ code: "notEncrypted" });
  });

  it("propagates a 5xx from the container rather than converting it into a refusal", async () => {
    const container = fakeContainer(new Response("engine panicked", { status: 500 }));

    const response = await forwardExtractHash(
      new Request("http://recovery-worker/extract-hash", { method: "POST", body: "%PDF-1.3" }),
      container,
    );
    expect(response.status).toBe(500);
  });
});

describe("forwardUnlock", () => {
  it("forwards POST /unlock to the container and returns the 200 verbatim", async () => {
    const unlocked = { format: "pdf", decryptedBase64: "JVBERi0=", filenameHint: null };
    const container = fakeContainer(
      new Response(JSON.stringify(unlocked), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await forwardUnlock(
      new Request("http://recovery-worker/unlock", { method: "POST", body: "framed-body" }),
      container,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(unlocked);
  });

  it("passes a 422 wrong-password verdict through unchanged, so the caller can tell it from a fault", async () => {
    const container = fakeContainer(
      new Response(JSON.stringify({ code: "wrongPassword" }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await forwardUnlock(
      new Request("http://recovery-worker/unlock", { method: "POST", body: "framed-body" }),
      container,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ code: "wrongPassword" });
  });

  it("propagates a 5xx from the container rather than converting it into a refusal", async () => {
    const container = fakeContainer(new Response("engine panicked", { status: 500 }));

    const response = await forwardUnlock(
      new Request("http://recovery-worker/unlock", { method: "POST", body: "framed-body" }),
      container,
    );
    expect(response.status).toBe(500);
  });

  it("adds no header, query parameter, or copy of its own to a body that carries a password", async () => {
    // The forward is deliberately four lines. A password lives in this request body and nowhere
    // else on the wire; anything this worker reads out of it or hangs beside it is a second place
    // it can be observed.
    let forwarded: Request | undefined;
    const container = {
      fetch: async (request: Request) => {
        forwarded = request;
        return new Response("{}", { status: 200 });
      },
    };

    const framed = new Uint8Array([0, 0, 0, 4, 116, 101, 115, 116, 37, 80, 68, 70]);
    await forwardUnlock(
      new Request("http://recovery-worker/unlock", { method: "POST", body: framed }),
      container,
    );

    const sent = forwarded as unknown as Request;
    expect(new URL(sent.url).search).toBe("");
    expect([...sent.headers.keys()]).not.toContain("x-decryption-password");
    expect(new Uint8Array(await sent.arrayBuffer())).toEqual(framed);
  });
});

describe("forwardReady", () => {
  it("routes GET /ready to the container and returns the response verbatim", async () => {
    const container = fakeContainer(new Response("ok", { status: 200 }));
    const response = await forwardReady(container);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("propagates a non-200 ready response from the container", async () => {
    const container = fakeContainer(new Response("not ready", { status: 503 }));
    const response = await forwardReady(container);
    expect(response.status).toBe(503);
  });
});

// routeRequest is extracted from index.ts so the full routing logic can be tested without importing
// @cloudflare/containers (which requires the cloudflare:workers runtime, unavailable in node pool).
describe("routeRequest routing", () => {
  it("returns 404 for unknown routes", async () => {
    const container = fakeContainer(new Response("ok", { status: 200 }));
    const response = await routeRequest(
      new Request("http://recovery-worker/unknown"),
      () => container,
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
  });

  it("returns 404 for a GET to /recover-shard (wrong method)", async () => {
    const container = fakeContainer(new Response("ok", { status: 200 }));
    const response = await routeRequest(
      new Request("http://recovery-worker/recover-shard", { method: "GET" }),
      () => container,
    );
    expect(response.status).toBe(404);
  });

  it("returns 404 for a POST to /ready (wrong method)", async () => {
    const container = fakeContainer(new Response("ok", { status: 200 }));
    const response = await routeRequest(
      new Request("http://recovery-worker/ready", { method: "POST", body: "{}" }),
      () => container,
    );
    expect(response.status).toBe(404);
  });

  it("routes POST /recover-shard to the container via routeRequest", async () => {
    const shardOutcome = { found: "hashcat", candidatesTried: 1 };
    const container = fakeContainer(new Response(JSON.stringify(shardOutcome), { status: 200 }));
    const response = await routeRequest(
      new Request("http://recovery-worker/recover-shard", { method: "POST", body: "{}" }),
      () => container,
    );
    expect(response.status).toBe(200);
  });

  it('routes /recover-shard to the fallback "recovery" instance when X-Recovery-Instance is absent', async () => {
    const seen: string[] = [];
    const resolve = (id: string) => {
      seen.push(id);
      return fakeContainer(new Response("{}", { status: 200 }));
    };
    const response = await routeRequest(
      new Request("http://recovery-worker/recover-shard", { method: "POST", body: "{}" }),
      resolve,
    );
    expect(response.status).toBe(200);
    expect(seen).toEqual(["recovery"]);
  });

  it("routes POST /extract-hash to the container via routeRequest", async () => {
    const container = fakeContainer(
      new Response('{"format":"pdf","hash":"$pdf$x","hashcatMode":10500,"tier":"cfCapable"}', {
        status: 200,
      }),
    );
    const response = await routeRequest(
      new Request("http://recovery-worker/extract-hash", { method: "POST", body: "%PDF-1.3" }),
      () => container,
    );
    expect(response.status).toBe(200);
  });

  it("routes POST /unlock to the container via routeRequest", async () => {
    const container = fakeContainer(
      new Response('{"format":"pdf","decryptedBase64":"JVBERi0=","filenameHint":null}', {
        status: 200,
      }),
    );
    const response = await routeRequest(
      new Request("http://recovery-worker/unlock", { method: "POST", body: "framed-body" }),
      () => container,
    );
    expect(response.status).toBe(200);
  });

  it("returns 404 for a GET to /unlock (wrong method)", async () => {
    const container = fakeContainer(new Response("ok", { status: 200 }));
    const response = await routeRequest(
      new Request("http://recovery-worker/unlock", { method: "GET" }),
      () => container,
    );
    expect(response.status).toBe(404);
  });

  it("returns 404 for a GET to /extract-hash (wrong method)", async () => {
    const container = fakeContainer(new Response("ok", { status: 200 }));
    const response = await routeRequest(
      new Request("http://recovery-worker/extract-hash", { method: "GET" }),
      () => container,
    );
    expect(response.status).toBe(404);
  });

  it("routes GET /ready to the container via routeRequest", async () => {
    const container = fakeContainer(new Response("ok", { status: 200 }));
    const response = await routeRequest(
      new Request("http://recovery-worker/ready", { method: "GET" }),
      () => container,
    );
    expect(response.status).toBe(200);
  });

  it("routes /recover-shard to the container instance named by X-Recovery-Instance", async () => {
    const seen: string[] = [];
    const resolve = (id: string) => {
      seen.push(id);
      return {
        fetch: async () => new Response('{"found":null,"candidatesTried":3}', { status: 200 }),
      };
    };
    const req = new Request("http://recovery/recover-shard", {
      method: "POST",
      headers: { "X-Recovery-Instance": "job_abc:2" },
      body: "{}",
    });
    const res = await routeRequest(req, resolve);
    expect(res.status).toBe(200);
    expect(seen).toEqual(["job_abc:2"]);
  });
});
