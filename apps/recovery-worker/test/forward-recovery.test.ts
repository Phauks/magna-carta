import { describe, expect, it } from "vitest";
import { forwardRecoveryShard, forwardReady, routeRequest } from "../src/forward-recovery.ts";

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
