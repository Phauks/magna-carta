import { describe, expect, it } from "vitest";
import worker, { ADDRESS_REFRESH_CRON, type Bindings } from "../src/index.ts";
import { ADDRESS_BUILD_INSTANCE_NAME, ADDRESS_INDEX_INSTANCE_NAME } from "../src/forward-query.ts";
import { memoryBucket } from "./fakes/memory-bucket.ts";

// The entrypoint's routing, against fake Durable Object namespaces. Each namespace records the
// instance name it was asked for and the requests that reached that instance.

interface Reached {
  readonly instance: string;
  readonly method: string;
  readonly path: string;
}

function fakeNamespace(answer: (request: Request) => Response, reached: Reached[]) {
  return {
    idFromName: (name: string) => name,
    get: (instance: string) => ({
      fetch: (request: Request) => {
        reached.push({
          instance,
          method: request.method,
          path: new URL(request.url).pathname,
        });
        return Promise.resolve(answer(request));
      },
    }),
  };
}

function environment(options: { pointer?: string; buildState?: string } = {}) {
  const queries: Reached[] = [];
  const builds: Reached[] = [];
  const storage = memoryBucket();
  if (options.pointer !== undefined) storage.put("us/current.json", options.pointer);
  const env = {
    ADDRESS_INDEX_CONTAINER: fakeNamespace((request) => {
      const path = new URL(request.url).pathname;
      return path === "/ready"
        ? new Response(null, { status: 204 })
        : Response.json({ outcome: "suggestions", offers: [] });
    }, queries),
    ADDRESS_BUILD_CONTAINER: fakeNamespace(
      (request) =>
        request.method === "GET"
          ? Response.json({ state: options.buildState ?? "idle" })
          : Response.json({ build: "started" }, { status: 202 }),
      builds,
    ),
    ADDRESS_INDEX: storage.bucket,
  } as unknown as Bindings;
  return { env, queries, builds };
}

function call(env: Bindings, path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`https://address${path}`, init), env);
}

describe("fetch", () => {
  it("forwards suggestions and units to the one query instance", async () => {
    const { env, queries, builds } = environment();
    for (const path of ["/suggestions", "/units"]) {
      const response = await call(env, path, { method: "POST", body: '{"country":"US"}' });
      expect(response.status, path).toBe(200);
    }
    expect(queries).toEqual([
      { instance: ADDRESS_INDEX_INSTANCE_NAME, method: "POST", path: "/suggestions" },
      { instance: ADDRESS_INDEX_INSTANCE_NAME, method: "POST", path: "/units" },
    ]);
    expect(builds).toEqual([]);
  });

  it("answers readiness by poking the query instance", async () => {
    const { env, queries } = environment();
    const response = await call(env, "/ready");
    expect(response.status).toBe(204);
    expect(queries).toEqual([
      { instance: ADDRESS_INDEX_INSTANCE_NAME, method: "GET", path: "/ready" },
    ]);
  });

  it("stops an unknown path here, the build surface included", async () => {
    const { env, queries, builds } = environment();
    for (const [method, path] of [
      ["POST", "/builds"],
      ["GET", "/builds"],
      ["GET", "/suggestions"],
      ["POST", "/objects/us/current.json"],
      ["POST", "/"],
    ] as const) {
      const response = await call(env, path, method === "POST" ? { method, body: "{}" } : {});
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    expect(queries).toEqual([]);
    expect(builds).toEqual([]);
  });
});

async function runCron(env: Bindings, cron = ADDRESS_REFRESH_CRON): Promise<void> {
  const pending: Promise<unknown>[] = [];
  worker.scheduled(
    { cron, scheduledTime: Date.parse("2026-10-02T07:17:00.000Z") } as ScheduledController,
    env,
    {
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    } as unknown as ExecutionContext,
  );
  await Promise.all(pending);
}

describe("scheduled", () => {
  it("starts a build on the build instance when there is no index", async () => {
    const { env, builds, queries } = environment();
    await runCron(env);
    expect(builds).toEqual([
      { instance: ADDRESS_BUILD_INSTANCE_NAME, method: "GET", path: "/builds" },
      { instance: ADDRESS_BUILD_INSTANCE_NAME, method: "POST", path: "/builds" },
    ]);
    expect(queries).toEqual([]);
  });

  it("leaves a fresh index alone without waking the build instance", async () => {
    const { env, builds } = environment({
      pointer: JSON.stringify({ build: "b", builtAt: "2026-09-20T00:00:00.000Z" }),
    });
    await runCron(env);
    expect(builds).toEqual([]);
  });

  it("ignores a cron it does not own", async () => {
    const { env, builds } = environment();
    await runCron(env, "0 0 * * *");
    expect(builds).toEqual([]);
  });
});
